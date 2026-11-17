/**
 * SHA-1, per FIPS 180-4 — hand-rolled, and synchronous.
 *
 * ## Why this is not WebCrypto
 *
 * `crypto.subtle.digest('SHA-1', …)` returns a Promise, and the offline search
 * in exhibit 5 needs two hashes per candidate inside a tight loop. Measured on
 * this machine over 60,000 digests of a 24-byte MRZ_information string:
 *
 *   crypto.subtle.digest   9,095 hashes/sec   (110 us per call)
 *   this function        610,075 hashes/sec   (1.64 us per call)
 *
 * At 110 us a call the per-call promise machinery, not the compression
 * function, sets the rate: two hashes per guess caps the search near 4,500
 * guesses/sec — slower than the single-threaded Python reference the brief
 * cites at ~25,000 — and every DES operation in the retail MAC would then be
 * free by comparison. The exhibit would be measuring Promise overhead and
 * calling it the cost of guessing a passport number. So the hash is written
 * out here.
 *
 * ## What makes that honest
 *
 * `sha1.test.ts` pins this implementation two ways, and the second is the one
 * that matters: the FIPS 180-4 known answers, AND a differential test against
 * `crypto.subtle.digest` over hundreds of random inputs spanning every
 * padding boundary (55/56/63/64/119/120 bytes, where the message-length block
 * is forced to spill). "SHA-1 comes from WebCrypto" becomes "SHA-1 agrees with
 * WebCrypto, asserted on every run" — which is a stronger claim than using the
 * platform in one code path and something else in the other.
 *
 * NOT PRODUCTION CRYPTOGRAPHY. SHA-1 is collision-broken (SHAttered, 2017) and
 * must not be used for signatures or integrity today. It is here because ICAO
 * Doc 9303 Part 11 Section 9.7.1.1 specifies it for this key derivation, and
 * the point of the lab is what that derivation does and does not buy. No part
 * of this lab depends on SHA-1's collision resistance.
 */

const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6] as const;

/** SHA-1 of `bytes`, as 20 bytes. */
export function sha1(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;

  // FIPS 180-4 section 5.1.1: append 0x80, then zeros, so that the length
  // leaves exactly 8 bytes at the end of the final 64-byte block.
  const blocks = ((bytes.length + 8) >> 6) + 1;
  const w32 = new Uint32Array(blocks * 16);
  for (let i = 0; i < bytes.length; i++) {
    w32[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  }
  w32[bytes.length >> 2] |= 0x80 << (24 - (bytes.length & 3) * 8);
  // The high word of the 64-bit length stays zero: this lab hashes at most a
  // few dozen bytes, so a message long enough to need it cannot arise here.
  // `Math.floor` rather than a shift, because a shift would wrap at 2^32 bits.
  w32[blocks * 16 - 2] = Math.floor(bitLength / 0x100000000);
  w32[blocks * 16 - 1] = bitLength >>> 0;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  for (let block = 0; block < blocks; block++) {
    for (let i = 0; i < 16; i++) w[i] = w32[block * 16 + i];
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = K[0];
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = K[1];
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = K[2];
      } else {
        f = b ^ c ^ d;
        k = K[3];
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const h = [h0, h1, h2, h3, h4];
  for (let i = 0; i < 5; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}
