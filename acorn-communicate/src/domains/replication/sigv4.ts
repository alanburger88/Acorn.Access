/**
 * Minimal AWS Signature Version 4 signer for S3-compatible PUT/GET over
 * `fetch`, built only on node:crypto. Implements the four documented steps:
 * canonical request → string to sign → signing key derivation → signature.
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 */
import { createHash, createHmac } from 'node:crypto';

const sha256Hex = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

/**
 * S3-flavoured URI encoding: percent-encode every byte except the unreserved
 * set A-Za-z0-9 - . _ ~ (and '/' when encoding a path, where segment
 * separators must survive). Hex digits are uppercase per the SigV4 spec.
 */
export function uriEncode(input: string, keepSlash: boolean): string {
  let out = '';
  for (const ch of input) {
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === '/')) {
      out += ch;
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) {
        out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}

/**
 * Step 3 — signing key derivation:
 *   kDate    = HMAC("AWS4" + secretKey, dateStamp)   // dateStamp = YYYYMMDD
 *   kRegion  = HMAC(kDate, region)
 *   kService = HMAC(kRegion, service)
 *   kSigning = HMAC(kService, "aws4_request")
 * Exported so tests can verify against the official AWS known-answer vector.
 */
export function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface SignRequestArgs {
  method: string;
  url: URL;
  /** Extra headers to send (e.g. content-type); all are included in signing. */
  headers: Record<string, string>;
  /** Hex sha256 of the request payload ('' payload → sha256 of empty string). */
  payloadSha256: string;
  accessKey: string;
  secretKey: string;
  region: string;
  service?: 's3';
}

/**
 * Sign a request and return the complete header set to send: the caller's
 * headers plus host, x-amz-date, x-amz-content-sha256 and authorization.
 */
export function signRequest(args: SignRequestArgs): Record<string, string> {
  const service = args.service ?? 's3';
  // x-amz-date is ISO8601 basic format: YYYYMMDD'T'HHMMSS'Z'
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);

  // Every header we send is signed (host is set by fetch to the same value).
  const sent: Record<string, string> = {
    ...args.headers,
    host: args.url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': args.payloadSha256,
  };

  // Step 1 — canonical request.
  // Path: decode any URL-object encoding, then re-encode per S3 rules ('/' kept).
  const canonicalUri = uriEncode(decodeURIComponent(args.url.pathname), true) || '/';
  // Query: encode keys and values, then sort by key (ties broken by value).
  const canonicalQuery = [...args.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  // Headers: lowercase names, trimmed/collapsed values, sorted by name.
  const lower: Record<string, string> = {};
  for (const [name, value] of Object.entries(sent)) {
    lower[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  const signedHeaderNames = Object.keys(lower).sort();
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${lower[n]!}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    args.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    args.payloadSha256,
  ].join('\n');

  // Step 2 — string to sign.
  const scope = `${dateStamp}/${args.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  // Steps 3+4 — derive the signing key and compute the signature.
  const signingKey = deriveSigningKey(args.secretKey, dateStamp, args.region, service);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    ...sent,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${args.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
