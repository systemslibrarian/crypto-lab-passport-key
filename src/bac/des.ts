/**
 * DES and two-key Triple-DES in CBC mode, as ICAO Doc 9303 Part 11 uses them.
 *
 * Part 11 Section 4.3.3.1 specifies "Two key 3DES in CBC mode with zero IV
 * (i.e. 0x00 00 00 00 00 00 00 00) according to [ISO/IEC 11568-2]" for the
 * challenge cryptograms, with "Padding for the input data MUST NOT be used".
 * Section 4.3.3.2 then specifies a SINGLE-DES retail MAC over the result, so
 * both the single cipher and the triple construction are needed here.
 *
 * ## Fast, from the printed tables
 *
 * A DES that walks `destables.ts` bit by bit is wonderfully readable and about
 * thirty times too slow for exhibit 5, where the offline search runs about
 * seven DES block operations per candidate across millions of candidates. So
 * the permutations are precomputed into byte-indexed lookup tables ONCE, at
 * module load, by `buildTables()` below — which reads the same arrays a reader
 * checks against FIPS 46-3. Nothing is transcribed twice and no table is
 * hand-tuned.
 *
 * `des.test.ts` closes the loop: it contains a literal, obviously-correct
 * bit-walking DES built straight from `destables.ts`, and asserts that it and
 * this file agree on random keys and blocks. An error in the derivation below
 * cannot hide behind the published vectors, because a second implementation
 * disagrees with it.
 *
 * NOT PRODUCTION CRYPTOGRAPHY. Single DES has a 56-bit key and fell to
 * exhaustive search in 1998; two-key 3DES is limited by a meet-in-the-middle
 * attack and NIST disallowed TDEA for new applications after 2023. This code
 * is also not constant-time — the S-box lookups are data-dependent array
 * indexing. It is here because this is what the standard specifies.
 */
import { E, FP, IP, P, PC1, PC2, SBOX, SHIFTS } from './destables';

export const BLOCK_BYTES = 8;

/* ── Table construction ───────────────────────────────────────────────────── */

/**
 * Precompute one byte-indexed table set from a bit-position permutation.
 *
 * A permutation that takes `inBits` source bits to `table.length` output bits
 * becomes, for each input byte position, a 256-entry array of output bit
 * masks. Applying the permutation is then one OR per input byte rather than
 * one loop iteration per output bit.
 *
 * Output is held as an array of 32-bit words, high word first, which is what
 * every caller below wants: a 64-bit block is two words, a 48-bit subkey is
 * two words (the second holding 16 significant bits), and a 28-bit half is one.
 */
function permuteTable(table: readonly number[], inBits: number): Uint32Array[] {
  const outWords = Math.ceil(table.length / 32);
  const inBytes = Math.ceil(inBits / 8);
  // tables[byteIndex][byteValue] holds `outWords` words, flattened.
  const tables: Uint32Array[] = [];
  for (let byteIndex = 0; byteIndex < inBytes; byteIndex++) {
    const t = new Uint32Array(256 * outWords);
    for (let value = 0; value < 256; value++) {
      for (let out = 0; out < table.length; out++) {
        const src = table[out] - 1; // tables are 1-based
        if ((src >> 3) !== byteIndex) continue;
        const bit = (value >> (7 - (src & 7))) & 1;
        if (!bit) continue;
        const word = (out / 32) | 0;
        t[value * outWords + word] |= 0x80000000 >>> (out & 31);
      }
    }
    tables.push(t);
  }
  return tables;
}

/** Apply a `permuteTable` table set to `inBytes` bytes, producing words. */
function applyBytes(
  tables: Uint32Array[],
  bytes: Uint8Array,
  offset: number,
  outWords: number
): number[] {
  const out = new Array<number>(outWords).fill(0);
  for (let i = 0; i < tables.length; i++) {
    const base = bytes[offset + i] * outWords;
    const t = tables[i];
    for (let w = 0; w < outWords; w++) out[w] |= t[base + w];
  }
  return out;
}

/** Apply a `permuteTable` table set to words, producing words. */
function applyWords(tables: Uint32Array[], words: readonly number[], outWords: number): number[] {
  const out = new Array<number>(outWords).fill(0);
  for (let i = 0; i < tables.length; i++) {
    const byte = (words[(i / 4) | 0] >>> (24 - (i & 3) * 8)) & 0xff;
    const base = byte * outWords;
    const t = tables[i];
    for (let w = 0; w < outWords; w++) out[w] |= t[base + w];
  }
  return out;
}

const IP_T = permuteTable(IP, 64);
const FP_T = permuteTable(FP, 64);
const PC1_T = permuteTable(PC1, 64);
const PC2_T = permuteTable(PC2, 56);
const E_T = permuteTable(E, 32);

/**
 * The combined S-box-and-P tables: SP[box][6-bit input] is the 32-bit word
 * that this S-box's 4-bit output contributes after P.
 *
 * Deriving them together is the one real optimisation in this file. It is also
 * the step most likely to be wrong by a bit, which is why the test compares
 * against a separate implementation that keeps S and P apart.
 */
const SP: Uint32Array[] = (() => {
  const out: Uint32Array[] = [];
  for (let box = 0; box < 8; box++) {
    const t = new Uint32Array(64);
    for (let input = 0; input < 64; input++) {
      // FIPS 46-3: row from the outer two bits, column from the inner four.
      const row = ((input & 0b100000) >> 4) | (input & 1);
      const col = (input >> 1) & 0b1111;
      const value = SBOX[box][row * 16 + col];
      // This S-box writes output bits 4*box+1 .. 4*box+4 of the 32-bit
      // pre-P word; P then moves each of those to its final position.
      let word = 0;
      for (let bit = 0; bit < 4; bit++) {
        if (((value >> (3 - bit)) & 1) === 0) continue;
        const preP = box * 4 + bit + 1; // 1-based position before P
        const dest = P.indexOf(preP); // 0-based position after P
        word |= 0x80000000 >>> dest;
      }
      t[input] = word >>> 0;
    }
    out.push(t);
  }
  return out;
})();

/* ── Key schedule ─────────────────────────────────────────────────────────── */

/**
 * The sixteen 48-bit round subkeys, each as two words (32 + 16 significant
 * bits). Parity bits are dropped by PC-1 and never consulted — which is why
 * the parity adjustment in `kdf.ts` changes the KEY BYTES ON SCREEN without
 * changing a single ciphertext, and why mutation 5 has to be caught by
 * comparing key bytes rather than output.
 */
export type Subkeys = Int32Array;

export function keySchedule(key: Uint8Array): Subkeys {
  if (key.length !== 8) throw new Error(`a DES key is 8 bytes, got ${key.length}`);
  const pc1 = applyBytes(PC1_T, key, 0, 2);
  // C is bits 1..28, D is bits 29..56, held left-aligned in 28 bits.
  let c = (pc1[0] >>> 4) & 0x0fffffff;
  let d = (((pc1[0] & 0xf) << 24) | ((pc1[1] >>> 8) & 0xffffff)) & 0x0fffffff;

  const out = new Int32Array(32);
  for (let round = 0; round < 16; round++) {
    const s = SHIFTS[round];
    c = ((c << s) | (c >>> (28 - s))) & 0x0fffffff;
    d = ((d << s) | (d >>> (28 - s))) & 0x0fffffff;
    // Re-pack C||D into the 56-bit layout PC-2 indexes into.
    const packed = [((c << 4) | (d >>> 24)) | 0, (d << 8) | 0];
    const sk = applyWords(PC2_T, packed, 2);
    out[round * 2] = sk[0];
    out[round * 2 + 1] = sk[1];
  }
  return out;
}

/* ── The block cipher ─────────────────────────────────────────────────────── */

function rounds(left: number, right: number, sk: Subkeys, reverse: boolean): [number, number] {
  let l = left;
  let r = right;
  for (let i = 0; i < 16; i++) {
    const round = reverse ? 15 - i : i;
    // Expansion E of the right half, as two words.
    const e = applyWords(E_T, [r, 0], 2);
    const a = (e[0] ^ sk[round * 2]) >>> 0;
    const b = ((e[1] ^ sk[round * 2 + 1]) >>> 16) & 0xffff;
    const f =
      (SP[0][(a >>> 26) & 0x3f] |
        SP[1][(a >>> 20) & 0x3f] |
        SP[2][(a >>> 14) & 0x3f] |
        SP[3][(a >>> 8) & 0x3f] |
        SP[4][(a >>> 2) & 0x3f] |
        SP[5][(((a & 0x3) << 4) | (b >>> 12)) & 0x3f] |
        SP[6][(b >>> 6) & 0x3f] |
        SP[7][b & 0x3f]) >>>
      0;
    const next = (l ^ f) | 0;
    l = r;
    r = next;
  }
  // DES ends with the halves swapped relative to the loop's last assignment.
  return [r, l];
}

function block(key: Subkeys, input: Uint8Array, at: number, out: Uint8Array, outAt: number, reverse: boolean): void {
  const ip = applyBytes(IP_T, input, at, 2);
  const [l, r] = rounds(ip[0], ip[1], key, reverse);
  const fp = applyWords(FP_T, [l, r], 2);
  out[outAt] = (fp[0] >>> 24) & 0xff;
  out[outAt + 1] = (fp[0] >>> 16) & 0xff;
  out[outAt + 2] = (fp[0] >>> 8) & 0xff;
  out[outAt + 3] = fp[0] & 0xff;
  out[outAt + 4] = (fp[1] >>> 24) & 0xff;
  out[outAt + 5] = (fp[1] >>> 16) & 0xff;
  out[outAt + 6] = (fp[1] >>> 8) & 0xff;
  out[outAt + 7] = fp[1] & 0xff;
}

/**
 * One single-DES block under an ALREADY-EXPANDED key schedule.
 *
 * The retail MAC needs this: it runs single DES in CBC mode across the padded
 * message under Ka, and rebuilding Ka's schedule once per block would be five
 * of the seven DES operations in a search candidate spent re-deriving a key
 * that did not change.
 */
export function desBlockWithSchedule(
  schedule: Subkeys,
  input: Uint8Array,
  decrypt: boolean
): Uint8Array {
  if (input.length !== 8) throw new Error(`a DES block is 8 bytes, got ${input.length}`);
  const out = new Uint8Array(8);
  block(schedule, input, 0, out, 0, decrypt);
  return out;
}

/** Single-DES encryption of one 8-byte block. */
export function desEncryptBlock(key: Uint8Array, input: Uint8Array): Uint8Array {
  if (input.length !== 8) throw new Error(`a DES block is 8 bytes, got ${input.length}`);
  const out = new Uint8Array(8);
  block(keySchedule(key), input, 0, out, 0, false);
  return out;
}

/** Single-DES decryption of one 8-byte block. */
export function desDecryptBlock(key: Uint8Array, input: Uint8Array): Uint8Array {
  if (input.length !== 8) throw new Error(`a DES block is 8 bytes, got ${input.length}`);
  const out = new Uint8Array(8);
  block(keySchedule(key), input, 0, out, 0, true);
  return out;
}

/* ── Two-key Triple-DES ───────────────────────────────────────────────────── */

/**
 * A two-key 3DES key: 16 bytes, read as K1 ‖ K2, used as E_K1(D_K2(E_K1(x))).
 *
 * Pre-expanding both schedules matters for the search: the CBC encryption of a
 * 32-byte challenge is four blocks, each three DES operations, and computing
 * the schedules once per key instead of once per block is most of the
 * difference between a usable exhibit and a slideshow.
 */
export interface TripleDesKey {
  readonly k1: Subkeys;
  readonly k2: Subkeys;
}

export function tripleDesKey(key: Uint8Array): TripleDesKey {
  if (key.length !== 16) {
    throw new Error(`a two-key 3DES key is 16 bytes, got ${key.length}`);
  }
  return { k1: keySchedule(key.subarray(0, 8)), k2: keySchedule(key.subarray(8, 16)) };
}

function tripleBlock(k: TripleDesKey, input: Uint8Array, out: Uint8Array, reverse: boolean): void {
  if (!reverse) {
    block(k.k1, input, 0, out, 0, false);
    block(k.k2, out, 0, out, 0, true);
    block(k.k1, out, 0, out, 0, false);
  } else {
    block(k.k1, input, 0, out, 0, true);
    block(k.k2, out, 0, out, 0, false);
    block(k.k1, out, 0, out, 0, true);
  }
}

/* ── CBC ──────────────────────────────────────────────────────────────────── */

/** The all-zero IV that Part 11 Section 4.3.3.1 specifies. */
export const ZERO_IV: Uint8Array = new Uint8Array(8);

/**
 * Two-key 3DES in CBC mode, no padding.
 *
 * The plaintext length must already be a multiple of 8: Part 11 says padding
 * "MUST NOT be used" for EXTERNAL AUTHENTICATE, and both messages this lab
 * encrypts are exactly 32 bytes by construction (8 + 8 + 16). A length that is
 * not a multiple of the block size is therefore a caller error, not something
 * to silently pad.
 */
export function cbcEncrypt(
  key: TripleDesKey,
  plaintext: Uint8Array,
  iv: Uint8Array = ZERO_IV
): Uint8Array {
  if (plaintext.length % BLOCK_BYTES !== 0) {
    throw new Error(`CBC needs whole blocks; got ${plaintext.length} bytes (no padding is used)`);
  }
  if (iv.length !== BLOCK_BYTES) throw new Error(`the IV is 8 bytes, got ${iv.length}`);
  const out = new Uint8Array(plaintext.length);
  const chain = new Uint8Array(iv);
  const buf = new Uint8Array(8);
  for (let at = 0; at < plaintext.length; at += BLOCK_BYTES) {
    for (let i = 0; i < BLOCK_BYTES; i++) buf[i] = plaintext[at + i] ^ chain[i];
    tripleBlock(key, buf, chain, false);
    out.set(chain, at);
  }
  return out;
}

export function cbcDecrypt(
  key: TripleDesKey,
  ciphertext: Uint8Array,
  iv: Uint8Array = ZERO_IV
): Uint8Array {
  if (ciphertext.length % BLOCK_BYTES !== 0) {
    throw new Error(`CBC needs whole blocks; got ${ciphertext.length} bytes`);
  }
  if (iv.length !== BLOCK_BYTES) throw new Error(`the IV is 8 bytes, got ${iv.length}`);
  const out = new Uint8Array(ciphertext.length);
  let chain = new Uint8Array(iv);
  const buf = new Uint8Array(8);
  for (let at = 0; at < ciphertext.length; at += BLOCK_BYTES) {
    const cipherBlock = ciphertext.subarray(at, at + BLOCK_BYTES);
    tripleBlock(key, cipherBlock, buf, true);
    for (let i = 0; i < BLOCK_BYTES; i++) out[at + i] = buf[i] ^ chain[i];
    chain = new Uint8Array(cipherBlock);
  }
  return out;
}
