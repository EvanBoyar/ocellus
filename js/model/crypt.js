// Thin wrappers over WebCrypto. Everything is async because
// crypto.subtle is async. Works in browsers and Node 19+.

import { bytesToB32, utf8Encode } from './codec.js';

const subtle = globalThis.crypto.subtle;

export function randomBytes(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export async function sha256(data) {
  const bytes = typeof data === 'string' ? utf8Encode(data) : data;
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}

export async function hmacSha256(keyBytes, message) {
  const key = await subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const msg = typeof message === 'string' ? utf8Encode(message) : message;
  return new Uint8Array(await subtle.sign('HMAC', key, msg));
}

// Short human-readable digest: first `chars` base32 characters of a
// SHA-256 hash.
export async function shortHash(data, chars) {
  return bytesToB32(await sha256(data), chars);
}
