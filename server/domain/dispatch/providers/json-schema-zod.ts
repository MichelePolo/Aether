import { z } from 'zod';

/**
 * Convert one JSON-Schema property into a Zod type for the in-process MCP tools
 * Aether hands to the Claude Agent SDK.
 *
 * Two jobs at once, both required:
 *  1. **Advertise the real type to the model.** The SDK renders this Zod type to
 *     JSON Schema (via `pipeStrategy: 'input'`) and shows it to the model, so a
 *     `paths: string[]` param must surface as `type: array`, not the bare `{}`
 *     that `z.unknown()` produced. Without the type, the model emits the wrong
 *     shape (e.g. arrays/numbers as strings).
 *  2. **Coerce on parse.** The SDK validates args with `safeParseAsync` and feeds
 *     the PARSED value to the handler. So if a stringified array/number still
 *     slips through, coercion repairs it here instead of letting the downstream
 *     MCP server reject it. (Defense in depth — empirically both the array type
 *     AND the coercion survive the SDK's schema conversion; see json-schema-zod.test.ts.)
 */

interface JsonSchemaProp {
  type?: string | string[];
  items?: unknown;
  enum?: unknown[];
}

/** If the model emits a JSON-encoded string for a structured field (array/object),
 *  parse it; otherwise pass the value through for the inner schema to validate. */
function jsonish(inner: z.ZodType): z.ZodType {
  return z.preprocess((v) => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  }, inner);
}

/** A JSON-Schema `type` may be a union like `['string', 'null']`; pick the first
 *  meaningful (non-null) member. */
function primaryType(type: string | string[] | undefined): string | undefined {
  return Array.isArray(type) ? type.find((t) => t !== 'null') : type;
}

export function jsonSchemaToZod(prop: unknown): z.ZodType {
  if (!prop || typeof prop !== 'object') return z.unknown();
  const p = prop as JsonSchemaProp;

  if (Array.isArray(p.enum) && p.enum.length > 0) {
    const literals: z.ZodType[] = p.enum.map((v) => z.literal(v as never));
    return literals.length === 1
      ? literals[0]
      : z.union(literals as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }

  switch (primaryType(p.type)) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.coerce.number();
    case 'boolean':
      return z.preprocess(
        (v) => (v === 'true' ? true : v === 'false' ? false : v),
        z.boolean(),
      );
    case 'array':
      return jsonish(z.array(jsonSchemaToZod(p.items)));
    case 'object':
      return jsonish(z.record(z.string(), z.unknown()));
    default:
      return z.unknown();
  }
}
