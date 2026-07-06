import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical/jcs.js';

describe('canonicalize (RFC 8785 subset)', () => {
  it('sorts object keys lexicographically', () => {
    expect(canonicalize({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it('sorts keys recursively', () => {
    expect(canonicalize({ z: { y: 1, x: 2 }, a: [{ b: 1, a: 0 }] })).toBe(
      '{"a":[{"a":0,"b":1}],"z":{"x":2,"y":1}}',
    );
  });

  it('is stable regardless of insertion order', () => {
    const a = { one: 1, two: { deep: true, arr: [1, 2] } };
    const b = { two: { arr: [1, 2], deep: true }, one: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('serializes primitives like JSON.stringify', () => {
    expect(canonicalize('héllo "quoted"')).toBe(JSON.stringify('héllo "quoted"'));
    expect(canonicalize(0.1)).toBe('0.1');
    expect(canonicalize(1e21)).toBe('1e+21');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(null)).toBe('null');
  });

  it('omits undefined object members and nullifies undefined array members', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('rejects non-finite numbers and non-JSON values', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(Infinity)).toThrow(TypeError);
    expect(() => canonicalize(() => 1)).toThrow(TypeError);
    expect(() => canonicalize(10n as unknown)).toThrow(TypeError);
  });
});
