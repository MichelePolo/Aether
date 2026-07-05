# Vault delle chiavi

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [Key vault](../../guides/key-vault.md).

Cosa copre: come le chiavi API dei provider e i segreti degli endpoint openai-compat/Ollama sono cifrati a riposo. Leggilo quando gestisci credenziali, fai debug di un report "il provider è sparito dopo l'aggiornamento", o rivedi le proprietà di sicurezza del vault.

## Come funziona

Ogni segreto (chiave API di un provider, token/header di un endpoint Ollama, header di un endpoint openai-compat) è memorizzato come blob **AES-256-GCM** (`ciphertext`, `iv`, `authTag`) in SQLite — vedi `encrypt()` / `decrypt()` in `server/lib/key-crypto.ts` e la forma della riga in `KeyVaultService` (`server/domain/providers/key-vault.ts`).

**Materiale della chiave**: la chiave di vault attiva viene risolta da `loadOrCreateVaultKey(dataDir)` (`server/lib/key-crypto.ts`):
1. Se `AETHER_VAULT_KEY` è impostata, deve essere di 64 caratteri esadecimali (32 byte) o il processo lancia un'eccezione all'avvio.
2. Altrimenti, viene generata una volta una chiave casuale di 32 byte e persistita in `${AETHER_DATA_DIR}/.vault.key` con permessi file `0600`. Vivere dentro la directory dati significa che la chiave viaggia insieme a un database sincronizzato/copiato, evitando la modalità di guasto "le chiavi funzionano solo su una macchina".
3. La chiave viene messa in cache in-process dopo il primo caricamento (`cachedKey`).

**Ordine di risoluzione in lettura**: `KeyResolver.get()` (`server/domain/providers/key-resolver.ts`) controlla prima la variabile d'ambiente corrispondente (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`), e interroga `KeyVaultService.getKey()` (decifra e restituisce) solo se la variabile d'ambiente non è impostata. Questo significa che una variabile d'ambiente vince sempre su una chiave di vault memorizzata, per ognuno dei tre transport basati su vault.

**Esposizione in chiaro**: l'API HTTP non restituisce mai il materiale della chiave decifrato. `KeyVaultService.listMasked()` restituisce `mask(plaintext)` (una stringa di visualizzazione redatta) più `hasKey` e `updatedAt` — il testo in chiaro effettivo resta lato server. Analogamente, `OpenAICompatEndpointRecord` (`server/domain/providers/openai-endpoints.types.ts`) espone solo le **chiavi** degli header, mai i valori.

**Comportamento di migrazione / disallineamento chiave**: `migrateVaultToRandomKey()` (`server/lib/vault-migrate.ts`) viene eseguita una volta all'avvio dentro una transazione. Per ogni gruppo di colonne cifrate in `provider_keys`, `ollama_endpoints` e `openai_compat_endpoints`, prova prima la chiave attiva (già migrata → salta), poi una vecchia chiave derivata dall'hostname (`deriveLegacyKey()`, mantenuta solo per questa migrazione una tantum) — se questa decifra, ricifra il valore sotto la chiave attiva. Se un blob non decifra sotto **nessuna** delle due chiavi, la riga viene lasciata intatta (mai distrutta) e `warnUndecryptable()` registra un avviso che nomina la tabella e l'id della riga — ma mai il testo cifrato o in chiaro — così l'operatore riceve un segnale visibile che un segreto è illeggibile e va reinserito, invece di un fallimento silenzioso della chiave.

Nota: `KeyVaultService.getKey()` cattura anche indipendentemente un fallimento di decifratura (mismatch dell'auth-tag) al momento della lettura e registra un avviso, restituendo `null` invece di lanciare un'eccezione — così una singola riga corrotta/con chiave estranea degrada a "chiave non impostata" invece di far crashare il chiamante.

## File chiave

- `server/lib/key-crypto.ts` — `loadOrCreateVaultKey`, `deriveLegacyKey`, `encrypt`/`decrypt` (AES-256-GCM)
- `server/domain/providers/key-vault.ts` — `KeyVaultService`: set/get/clear/list-masked
- `server/domain/providers/key-resolver.ts` — `KeyResolver` con priorità all'ambiente
- `server/lib/vault-migrate.ts` — passaggio di ricifratura una tantum e l'avviso sulle righe non decifrabili
- `server/index.ts` — dove la chiave di vault viene caricata e la migrazione invocata all'avvio

## Vedi anche

- [Provider](providers.md) — come le chiavi risolte determinano quali provider compaiono nel registro
- [Configurazione](../../reference/configuration.md) (in inglese) — `AETHER_VAULT_KEY` e `AETHER_DATA_DIR`
- [Database](../../reference/database.md) (in inglese) — le tabelle `provider_keys`, `ollama_endpoints`, `openai_compat_endpoints`
