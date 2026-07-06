import { describe, expect, it } from 'vitest';
import { hashCanonical, sha256Hex } from '../src/crypto/hash.js';
import { generateSignerKeys, loadSignerKeys, PacketSigner, verifySignature } from '../src/crypto/signer.js';

describe('hashing', () => {
  it('hashes canonical form, so logically equal objects hash equally', () => {
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
  });

  it('produces a known sha256', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('PacketSigner', () => {
  it('signs and verifies canonical JSON values', () => {
    const keys = generateSignerKeys();
    const signer = new PacketSigner(keys);
    const value = { hello: 'world', n: 42 };
    const sig = signer.sign(value);
    expect(verifySignature({ n: 42, hello: 'world' }, sig, keys.publicKeyPem)).toBe(true);
    expect(verifySignature({ n: 43, hello: 'world' }, sig, keys.publicKeyPem)).toBe(false);
  });

  it('fails verification with the wrong key', () => {
    const keys = generateSignerKeys();
    const other = generateSignerKeys();
    const sig = new PacketSigner(keys).sign({ x: 1 });
    expect(verifySignature({ x: 1 }, sig, other.publicKeyPem)).toBe(false);
  });

  it('round-trips keys through PEM and derives a stable keyId', () => {
    const keys = generateSignerKeys();
    const loaded = loadSignerKeys(keys.privateKeyPem);
    expect(loaded.keyId).toBe(keys.keyId);
    expect(loaded.publicKeyPem).toBe(keys.publicKeyPem);
  });

  it('returns false (not throws) for malformed signatures', () => {
    const keys = generateSignerKeys();
    expect(verifySignature({ x: 1 }, '!!!not-base64!!!', keys.publicKeyPem)).toBe(false);
    expect(verifySignature({ x: 1 }, 'AAAA', 'not a pem')).toBe(false);
  });
});
