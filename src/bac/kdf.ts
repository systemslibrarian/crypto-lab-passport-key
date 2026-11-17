/**
 * From printed data to a pair of 3DES keys.
 *
 * This is the hinge of the whole lab. ICAO Doc 9303 Part 11 specifies it in
 * two places:
 *
 * **Section 4.3.2, step 1** — "The most significant 16 bytes of the SHA-1 hash
 * of this 'MRZ_information' are used as key seed to derive the Document Basic
 * Access Keys using the key derivation mechanism described in Section 9.7.2."
 *
 * **Section 9.7.1** — "The key derivation function KDF(K,c) ... keydata =
 * H(K || c)", where c is "a 32-bit, big-endian integer counter". Section
 * 9.7.1.1 then adds, for 3DES keys: "Use octets 1 to 8 of keydata to form
 * keydataA and octets 9 to 16 of keydata to form keydataB; additional octets
 * are not used. Adjust the parity bits of keydataA and keydataB to form
 * correct DES keys (OPTIONAL)."
 *
 * **Section 9.7.2** — "KEnc = KDF(K,1) and KMAC = KDF(K,2)".
 *
 * Section 9.7.4 reuses the same function for the session keys after
 * authentication, with K.IC xor K.IFD as the shared secret.
 *
 * ## The parity adjustment is optional, and that is worth seeing
 *
 * Note the "(OPTIONAL)" in Section 9.7.1.1 — it is the standard's own word.
 * PC-1 selects 56 of a DES key's 64 bits and never names bits 8, 16, ... 64,
 * so the adjustment cannot change a single ciphertext; `des.test.ts` asserts
 * exactly that by flipping every parity bit and getting the same output. What
 * it changes is the KEY as printed, which is why Appendix D's K_Enc reads
 * `AB94FDECF2674FDF...` where the raw hash gave `AB94FCEDF2664EDF...`.
 *
 * So this module keeps both forms. A test that only compared ciphertexts could
 * not tell an implementation that adjusts parity from one that does not —
 * which is mutation 5, and it is caught by comparing the key bytes.
 */
import { concat, xor } from './bytes';
import { ascii } from './bytes';
import { sha1 } from './sha1';
import { mrzInformation, type MrzInformation, type PrintedData } from './mrz';

/** Part 11 Section 9.7.2: counter 1 for the encryption key. */
export const COUNTER_ENC = 1;
/** Part 11 Section 9.7.2: counter 2 for the MAC key. */
export const COUNTER_MAC = 2;

/** The key seed is the most significant 16 bytes of the hash. */
export const K_SEED_BYTES = 16;

/**
 * Set the low bit of each byte so the byte has odd parity.
 *
 * A DES key byte carries seven key bits and one parity bit; FIPS 46-3 defines
 * the eighth bit of each byte as odd parity over the other seven. `adjust`
 * clears that bit and sets it to whatever makes the byte's population count
 * odd.
 */
export function adjustParity(key: Uint8Array): Uint8Array {
  const out = new Uint8Array(key.length);
  for (let i = 0; i < key.length; i++) {
    const seven = key[i] & 0xfe;
    // Population count of the seven key bits, folded down to its low bit.
    let parity = seven;
    parity ^= parity >> 4;
    parity ^= parity >> 2;
    parity ^= parity >> 1;
    out[i] = seven | ((parity & 1) ^ 1);
  }
  return out;
}

/** Whether every byte of `key` already has odd parity. */
export function hasOddParity(key: Uint8Array): boolean {
  for (const byte of key) {
    let count = 0;
    for (let bit = 0; bit < 8; bit++) count += (byte >> bit) & 1;
    if (count % 2 === 0) return false;
  }
  return true;
}

/** A 32-bit big-endian counter, as Section 9.7.1 requires. */
export function counterBytes(counter: number): Uint8Array {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) {
    throw new Error(`the KDF counter is a 32-bit integer, got ${counter}`);
  }
  const out = new Uint8Array(4);
  out[0] = (counter >>> 24) & 0xff;
  out[1] = (counter >>> 16) & 0xff;
  out[2] = (counter >>> 8) & 0xff;
  out[3] = counter & 0xff;
  return out;
}

/** One derived key, with the intermediate values exhibit 2 displays. */
export interface DerivedKey {
  readonly counter: number;
  /** K_seed ‖ c, the input to the hash. */
  readonly hashInput: Uint8Array;
  /** The full 20-byte hash. Appendix D.1 prints this. */
  readonly hash: Uint8Array;
  /** Its first 16 bytes: keydataA ‖ keydataB, before the parity adjustment. */
  readonly beforeParity: Uint8Array;
  /** The same 16 bytes with odd parity forced — the key Appendix D prints. */
  readonly key: Uint8Array;
}

/** KDF(K, c) for a 3DES key, per Section 9.7.1 and 9.7.1.1. */
export function deriveKey(kSeed: Uint8Array, counter: number): DerivedKey {
  const hashInput = concat(kSeed, counterBytes(counter));
  const hash = sha1(hashInput);
  const beforeParity = hash.slice(0, 16);
  return { counter, hashInput, hash, beforeParity, key: adjustParity(beforeParity) };
}

/** The pair of Document Basic Access Keys, and everything used to get there. */
export interface BasicAccessKeys {
  readonly kSeed: Uint8Array;
  readonly enc: DerivedKey;
  readonly mac: DerivedKey;
}

/** K_Enc = KDF(K_seed, 1), K_MAC = KDF(K_seed, 2) — Section 9.7.2. */
export function basicAccessKeys(kSeed: Uint8Array): BasicAccessKeys {
  if (kSeed.length !== K_SEED_BYTES) {
    throw new Error(`the key seed is ${K_SEED_BYTES} bytes, got ${kSeed.length}`);
  }
  return {
    kSeed,
    enc: deriveKey(kSeed, COUNTER_ENC),
    mac: deriveKey(kSeed, COUNTER_MAC),
  };
}

/** The whole path from printed characters to keys, with every step kept. */
export interface KeysFromPrintedData {
  readonly info: MrzInformation;
  /** The ASCII bytes that get hashed. */
  readonly ascii: Uint8Array;
  /** SHA-1 of those bytes, all 20. */
  readonly hash: Uint8Array;
  readonly keys: BasicAccessKeys;
}

/**
 * Printed data to Document Basic Access Keys.
 *
 * Every intermediate value is returned rather than consumed, because exhibit 2
 * shows them: the ASCII, the full hash, the 16-byte seed, each counter's hash,
 * each key before and after parity. A function that returned only the two keys
 * would make the exhibit assert its steps instead of showing them.
 */
export function keysFromPrintedData(data: PrintedData): KeysFromPrintedData {
  const info = mrzInformation(data);
  const bytes = ascii(info.value);
  const hash = sha1(bytes);
  return {
    info,
    ascii: bytes,
    hash,
    keys: basicAccessKeys(hash.slice(0, K_SEED_BYTES)),
  };
}

/**
 * The session keys, from K.IC xor K.IFD.
 *
 * Part 11 Section 4.3.1 step 5: "The IFD and the IC derive session keys KSEnc
 * and KSMAC using the key derivation mechanism described in Sections 9.7.1.
 * and 9.7.4 with (K.IC xor K.IFD) as shared secret." The same KDF, the same
 * two counters — only the seed differs. Concatenating instead of XOR-ing is
 * mutation 9, and it gives a 32-byte seed that hashes to something else
 * entirely.
 */
export function sessionKeys(kIfd: Uint8Array, kIc: Uint8Array): BasicAccessKeys {
  return basicAccessKeys(xor(kIfd, kIc));
}
