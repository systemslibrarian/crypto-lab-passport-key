/**
 * Byte helpers shared by every module in this directory.
 *
 * Nothing here is cryptographic; it exists so the modules that ARE can be read
 * without a paragraph of index arithmetic in the middle of the interesting
 * part. `toHex` is the one function the UI leans on hardest — every value on
 * screen in this lab is a byte string, and the standard prints them in upper
 * case, so this does too and the tests compare against the standard's own
 * spelling rather than a lower-cased copy of it.
 */

/** Uppercase hex, no separators — the spelling ICAO Doc 9303 Part 11 prints. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0').toUpperCase();
  return out;
}

/** Parse hex, ignoring ASCII whitespace. Throws on anything else. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new Error(`hex string has an odd length: ${clean.length}`);
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('hex string has a non-hex character');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * ASCII encode. The MRZ is defined over a restricted ASCII subset (digits,
 * A-Z and the filler `<`), so a code point above 0x7F means the caller built
 * an MRZ string that no document could carry — a programming error worth a
 * throw rather than a silent `?`.
 */
export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) throw new Error(`non-ASCII character ${JSON.stringify(text[i])} at ${i}`);
    out[i] = code;
  }
  return out;
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** XOR two equal-length byte strings. Used for the session key seed. */
export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error(`xor length mismatch: ${a.length} vs ${b.length}`);
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * Compare two byte strings in a way that does not stop at the first
 * difference.
 *
 * This lab is not a timing-attack demo and a browser offers no real guarantee
 * of constant time, so the claim here is narrow and worth stating plainly: the
 * loop covers EVERY byte. That is what invariant 5 is about — "MAC comparison
 * covers all 8 bytes" — and it is the property mutation 12 attacks by
 * comparing only the first four. An early `return false` would make that
 * mutation invisible to a functional test, because a wrong MAC is still
 * rejected either way; it is the SEARCH, which must not accept a 4-byte
 * collision, that notices.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Group hex into byte pairs for display: `AB94FDEC` -> `AB 94 FD EC`. */
export function groupHex(hex: string, perGroup = 1): string {
  const chars = perGroup * 2;
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += chars) groups.push(hex.slice(i, i + chars));
  return groups.join(' ');
}
