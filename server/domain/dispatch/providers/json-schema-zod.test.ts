import { jsonSchemaToZod } from './json-schema-zod';

/**
 * These tests pin the coercion contract the Claude Agent SDK relies on: the SDK
 * validates tool args with `safeParseAsync` and feeds the PARSED (coerced) data
 * to the handler. So `.parse()` returning the right JS type IS the behavior that
 * fixes "array/number args arrive as strings and are rejected by the downstream
 * MCP server".
 */
describe('jsonSchemaToZod', () => {
  it('coerces a stringified number to a number', () => {
    const zt = jsonSchemaToZod({ type: 'number' });
    expect(zt.parse('5')).toBe(5);
    expect(zt.parse(5)).toBe(5);
  });

  it('coerces a stringified integer to a number', () => {
    const zt = jsonSchemaToZod({ type: 'integer' });
    expect(zt.parse('42')).toBe(42);
  });

  it('coerces a JSON-stringified array to an array', () => {
    const zt = jsonSchemaToZod({ type: 'array', items: { type: 'string' } });
    expect(zt.parse('["a","b"]')).toEqual(['a', 'b']);
  });

  it('accepts a real array unchanged', () => {
    const zt = jsonSchemaToZod({ type: 'array', items: { type: 'string' } });
    expect(zt.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('recursively coerces array items (array of numbers from strings)', () => {
    const zt = jsonSchemaToZod({ type: 'array', items: { type: 'number' } });
    expect(zt.parse(['1', '2'])).toEqual([1, 2]);
  });

  it('coerces stringified booleans', () => {
    const zt = jsonSchemaToZod({ type: 'boolean' });
    expect(zt.parse('true')).toBe(true);
    expect(zt.parse('false')).toBe(false);
    expect(zt.parse(true)).toBe(true);
  });

  it('keeps strings as strings', () => {
    const zt = jsonSchemaToZod({ type: 'string' });
    expect(zt.parse('hello')).toBe('hello');
  });

  it('coerces a JSON-stringified object to an object', () => {
    const zt = jsonSchemaToZod({ type: 'object' });
    expect(zt.parse('{"a":1}')).toEqual({ a: 1 });
  });

  it('validates enum membership and rejects non-members', () => {
    const zt = jsonSchemaToZod({ type: 'string', enum: ['read', 'write'] });
    expect(zt.parse('read')).toBe('read');
    expect(() => zt.parse('delete')).toThrow();
  });

  it('handles nullable union types by using the first non-null type', () => {
    const zt = jsonSchemaToZod({ type: ['string', 'null'] });
    expect(zt.parse('x')).toBe('x');
  });

  it('accepts a single-member enum', () => {
    const zt = jsonSchemaToZod({ enum: ['only'] });
    expect(zt.parse('only')).toBe('only');
    expect(() => zt.parse('other')).toThrow();
  });

  it('falls back to passthrough for unknown/missing type', () => {
    const zt = jsonSchemaToZod({});
    expect(zt.parse({ anything: [1, 2] })).toEqual({ anything: [1, 2] });
    expect(zt.parse('whatever')).toBe('whatever');
  });

  it('leaves a malformed JSON string untouched for the inner schema to reject', () => {
    const zt = jsonSchemaToZod({ type: 'array', items: { type: 'string' } });
    // Not valid JSON and not an array -> inner z.array rejects, surfacing a real error.
    expect(() => zt.parse('not-json')).toThrow();
  });
});
