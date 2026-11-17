import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from './bytes';
import {
  cbcDecrypt,
  cbcEncrypt,
  desDecryptBlock,
  desEncryptBlock,
  tripleDesKey,
  ZERO_IV,
} from './des';
import { E, FP, IP, P, PC1, PC2, SBOX, SHIFTS } from './destables';
import { TDES_CBC_TWO_KEY_CAVP } from './vectors';

/**
 * A second DES, written the slow obvious way.
 *
 * This is the oracle for the fast path in `des.ts`. It is a literal
 * transcription of FIPS 46-3: every permutation is a walk over the table in
 * `destables.ts` one output bit at a time, S and P are applied as two separate
 * steps, and nothing is precomputed. It is far too slow for the search in
 * exhibit 5 — which is why `des.ts` exists — but it is the version a reader
 * can check against the printed standard without trusting any derivation.
 *
 * `des.ts` derives byte-indexed permutation tables and a combined S-and-P
 * table from those same arrays at module load. That derivation is the part of
 * this lab most likely to be wrong by one bit, and a published test vector
 * cannot localise such an error — DES either matches `85E813540F0AB405` or it
 * does not. Comparing two independent implementations over random inputs can,
 * and does it on every run.
 */
function bitsOf(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (const b of bytes) for (let i = 7; i >= 0; i--) out.push((b >> i) & 1);
  return out;
}

function bytesOf(bits: readonly number[]): Uint8Array {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 1 << (7 - (i & 7));
  return out;
}

/** Output bit i takes the value of input bit `table[i]` (1-based). */
function walk(bits: readonly number[], table: readonly number[]): number[] {
  return table.map((src) => bits[src - 1]);
}

function slowSubkeys(key: Uint8Array): number[][] {
  const pc1 = walk(bitsOf(key), PC1);
  let c = pc1.slice(0, 28);
  let d = pc1.slice(28);
  const out: number[][] = [];
  for (const shift of SHIFTS) {
    c = c.slice(shift).concat(c.slice(0, shift));
    d = d.slice(shift).concat(d.slice(0, shift));
    out.push(walk(c.concat(d), PC2));
  }
  return out;
}

/** The round function f(R, K): expansion, XOR, the eight S-boxes, then P. */
function slowRoundFunction(right: readonly number[], subkey: readonly number[]): number[] {
  const expanded = walk(right, E).map((bit, i) => bit ^ subkey[i]);
  const sOut: number[] = [];
  for (let box = 0; box < 8; box++) {
    const chunk = expanded.slice(box * 6, box * 6 + 6);
    const row = chunk[0] * 2 + chunk[5];
    const col = chunk[1] * 8 + chunk[2] * 4 + chunk[3] * 2 + chunk[4];
    const value = SBOX[box][row * 16 + col];
    sOut.push((value >> 3) & 1, (value >> 2) & 1, (value >> 1) & 1, value & 1);
  }
  return walk(sOut, P);
}

function slowDes(key: Uint8Array, input: Uint8Array, decrypt = false): Uint8Array {
  const subkeys = slowSubkeys(key);
  if (decrypt) subkeys.reverse();
  const permuted = walk(bitsOf(input), IP);
  let left = permuted.slice(0, 32);
  let right = permuted.slice(32);
  for (const subkey of subkeys) {
    const next = left.map((bit, i) => bit ^ slowRoundFunction(right, subkey)[i]);
    left = right;
    right = next;
  }
  return bytesOf(walk(right.concat(left), FP));
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

describe('DES, against FIPS 46-3', () => {
  // The single-block vector the brief supplies, and the one most widely
  // reproduced for DES. Key 133457799BBCDFF1 is the worked example whose
  // intermediate values appear in most descriptions of the cipher.
  it('encrypts the standard worked-example block', () => {
    const key = fromHex('133457799BBCDFF1');
    expect(toHex(desEncryptBlock(key, fromHex('0123456789ABCDEF')))).toBe('85E813540F0AB405');
  });

  it('decrypts it back', () => {
    const key = fromHex('133457799BBCDFF1');
    expect(toHex(desDecryptBlock(key, fromHex('85E813540F0AB405')))).toBe('0123456789ABCDEF');
  });

  it('round-trips random blocks under random keys', () => {
    for (let i = 0; i < 64; i++) {
      const key = randomBytes(8);
      const block = randomBytes(8);
      expect(toHex(desDecryptBlock(key, desEncryptBlock(key, block)))).toBe(toHex(block));
    }
  });
});

describe('the fast tables agree with a literal walk of the printed tables', () => {
  // This is the test that makes `des.ts`'s precomputation trustworthy. See the
  // comment on `slowDes` above for why a published vector is not enough.
  it('matches the slow implementation on the published vector', () => {
    const key = fromHex('133457799BBCDFF1');
    const block = fromHex('0123456789ABCDEF');
    expect(toHex(slowDes(key, block))).toBe(toHex(desEncryptBlock(key, block)));
  });

  it('matches on 48 random key/block pairs, both directions', () => {
    for (let i = 0; i < 48; i++) {
      const key = randomBytes(8);
      const block = randomBytes(8);
      expect(toHex(desEncryptBlock(key, block))).toBe(toHex(slowDes(key, block)));
      expect(toHex(desDecryptBlock(key, block))).toBe(toHex(slowDes(key, block, true)));
    }
  });

  it('matches on keys and blocks of all zeros and all ones', () => {
    for (const key of [new Uint8Array(8), new Uint8Array(8).fill(0xff)]) {
      for (const block of [new Uint8Array(8), new Uint8Array(8).fill(0xff)]) {
        expect(toHex(desEncryptBlock(key, block))).toBe(toHex(slowDes(key, block)));
      }
    }
  });

  it('ignores the parity bits, as PC-1 discards them', () => {
    // PC-1 selects 56 of the 64 key bits and never names bits 8, 16, ... 64.
    // So flipping any parity bit cannot change a ciphertext. This is exactly
    // why the parity adjustment in kdf.ts is visible only in the printed KEY
    // and never in a cryptogram.
    const key = fromHex('133457799BBCDFF1');
    const flipped = new Uint8Array(key);
    for (let i = 0; i < 8; i++) flipped[i] ^= 0x01;
    const block = fromHex('0123456789ABCDEF');
    expect(toHex(desEncryptBlock(flipped, block))).toBe(toHex(desEncryptBlock(key, block)));
  });
});

describe('two-key Triple-DES in CBC mode, against NIST CAVP', () => {
  /**
   * The ten multi-block vectors from NIST's CAVP TDES Multiblock Message Test
   * for CBC (`TCBCMMT2.rsp`, the two-key file: KEY3 equals KEY1 in every
   * case). They run from one block to ten, so the chaining is exercised well
   * past the four blocks this lab's cryptograms occupy, and they carry a
   * NON-ZERO IV — which is what makes them an independent check on the IV
   * handling that Part 11 then pins to all zeros.
   */
  it('reproduces all ten CAVP vectors in both directions', () => {
    expect(TDES_CBC_TWO_KEY_CAVP.length).toBe(10);
    for (const v of TDES_CBC_TWO_KEY_CAVP) {
      const key = tripleDesKey(fromHex(v.key1 + v.key2));
      const iv = fromHex(v.iv);
      expect(toHex(cbcEncrypt(key, fromHex(v.plaintext), iv)), `encrypt COUNT ${v.count}`).toBe(
        v.ciphertext.toUpperCase()
      );
      expect(toHex(cbcDecrypt(key, fromHex(v.ciphertext), iv)), `decrypt COUNT ${v.count}`).toBe(
        v.plaintext.toUpperCase()
      );
    }
  });

  it('spans more than one block in at least one vector', () => {
    // The brief asks for a multi-block vector specifically: a single-block CBC
    // case would not exercise the chaining at all.
    const longest = Math.max(...TDES_CBC_TWO_KEY_CAVP.map((v) => v.plaintext.length / 16));
    expect(longest).toBeGreaterThanOrEqual(10);
  });

  it('refuses a plaintext that is not a whole number of blocks', () => {
    // Part 11 Section 4.3.3.1: "Padding for the input data MUST NOT be used."
    const key = tripleDesKey(fromHex('AB94FDECF2674FDFB9B391F85D7F76F2'));
    expect(() => cbcEncrypt(key, new Uint8Array(7))).toThrow(/whole blocks/);
  });

  it('refuses an IV that is not 8 bytes', () => {
    const key = tripleDesKey(fromHex('AB94FDECF2674FDFB9B391F85D7F76F2'));
    expect(() => cbcEncrypt(key, new Uint8Array(8), new Uint8Array(7))).toThrow(/IV is 8 bytes/);
  });

  it('is a two-key construction: K1 ‖ K2 means E_K1(D_K2(E_K1(x)))', () => {
    // Asserted against the single-DES primitive directly, so the triple
    // structure is checked rather than assumed from the CAVP vectors.
    const k1 = fromHex('0123456789ABCDEF');
    const k2 = fromHex('FEDCBA9876543210');
    const block = fromHex('0011223344556677');
    const expected = desEncryptBlock(k1, desDecryptBlock(k2, desEncryptBlock(k1, block)));
    const key = tripleDesKey(new Uint8Array([...k1, ...k2]));
    expect(toHex(cbcEncrypt(key, block, ZERO_IV))).toBe(toHex(expected));
  });

  it('round-trips the 32-byte cryptogram size this lab uses', () => {
    const key = tripleDesKey(fromHex('AB94FDECF2674FDFB9B391F85D7F76F2'));
    for (let i = 0; i < 16; i++) {
      const plaintext = randomBytes(32);
      expect(toHex(cbcDecrypt(key, cbcEncrypt(key, plaintext)))).toBe(toHex(plaintext));
    }
  });
});
