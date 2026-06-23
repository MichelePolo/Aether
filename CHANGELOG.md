# Changelog

## [0.1.13](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.12...aether-core-v0.1.13) (2026-06-23)


### Features

* OpenAI-compatible (vLLM) provider + custom auth headers ([#88](https://github.com/MichelePolo/Aether/issues/88)) ([b5916b5](https://github.com/MichelePolo/Aether/commit/b5916b564513624e2d33c63f586888253b6bc051))

## [0.1.12](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.11...aether-core-v0.1.12) (2026-06-22)


### Bug Fixes

* **subagents:** partial edit wiped system instruction + form overflow off-screen ([#86](https://github.com/MichelePolo/Aether/issues/86)) ([fe4ca79](https://github.com/MichelePolo/Aether/commit/fe4ca79f78aedc68c393da1b778dbf6f433998bc))

## [0.1.11](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.10...aether-core-v0.1.11) (2026-06-20)


### Features

* data-agnostic library dir + race-free per-context workspace rooting ([#84](https://github.com/MichelePolo/Aether/issues/84)) ([7e58b72](https://github.com/MichelePolo/Aether/commit/7e58b7225fd1523674a8537cdf76d4a0e515d3d6))

## [0.1.10](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.9...aether-core-v0.1.10) (2026-06-19)


### Features

* **dispatch:** inject # availableWorkspaces block and document multi-workspace model ([#80](https://github.com/MichelePolo/Aether/issues/80)) ([31e70ea](https://github.com/MichelePolo/Aether/commit/31e70ea86fb5b3667edda157f9eac7b35831093d))

## [0.1.9](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.8...aether-core-v0.1.9) (2026-06-19)


### Features

* **swarms:** per-step / per-sub-agent LLM selection ([#79](https://github.com/MichelePolo/Aether/issues/79)) ([50a64d7](https://github.com/MichelePolo/Aether/commit/50a64d7144651bc860dff64cacb1448520ed338d))

## [0.1.8](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.7...aether-core-v0.1.8) (2026-06-18)


### Bug Fixes

* **dispatch:** preserve MCP tool arg types so array/number args aren't rejected ([#76](https://github.com/MichelePolo/Aether/issues/76)) ([3b8f53e](https://github.com/MichelePolo/Aether/commit/3b8f53ebe9e00d5fe932d2a13d3f5bd711021a45))

## [0.1.7](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.6...aether-core-v0.1.7) (2026-06-18)


### Features

* ETERE.md init skill + per-workspace project-memory ingestion ([#74](https://github.com/MichelePolo/Aether/issues/74)) ([e400950](https://github.com/MichelePolo/Aether/commit/e4009509912186780fc54e57a1f8c3eb9145b4fa))

## [0.1.6](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.5...aether-core-v0.1.6) (2026-06-17)


### Bug Fixes

* **chat:** wrap long unbreakable strings inside message bubbles ([#72](https://github.com/MichelePolo/Aether/issues/72)) ([dd19f46](https://github.com/MichelePolo/Aether/commit/dd19f466d66cf8f502c7df4c6d7f54759087dde3))

## [0.1.5](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.4...aether-core-v0.1.5) (2026-06-17)


### Features

* transparent LLM dialogue in the thinking panel ("Aether mode") ([#70](https://github.com/MichelePolo/Aether/issues/70)) ([8dbccff](https://github.com/MichelePolo/Aether/commit/8dbccff99ccc7150346d6f34adfbbcafd3ced024))

## [0.1.4](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.3...aether-core-v0.1.4) (2026-06-17)


### Features

* **prompt:** official Aether system prompt ([#68](https://github.com/MichelePolo/Aether/issues/68)) ([60186c2](https://github.com/MichelePolo/Aether/commit/60186c25565f774a2c04060c92d0ae9ba6020a04))

## [0.1.3](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.2...aether-core-v0.1.3) (2026-06-17)


### Bug Fixes

* **skills:** Windows-safe promote (rename→copy+remove) + inline error surface ([#66](https://github.com/MichelePolo/Aether/issues/66)) ([6e8e2af](https://github.com/MichelePolo/Aether/commit/6e8e2af2c233bbee9204c910ef9aa41a9418bb4a))

## [0.1.2](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.1...aether-core-v0.1.2) (2026-06-16)


### Features

* Scheduled / Background Agents (slice 31) ([#63](https://github.com/MichelePolo/Aether/issues/63)) ([81c521a](https://github.com/MichelePolo/Aether/commit/81c521a6d7ad1d75603742e59a66c4720c7c865b))
* **skills:** filesystem-based skills + AI-assisted generation ([#64](https://github.com/MichelePolo/Aether/issues/64)) ([ded2fa1](https://github.com/MichelePolo/Aether/commit/ded2fa125aa49c9bd3db39208b3b2462b24d9d8f))

## [0.1.1](https://github.com/MichelePolo/Aether/compare/aether-core-v0.1.0...aether-core-v0.1.1) (2026-06-14)


### Features

* git Changes pane (working-tree source control) ([#62](https://github.com/MichelePolo/Aether/issues/62)) ([f9f146f](https://github.com/MichelePolo/Aether/commit/f9f146f87aa98f01aeb10def4e7d4d5b5d9ddf73))
* **ui:** view & revoke session approvals ([#58](https://github.com/MichelePolo/Aether/issues/58)) ([3d005b7](https://github.com/MichelePolo/Aether/commit/3d005b796b172a2062636a943a627c4335fb4ab8))


### Bug Fixes

* **ui:** scrollable reasoning drawer + collapsible tool calls ([#61](https://github.com/MichelePolo/Aether/issues/61)) ([f678902](https://github.com/MichelePolo/Aether/commit/f678902c42bea95df3016f8aa83956ecd3ee31fc))

## 0.1.0 (2026-06-12)


### Features

* Add bot icon and improve context export/import ([95db089](https://github.com/MichelePolo/Aether/commit/95db08987db2bcb4d0b493850ebdd8e028a466ef))
* Add tool management and streaming AI dispatch ([247658a](https://github.com/MichelePolo/Aether/commit/247658aa0cccf72acb437d7fe0577edb0583b665))
* **chat:** composer model pill + extensible "+" menu ([265b5b4](https://github.com/MichelePolo/Aether/commit/265b5b4e74a3a86777b295ed0dce4e8bc89de3e1))
* **chat:** markdown copy button + proper GFM/list/table rendering ([#47](https://github.com/MichelePolo/Aether/issues/47)) ([c0d5555](https://github.com/MichelePolo/Aether/commit/c0d55556e2cc17927a0dbb579808a0cfde4445a3))
* **chat:** render raw tool output as CLI-green block; Brain icon on reasoning chip ([463279e](https://github.com/MichelePolo/Aether/commit/463279e971303244e1bc0fd6f90a411f13585383))
* **chat:** WhatsApp-style dark chat + Claude-style composer ([2085e57](https://github.com/MichelePolo/Aether/commit/2085e5722b463f4803e63865f4e359a5737b46c5))
* **dispatch:** add ProviderRequest.runToolCall for SDK-driven tool loops ([e0f0fa4](https://github.com/MichelePolo/Aether/commit/e0f0fa4f69f2c4566209fef776ba8d1d58f4873f))
* **dispatch:** share gate/execute logic + provide runToolCall to providers ([8ecdf43](https://github.com/MichelePolo/Aether/commit/8ecdf43a3dd65ecb2b8f1c7c77eaa44c7e718f88))
* Implement command palette ([a24773f](https://github.com/MichelePolo/Aether/commit/a24773f970be6e617288e17a66e2ec896fa2bbf3))
* Initialize Aether AI Dev Studio project ([f360668](https://github.com/MichelePolo/Aether/commit/f360668eb5fba8bd9e9df4ce6883f2f7ba9deb6e))
* multi-endpoint Ollama (runtime-configurable remote endpoints) ([118062d](https://github.com/MichelePolo/Aether/commit/118062d3edbb5c9f3f2995d339451b35d6663e87))
* **ollama:** client types, API methods, optimistic endpoints store ([3bcc082](https://github.com/MichelePolo/Aether/commit/3bcc0825cb6d7ea9775faa3adf5df75f958b987b))
* **ollama:** CRUD routes for endpoints + server wiring ([e74ce42](https://github.com/MichelePolo/Aether/commit/e74ce427ccc1048cce608366473b14ac07411e66))
* **ollama:** dedicated endpoints management modal ([2553d62](https://github.com/MichelePolo/Aether/commit/2553d620b7f52144abc79e0a34ad07771f2a10d9))
* **ollama:** optional Bearer token in discovery + provider ([c459b46](https://github.com/MichelePolo/Aether/commit/c459b46e8de1bbb4e52205a721261f332d472787))
* **ollama:** per-endpoint status probing in AuthStatusService ([212f4b6](https://github.com/MichelePolo/Aether/commit/212f4b651dbfdc47bc3fe7d90a7226d6c32fd177))
* **ollama:** per-endpoint status rows + manage button in provider panel ([0f6d78f](https://github.com/MichelePolo/Aether/commit/0f6d78f28d0d52f62c97be16b97e1f7afa96c129))
* **ollama:** persisted OllamaEndpointStore + migration 010 ([7f75785](https://github.com/MichelePolo/Aether/commit/7f75785292c3405278a96f0b8751b280a9f96a62))
* **ollama:** providerAuth store carries per-endpoint status ([319f04b](https://github.com/MichelePolo/Aether/commit/319f04b0b41ca122969367597e756633a74f0c9b))
* **ollama:** registry iterates multiple endpoints with namespaced names ([b4ec03a](https://github.com/MichelePolo/Aether/commit/b4ec03a9e29b9c9c42b65b4ca46521a4f8d0502b))
* **providers:** Anthropic dynamic model discovery ([#48](https://github.com/MichelePolo/Aether/issues/48)) ([d9d333b](https://github.com/MichelePolo/Aether/commit/d9d333bb72a7a9d5106a9a5940a290ef8a9fa6fe))
* **slice-0:** foundation — toolchain, primitives, dialog system, server lib ([#1](https://github.com/MichelePolo/Aether/issues/1)) ([10dbf62](https://github.com/MichelePolo/Aether/commit/10dbf62370413086ffa9c0e7e5eb18966c4b62ec))
* **slice-10:** MCP advanced — HTTP transport + auto-reconnect + refresh + progress + cancel ([#15](https://github.com/MichelePolo/Aether/issues/15)) ([a0620a2](https://github.com/MichelePolo/Aether/commit/a0620a2a751b657ba84d6257d7a411e47b925400))
* **slice-11:** Anthropic provider via Claude Agent SDK ([#16](https://github.com/MichelePolo/Aether/issues/16)) ([11999ef](https://github.com/MichelePolo/Aether/commit/11999ef95d1ce4d233525965288084a5ad134ace))
* **slice-12:** OpenAI provider (Chat Completions API) ([#17](https://github.com/MichelePolo/Aether/issues/17)) ([6ac0ddd](https://github.com/MichelePolo/Aether/commit/6ac0ddd969a25ec4023e60f338d8ac7cfb4e1a75))
* **slice-13:** SQLite persistence (fully relational) ([#18](https://github.com/MichelePolo/Aether/issues/18)) ([edb3661](https://github.com/MichelePolo/Aether/commit/edb366146a7f288bb326b97bdfd33ddd31b5d416))
* **slice-14:** cancellation UX polish (Riprendi + token estimate) ([#20](https://github.com/MichelePolo/Aether/issues/20)) ([351de6e](https://github.com/MichelePolo/Aether/commit/351de6e485f53a7a4e61b8769a65ae00ee5028a3))
* **slice-15:** full-text search over messages (SQLite FTS5 + palette) ([#21](https://github.com/MichelePolo/Aether/issues/21)) ([15fedaf](https://github.com/MichelePolo/Aether/commit/15fedaf9ffaf47cc7a35b1e544ceac8a9fb63e28))
* **slice-16:** export/import single session (JSON envelope) ([#23](https://github.com/MichelePolo/Aether/issues/23)) ([1f4b9b8](https://github.com/MichelePolo/Aether/commit/1f4b9b88b58aa2fc402c4ad1dfe5365a927e6032))
* **slice-17:** provider auth status pane ([#24](https://github.com/MichelePolo/Aether/issues/24)) ([01118bd](https://github.com/MichelePolo/Aether/commit/01118bd1078b2c4e90571f09cbcdcff06efc8151))
* **slice-18:** in-app provider key vault ([#25](https://github.com/MichelePolo/Aether/issues/25)) ([bde96b9](https://github.com/MichelePolo/Aether/commit/bde96b9dcc744451bc1b76be3a3fd95468db8e3a))
* **slice-19:** conversation forking + token-only context meter ([#26](https://github.com/MichelePolo/Aether/issues/26)) ([fb5743e](https://github.com/MichelePolo/Aether/commit/fb5743ebdb6cdec7678184bbb6cbc7f3e611c52d))
* **slice-1:** context CRUD + persistenza JSON + demolizione App.tsx legacy ([#2](https://github.com/MichelePolo/Aether/issues/2)) ([e5af4cf](https://github.com/MichelePolo/Aether/commit/e5af4cf82453998fd3a3089c523d6f1a919e903f))
* **slice-20:** message attachments (images + text files) ([#27](https://github.com/MichelePolo/Aether/issues/27)) ([15512fb](https://github.com/MichelePolo/Aether/commit/15512fb895079045738d8d7e13ae9bcf587f02c4))
* **slice-21:** 1-click coding MCPs (Filesystem + Terminal) ([#28](https://github.com/MichelePolo/Aether/issues/28)) ([5b56dbc](https://github.com/MichelePolo/Aether/commit/5b56dbc3c1a01eaef66aa59219e8a8076ffa289f))
* **slice-22:** Agentic breakpoints + dry-run sandboxing ([#29](https://github.com/MichelePolo/Aether/issues/29)) ([5d102c5](https://github.com/MichelePolo/Aether/commit/5d102c536eb48947d3f2dde006bab0bfe46b7b73))
* **slice-23:** Native workspace management GUI ([#30](https://github.com/MichelePolo/Aether/issues/30)) ([c5e9986](https://github.com/MichelePolo/Aether/commit/c5e9986bd31dd7a5c06530e55fca665b307647d9))
* **slice-24-ux:** ApprovalGate Modal migration + backdrop no-op + focus Reject + 60s countdown + sticky icon ([cbd68cd](https://github.com/MichelePolo/Aether/commit/cbd68cd1e069e890c9e4cfadbc76b01f1dd0cc70))
* **slice-24-ux:** AttachmentDropZone full overlay with hint text ([c1ff54d](https://github.com/MichelePolo/Aether/commit/c1ff54d4d763bf9bc75b7602b4e65717a5259746))
* **slice-24-ux:** AttachmentLightbox prev/next + Download/Open-in-new-tab + named alt ([f21fe53](https://github.com/MichelePolo/Aether/commit/f21fe535ce77a53cf2a89e7bb1fc88a93fb55f95))
* **slice-24-ux:** BreakpointsSection radio group + help tooltip ([98d10aa](https://github.com/MichelePolo/Aether/commit/98d10aaaf7af1c2d9a6aed8c79d59ac4c2ca244e))
* **slice-24-ux:** color-scheme dark + theme-color meta + dialog backdrop + sidebar scrollbar ([e87b855](https://github.com/MichelePolo/Aether/commit/e87b85504ceb7898a8de3d2d2204e03de274ca2a))
* **slice-24-ux:** DiffView line numbers + Copy new + Copy diff buttons ([14fccb0](https://github.com/MichelePolo/Aether/commit/14fccb032aa2ac76fea7fdf705f6c9d700abe33b))
* **slice-24-ux:** i18n.ts + t() helper with typed key paths ([829a346](https://github.com/MichelePolo/Aether/commit/829a3468165423b07d2aadb2e1f9d333e4d4d9c1))
* **slice-24-ux:** KeyVaultModal Eye/EyeOff icons + reveal countdown + aria-busy + ref focus ([2964f90](https://github.com/MichelePolo/Aether/commit/2964f900cdad89b32281b3ef51f475c5deef600e))
* **slice-24-ux:** McpServersSection lucide icons + aria-live + role=alert + empty-tools state ([0e8d2a7](https://github.com/MichelePolo/Aether/commit/0e8d2a761c83dd41e0923c8944d393901810c31f))
* **slice-24-ux:** MentionPopover scrollIntoView on selection change ([ca69042](https://github.com/MichelePolo/Aether/commit/ca69042e3c3dbec71b6a10c209e1d48ab7692d20))
* **slice-24-ux:** MessageBubble streaming-perf path + max-w 65ch + emoji a11y ([d86fc20](https://github.com/MichelePolo/Aether/commit/d86fc20f96aef5c48eda521b6de8379f68f590ae))
* **slice-24-ux:** MessageContextMenu viewport clamp + role=menu/menuitem ([e92c11b](https://github.com/MichelePolo/Aether/commit/e92c11b0d987ff1c652fda6a164d67f238cd723f))
* **slice-24-ux:** MessageInput auto-grow textarea + token counter chip ([e271859](https://github.com/MichelePolo/Aether/commit/e27185925d24853b548bed234a8575cff9f756f4))
* **slice-24-ux:** MessageList role=log aria-live + content-visibility on bubbles ([93f6bf4](https://github.com/MichelePolo/Aether/commit/93f6bf40fd552e219aa96eae629a85435ec66ad0))
* **slice-24-ux:** Modal rebuilt on native &lt;dialog&gt; + focus restore + body lock + ESC fallback ([85884d0](https://github.com/MichelePolo/Aether/commit/85884d08a4c791f4bc0b5d2f88ac858af5ad98e3))
* **slice-24-ux:** palette backdrop-blur + Esc-hint + kbd shortcut chips ([817ba36](https://github.com/MichelePolo/Aether/commit/817ba36495a3c12c9b94ac59ff8e37d2afd1f8da))
* **slice-24-ux:** ProfilesModal Button primitives + role=alert + empty state + delete copy ([b0846cc](https://github.com/MichelePolo/Aether/commit/b0846cc7f37d78485f1c84ae0036913b733228b0))
* **slice-24-ux:** ProviderAuth status dot aria-label + BuiltinMcp toggle role=switch ([7719a1c](https://github.com/MichelePolo/Aether/commit/7719a1cc246bd1aa073012e78bb4b048b977717a))
* **slice-24-ux:** ProviderSelector capabilities suffix + TokenChip aria-label + StatusDot role=img+aria-label ([dc8a4d4](https://github.com/MichelePolo/Aether/commit/dc8a4d450c9e3d24bacb8c78bbc976940468a199))
* **slice-24-ux:** ReasoningDrawer slide transition + ConfidenceBar progressbar + LiveThinking aria-live ([2392bce](https://github.com/MichelePolo/Aether/commit/2392bce19ce8e25fd7964dc33c5a8c7e497c1ae2))
* **slice-24-ux:** SessionsSection lucide icons + role=alert + aria-current + focus-within reveal ([2b5faa1](https://github.com/MichelePolo/Aether/commit/2b5faa1aba4a9d815cc2046448555202d3e96535))
* **slice-24-ux:** shared focus-visible ring on Button + IconButton ([dd894fc](https://github.com/MichelePolo/Aether/commit/dd894fc3aceebdc86f9656872e44dedba122200a))
* **slice-24-ux:** Sidebar thin custom scrollbar + AppShell test for hidden-but-mounted sidebar ([9ebf6a8](https://github.com/MichelePolo/Aether/commit/9ebf6a81144c4e2a60863e4e4f708aaa1964f46e))
* **slice-24-ux:** skip-link + drop role=main + sidebar stays mounted + id=message-input ([7a9078c](https://github.com/MichelePolo/Aether/commit/7a9078c000d200d228dbf48e8efb18c79b1d6f8b))
* **slice-24-ux:** Tooltip rewrite — focus-aware, Escape-dismissible ([b684938](https://github.com/MichelePolo/Aether/commit/b684938cf4ba7a29e1dd32c89c2ac5577ea74f57))
* **slice-24-ux:** TopBar ml-auto right cluster + Cmd+K chip ([40cc262](https://github.com/MichelePolo/Aether/commit/40cc2622b7b54ce879707a524ab5a6cb206bcada))
* **slice-24-ux:** WorkspaceBrowserModal — Modal migration + breadcrumb + kbd nav + unsaved guard ([2197900](https://github.com/MichelePolo/Aether/commit/21979008cac512017eb5162b6105150d9fe5b68a))
* **slice-24-ux:** WorkspacesSection rename + left-truncate path + active indicator + delete confirm ([da88c41](https://github.com/MichelePolo/Aether/commit/da88c41281e7aca0e694bf54d656df60cee0aafe))
* **slice-24-ux:** wrap setActive in startViewTransition for smooth session swap ([856ba25](https://github.com/MichelePolo/Aether/commit/856ba256104d91ffa964b8838bd80a26fd580c04))
* **slice-24:** headless daemon + aether CLI ([#40](https://github.com/MichelePolo/Aether/issues/40)) ([51b2be3](https://github.com/MichelePolo/Aether/commit/51b2be3f260496360817f2db964c9f73d15ac4f2))
* **slice-25:** multi-agent swarms (linear DSL, per-step approval, SSE run) ([#44](https://github.com/MichelePolo/Aether/issues/44)) ([90e2f37](https://github.com/MichelePolo/Aether/commit/90e2f37ea0073b0751afad37b977867734a548c8))
* **slice-26:** test-driven auto-resolution loop ([#46](https://github.com/MichelePolo/Aether/issues/46)) ([8e838ab](https://github.com/MichelePolo/Aether/commit/8e838ab7d502642c64f1ad0347d0b136b26fad00))
* **slice-27:** git api client + lazy Zustand store ([a306bba](https://github.com/MichelePolo/Aether/commit/a306bba67fbdc994dc36c1ebb514fbeca104f447))
* **slice-27:** git HTTP routes + app wiring ([db03dea](https://github.com/MichelePolo/Aether/commit/db03dead2a3cda8b6a89db3052304881adae2cb8))
* **slice-27:** git swimlanes view components ([198a939](https://github.com/MichelePolo/Aether/commit/198a939c8868df2d09d689f35c5b70241c4c2d0f))
* **slice-27:** GitService (status/log/diff, workspace-rooted) ([85a38a1](https://github.com/MichelePolo/Aether/commit/85a38a1a10e7fb23fb1b392dd2df76bd563e9e63))
* **slice-27:** History view navigation (TopBar toggle + mainView) ([b87ded9](https://github.com/MichelePolo/Aether/commit/b87ded9d0b43630f79866d1be99e836889cf3037))
* **slice-27:** i18n strings, a11y polish, runner defensive-path tests ([831705d](https://github.com/MichelePolo/Aether/commit/831705dd80fe900d42832b3ce6716c33cd90f3bd))
* **slice-27:** pure git-swimlanes logic (parse/lanes/color/pr/layout/diff) ([9868a89](https://github.com/MichelePolo/Aether/commit/9868a899f0d615dfa3e30447db3b7c4e11270a5a))
* **slice-27:** safe read-only git runner (allowlist, no shell) ([6aec454](https://github.com/MichelePolo/Aether/commit/6aec454794ed4c6a8e9e3d869412fe8c98d45bb6))
* **slice-2a:** real streaming chat (single-session) ([#3](https://github.com/MichelePolo/Aether/issues/3)) ([3a2a577](https://github.com/MichelePolo/Aether/commit/3a2a577ee01a537a65ac27f9831c1899da2abf4c))
* **slice-2b:** multi-session chat ([#4](https://github.com/MichelePolo/Aether/issues/4)) ([9ae1c43](https://github.com/MichelePolo/Aether/commit/9ae1c434885ff3b5da5c78c027e320f34d93175b))
* **slice-3:** real reasoning steps + Gemini thinking ([#5](https://github.com/MichelePolo/Aether/issues/5)) ([90a8b3c](https://github.com/MichelePolo/Aether/commit/90a8b3c5b168b92a0e5b59ecbff8c2b03e852f4a))
* **slice-4:** profiles + import/export ([#6](https://github.com/MichelePolo/Aether/issues/6)) ([0231bad](https://github.com/MichelePolo/Aether/commit/0231bad2ea78bbe870a8368d10b847fe53d866c0))
* **slice-5:** command palette + shortcuts ([#8](https://github.com/MichelePolo/Aether/issues/8)) ([839fa60](https://github.com/MichelePolo/Aether/commit/839fa6046ea32092991b09ee9e6b7c46ebd59355))
* **slice-6:** sub-agent dispatch ([#9](https://github.com/MichelePolo/Aether/issues/9)) ([e6d5c63](https://github.com/MichelePolo/Aether/commit/e6d5c6311963b59bdc72f522f4fddd12bf12912c))
* **slice-7:** MCP mock + stdio client + tool-call loop ([#12](https://github.com/MichelePolo/Aether/issues/12)) ([efca00d](https://github.com/MichelePolo/Aether/commit/efca00d8f776d7ad8c750c027e11ce94fff34cf1))
* **slice-8:** Ollama provider + multi-provider selection ([#13](https://github.com/MichelePolo/Aether/issues/13)) ([65c1acb](https://github.com/MichelePolo/Aether/commit/65c1acb18dbdf93275a816812db19879bf42ffb5))
* **slice-9:** sub-agent skills/tools editor ([#14](https://github.com/MichelePolo/Aether/issues/14)) ([741c3b9](https://github.com/MichelePolo/Aether/commit/741c3b90cc012457360cd8e766daae3f312c6c9d))
* **theme:** 'Spettro Invisibile' distinctive visual identity ([b87ca1c](https://github.com/MichelePolo/Aether/commit/b87ca1c61b237f96b8e9c5f3f44f73ae37e5e2b7))
* **theme:** disclosure accents for reasoning & confidence ([ab4ca18](https://github.com/MichelePolo/Aether/commit/ab4ca183e3dce1a85e60fcf2949d42d783b6493b))
* **theme:** glass + hover-glow utilities; disclosure scrollbar ([7f51586](https://github.com/MichelePolo/Aether/commit/7f51586022db970f7f76ccc1cf650ed64f652515))
* **theme:** remap chat accents (manipulation actions / disclosure reveals) ([fb5f7f6](https://github.com/MichelePolo/Aether/commit/fb5f7f6145e19f6c38b0b52477c0bce9f8a04109))
* **theme:** remap modals & UI primitives; update Button color assertion ([9956370](https://github.com/MichelePolo/Aether/commit/9956370d835f2c34c94c3bfea9ed02d581cae4fc))
* **theme:** remap sidebar accents (disclosure selections / manipulation controls) ([4b8c4d7](https://github.com/MichelePolo/Aether/commit/4b8c4d7e492ed215bfff3dd48fde23a9c1b2952c))
* **theme:** Spettro Invisibile tokens (zinc surfaces + 3 semantic accents) ([d65628a](https://github.com/MichelePolo/Aether/commit/d65628a9d941f43e213b6c38ef359f9bfc4858c9))
* **theme:** subtle glassmorphism on top bars and overlays ([252778b](https://github.com/MichelePolo/Aether/commit/252778b9e67a953c5d66687ece53acaa595c0820))


### Bug Fixes

* **anthropic:** allow tools at server scope so Aether's gate fires ([38d0ce9](https://github.com/MichelePolo/Aether/commit/38d0ce90f5316c0b621b4dbd79eba07fd2680b31))
* **anthropic:** isolate spawned agent to Aether tools; fix thinking label ([d2bd77c](https://github.com/MichelePolo/Aether/commit/d2bd77ce80071a0087e111a3e1a84e18a514f810))
* **anthropic:** SDK-driven agentic loop with user-only prompt + runToolCall bridge ([82b75bd](https://github.com/MichelePolo/Aether/commit/82b75bd2d3cf8e7a488319e72ae34cd62f1710af))
* **anthropic:** SDK-driven agentic tool loop (chat + tools via Claude OAuth) ([88d7a0a](https://github.com/MichelePolo/Aether/commit/88d7a0a982844ae60a62222a754dc977d2320b8b))
* app title → "Aether Core" ([8dad7ef](https://github.com/MichelePolo/Aether/commit/8dad7ef9cb7e9df603f1af8f6acb83ca90549324))
* **chat:** Claude-style composer with aligned bottom toolbar ([45829ba](https://github.com/MichelePolo/Aether/commit/45829bafccfa938024c79f149ab74a210dc9b3db))
* **chat:** pin input to bottom, scrollable thread, WhatsApp-style bubbles ([6562592](https://github.com/MichelePolo/Aether/commit/6562592adda1d783b7026eb2285464b94a7ac2c0))
* **dispatch:** emit done fallback, clarify shared cap, test tool cap ([8cad87e](https://github.com/MichelePolo/Aether/commit/8cad87e1333dcf1d33ece14c6d2cf1c60bbf0a78))
* e2e selectors + wire subAgentsStore into DispatchService ([#10](https://github.com/MichelePolo/Aether/issues/10)) ([1c2aeab](https://github.com/MichelePolo/Aether/commit/1c2aeabbf89be1916881fa9e6434a751ff7f7003))
* **layout:** align all three top bars to the main TopBar height (h-12) ([63ba72d](https://github.com/MichelePolo/Aether/commit/63ba72d3d8cbb9ce6bccf466283db6f9d153eddb))
* **mcp,workspaces:** spec-compliant stdio handshake + absolute-path browsing + enable rollback ([5c19761](https://github.com/MichelePolo/Aether/commit/5c19761ab93df37e329a537ac0906b5cc9f923ce))
* **mcp:** launch Terminal builtin via tsx loader in dev; bundle aether-shell in build ([bc2177c](https://github.com/MichelePolo/Aether/commit/bc2177c4156e29fffaab7e4fd08c0879fc8115e2))
* **mcp:** Terminal builtin launches in dev (tsx loader) + bundled in build ([98efa19](https://github.com/MichelePolo/Aether/commit/98efa19185e5071485bc020dd4792e6c13746925))
* **ollama:** bound+parallelize discovery, guard providerAuth merge on empty arrays ([390a63d](https://github.com/MichelePolo/Aether/commit/390a63d1b18a816e1fbf317330e58c1ec745ce1d))
* **palette:** correct overlay positioning + release focus trap before opening child dialogs ([#22](https://github.com/MichelePolo/Aether/issues/22)) ([9eef826](https://github.com/MichelePolo/Aether/commit/9eef826de08935e1c738d4c0d0842c83b9d83a2e))
* **providers:** Anthropic auth reliability on Windows + registry/auth self-heal ([#49](https://github.com/MichelePolo/Aether/issues/49)) ([83ebe4c](https://github.com/MichelePolo/Aether/commit/83ebe4c82005ed2afa8311fd5a3dc22c7c9fb037))
* **slice-24-ux:** resolve workspace-add 400s, MCP handshake, and drawer a11y ([b208853](https://github.com/MichelePolo/Aether/commit/b208853eca698e27ad4d8a96b6886239bd0b0f21))
* **slice-24.1:** runnable production server bundle + smoke CI ([#42](https://github.com/MichelePolo/Aether/issues/42)) ([262d4b0](https://github.com/MichelePolo/Aether/commit/262d4b0a5ca922db1fdc6acfbe3f97a689455a0c))
* **theme:** disclosure on reasoning chip at rest; CLI-green mono for code blocks ([7acc8e1](https://github.com/MichelePolo/Aether/commit/7acc8e16136a561da32652f7edddb62a63feb126))
* **theme:** make glass override bg utility; manipulation hover on server controls; glass all modals ([2246c40](https://github.com/MichelePolo/Aether/commit/2246c40994616156c5a4562a934976e664517367))
* **theme:** restore manipulation accent to electric orange ([4e288b0](https://github.com/MichelePolo/Aether/commit/4e288b002a38e70582802fc491dae78c578d6043))
* **theme:** restore manipulation accent to electric orange (#FF6D00) ([2977942](https://github.com/MichelePolo/Aether/commit/2977942c0ccaff538319d6a4863abdf29dad588e))
* **theme:** soften breakpoint toggle to match On/Off (tinted manipulation, not solid) ([ac1a56f](https://github.com/MichelePolo/Aether/commit/ac1a56f70ccbdbb9f3346e555408d491876a5131))
* **ui:** wrap tooltip + clip sidebar overflow-x (no horizontal scrollbar) ([dcfffc7](https://github.com/MichelePolo/Aether/commit/dcfffc73d97077e2b7ed2e404d8712ad83412c80))


### Miscellaneous Chores

* pin first release to 0.1.0 ([#57](https://github.com/MichelePolo/Aether/issues/57)) ([e675288](https://github.com/MichelePolo/Aether/commit/e675288bb67aaf6379bc60f9af0705b3eefbfe16))
