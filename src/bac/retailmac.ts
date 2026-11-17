/**
 * The retail MAC: ISO/IEC 9797-1 MAC algorithm 3, padding method 2.
 *
 * ICAO Doc 9303 Part 11 Section 4.3.3.2 specifies it exactly:
 *
 *   "The cryptographic checksums MIFD and MIC SHALL be calculated using
 *   [ISO/IEC 9797-1] MAC algorithm 3 with block cipher DES, zero IV (8 bytes),
 *   and [ISO/IEC 9797-1] padding method 2. The MAC length MUST be 8 bytes."
 *
 * where `[ISO/IEC 9797-1]` is "ISO/IEC 9797-1:2011 ... Message Authentication
 * Codes (MACs) — Part 1: Mechanisms using a block cipher".
 *
 * ## The shape, and why it is not just CBC-MAC under 3DES
 *
 * Algorithm 3 — the "retail MAC" — runs **single** DES in CBC mode under the
 * first key half across the whole padded message, and only then applies the
 * second key to the final block:
 *
 *     H := 0
 *     for each 8-byte block m:  H := DES-E(Ka, m xor H)
 *     MAC := DES-E(Ka, DES-D(Kb, H))
 *
 * So the message costs one DES per block rather than three, and the two-key
 * strengthening is bolted on at the end. That asymmetry is what makes the
 * offline search in exhibit 5 as cheap as it is: testing a candidate costs two
 * SHA-1 calls and seven DES block operations, five of them single DES over the
 * 40 padded bytes of E_IFD.
 *
 * ## Padding method 2 is not a detail
 *
 * Method 2 appends a single `0x80` byte and then as many zero bytes as it
 * takes to reach a block boundary — **always**, even when the message is
 * already a whole number of blocks. Method 1 appends zeros alone, and so adds
 * nothing to a message that already fits.
 *
 * E_IFD is 32 bytes: exactly four blocks. Over that input the two methods
 * disagree completely — method 2 runs a fifth block of `80 00 00 00 00 00 00
 * 00` and method 1 runs none — and the resulting MACs share nothing. Appendix
 * D's M_IFD is `5F1448EEA8AD90A7`; zero-padding the same message under the
 * same key gives `AAE3F35132ED3465`. That pair is mutation 6, and
 * `retailmac.test.ts` states it as two values rather than as a sentence about
 * padding.
 */
import { BLOCK_BYTES, desBlockWithSchedule, keySchedule, type Subkeys } from './des';

/** The MAC is truncated to its full 8 bytes — i.e. not truncated at all. */
export const MAC_BYTES = 8;

/**
 * ISO/IEC 9797-1 padding method 2: append `0x80`, then zeros to a block
 * boundary. A message that already ends on a boundary gains a whole block.
 */
export function padMethod2(message: Uint8Array): Uint8Array {
  const padded = new Uint8Array(
    message.length + BLOCK_BYTES - (message.length % BLOCK_BYTES)
  );
  padded.set(message, 0);
  padded[message.length] = 0x80;
  return padded;
}

/**
 * ISO/IEC 9797-1 padding method 1: zeros to a block boundary, and nothing at
 * all if the message already fits.
 *
 * NOT what this protocol uses. It is exported so `retailmac.test.ts` can show
 * the two methods disagreeing on this protocol's own message rather than
 * describing the difference in prose.
 */
export function padMethod1(message: Uint8Array): Uint8Array {
  if (message.length % BLOCK_BYTES === 0) return new Uint8Array(message);
  const padded = new Uint8Array(
    message.length + BLOCK_BYTES - (message.length % BLOCK_BYTES)
  );
  padded.set(message, 0);
  return padded;
}

/**
 * A retail MAC key: the two halves' DES schedules, expanded once.
 *
 * The search computes a fresh K_MAC for every candidate, so both schedules are
 * built per guess either way — but holding them lets the MAC itself avoid
 * rebuilding Ka's schedule once per block, which is five of the seven DES
 * operations in a guess.
 */
export interface RetailMacKey {
  readonly ka: Subkeys;
  readonly kb: Subkeys;
}

export function retailMacKey(key: Uint8Array): RetailMacKey {
  if (key.length !== 16) {
    throw new Error(`a retail MAC key is 16 bytes (Ka ‖ Kb), got ${key.length}`);
  }
  return { ka: keySchedule(key.subarray(0, 8)), kb: keySchedule(key.subarray(8, 16)) };
}

/**
 * The 8-byte retail MAC of `message` under an expanded key.
 *
 * The IV is the all-zero block Section 4.3.3.2 specifies; it is not a
 * parameter, because this protocol has no other value for it and an argument
 * nobody varies is an invitation to vary it.
 */
export function retailMacWithKey(key: RetailMacKey, message: Uint8Array): Uint8Array {
  const padded = padMethod2(message);
  // Single DES in CBC mode under Ka, across the whole padded message.
  let chain: Uint8Array = new Uint8Array(BLOCK_BYTES);
  const buf = new Uint8Array(BLOCK_BYTES);
  for (let at = 0; at < padded.length; at += BLOCK_BYTES) {
    for (let i = 0; i < BLOCK_BYTES; i++) buf[i] = padded[at + i] ^ chain[i];
    chain = desBlockWithSchedule(key.ka, buf, false);
  }
  // Then the second half, once: decrypt under Kb, re-encrypt under Ka.
  return desBlockWithSchedule(key.ka, desBlockWithSchedule(key.kb, chain, true), false);
}

/** The retail MAC of `message` under a 16-byte key. */
export function retailMac(key: Uint8Array, message: Uint8Array): Uint8Array {
  return retailMacWithKey(retailMacKey(key), message);
}
