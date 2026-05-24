import { messages, type MessageMap } from './en';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends object
    ? Leaves<T[K], `${P}${K}.`>
    : `${P}${K}`;
}[keyof T & string];

export type TKey = Leaves<MessageMap>;

function walk(obj: unknown, parts: string[]): unknown {
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function t(key: TKey, vars?: Record<string, string | number>): string {
  const value = walk(messages, key.split('.'));
  if (typeof value !== 'string') {
    if (import.meta.env.MODE !== 'production') {
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
