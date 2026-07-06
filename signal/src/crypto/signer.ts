import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import { canonicalBytes } from '../canonical/jcs.js';
import { sha256Hex } from './hash.js';

export interface SignerKeys {
  /** PKCS#8 PEM. */
  privateKeyPem: string;
  /** SPKI PEM. */
  publicKeyPem: string;
  /** SHA-256 fingerprint (hex) of the SPKI DER public key. */
  keyId: string;
}

export function generateSignerKeys(): SignerKeys {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return keysFromObjects(privateKey, publicKey);
}

export function loadSignerKeys(privateKeyPem: string): SignerKeys {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  return keysFromObjects(privateKey, publicKey);
}

function keysFromObjects(privateKey: KeyObject, publicKey: KeyObject): SignerKeys {
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: sha256Hex(spkiDer),
  };
}

/**
 * Ed25519 signer over canonical JSON. The signed message is the RFC 8785
 * canonical form of the given value, so any holder of the public key can
 * re-derive the exact bytes independently.
 */
export class PacketSigner {
  private readonly privateKey: KeyObject;
  readonly keyId: string;
  readonly publicKeyPem: string;

  constructor(keys: SignerKeys) {
    this.privateKey = createPrivateKey(keys.privateKeyPem);
    this.keyId = keys.keyId;
    this.publicKeyPem = keys.publicKeyPem;
  }

  sign(value: unknown): string {
    return edSign(null, canonicalBytes(value), this.privateKey).toString('base64');
  }
}

export function verifySignature(
  value: unknown,
  signatureB64: string,
  publicKeyPem: string,
): boolean {
  try {
    return edVerify(
      null,
      canonicalBytes(value),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}
