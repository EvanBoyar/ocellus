// Encoding helpers shared by the whole app. No dependencies, runs in
// both the browser and Node.

// Crockford base32 alphabet. Skips I, L, O, U so codes stay readable
// when printed and hand-typed.
export const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function bytesToB32(bytes, chars) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= chars) return out.slice(0, chars);
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.slice(0, chars);
}

export function intToB32(n, width) {
  let out = '';
  do {
    out = B32[n & 31] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  while (out.length < width) out = '0' + out;
  return out;
}

export function b32ToInt(s) {
  let n = 0;
  for (const ch of normalizeB32(s)) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    n = n * 32 + v;
  }
  return n;
}

// Accepts hand-typed codes: uppercases and maps easily-confused
// characters onto the Crockford canonical ones.
export function normalizeB32(s) {
  return s.toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V')
    .replace(/[^0-9A-Z]/g, '');
}

export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function utf8Encode(s) {
  return new TextEncoder().encode(s);
}

export function utf8Decode(bytes) {
  return new TextDecoder().decode(bytes);
}

// JSON with object keys sorted at every level, so the same data always
// produces the same string. Needed for election IDs and the EIC.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]));
  return '{' + parts.join(',') + '}';
}

// Text-string envelope for anything the user copy/pastes around.
// Format: OC<kind>1.<base64 of utf-8 JSON>
export function packString(kind, obj) {
  const json = JSON.stringify(obj);
  return 'OC' + kind + '1.' + bytesToBase64(utf8Encode(json));
}

export function unpackString(kind, str) {
  const cleaned = str.trim().replace(/\s+/g, '');
  const prefix = 'OC' + kind + '1.';
  if (!cleaned.startsWith(prefix)) return null;
  try {
    return JSON.parse(utf8Decode(base64ToBytes(cleaned.slice(prefix.length))));
  } catch {
    return null;
  }
}

// Groups a code like K7Q2M9XF into K7Q2-M9XF for readability.
export function groupCode(code, size = 4) {
  const out = [];
  for (let i = 0; i < code.length; i += size) out.push(code.slice(i, i + size));
  return out.join('-');
}
