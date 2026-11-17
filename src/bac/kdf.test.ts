import { describe, expect, it } from 'vitest';
import { ascii, concat, fromHex, toHex } from './bytes';
import {
  adjustParity,
  basicAccessKeys,
  COUNTER_ENC,
  COUNTER_MAC,
  counterBytes,
  deriveKey,
  hasOddParity,
  keysFromPrintedData,
  sessionKeys,
} from './kdf';
import { sha1 } from './sha1';
import { cbcEncrypt, tripleDesKey } from './des';
import { ICAO_APPENDIX_D, SECOND_VECTOR } from './vectors';

describe('the counter is a 32-bit big-endian integer (Section 9.7.1)', () => {
  it('encodes 1 and 2 as four bytes, most significant first', () => {
    expect(toHex(counterBytes(1))).toBe('00000001');
    expect(toHex(counterBytes(2))).toBe('00000002');
  });

  it('is big-endian, not little — mutation 4', () => {
    // Little-endian would send 01000000. Appendix D.1 prints the hash input
    // as '239AB9CB...FBAE00000001', which settles the byte order.
    expect(toHex(counterBytes(1))).not.toBe('01000000');
    const seed = fromHex(ICAO_APPENDIX_D.kSeed);
    expect(toHex(concat(seed, counterBytes(1)))).toBe(ICAO_APPENDIX_D.kSeed + '00000001');
  });

  it('refuses a counter that is not a 32-bit integer', () => {
    expect(() => counterBytes(-1)).toThrow(/32-bit/);
    expect(() => counterBytes(2 ** 32)).toThrow(/32-bit/);
    expect(() => counterBytes(1.5)).toThrow(/32-bit/);
  });
});

describe('the parity adjustment (Section 9.7.1.1)', () => {
  it('makes every byte odd-parity', () => {
    const adjusted = adjustParity(fromHex(ICAO_APPENDIX_D.kEncBeforeParity));
    expect(hasOddParity(adjusted)).toBe(true);
  });

  it('changes only the low bit of each byte', () => {
    const before = fromHex(ICAO_APPENDIX_D.kEncBeforeParity);
    const after = adjustParity(before);
    for (let i = 0; i < before.length; i++) {
      expect(after[i] & 0xfe, `byte ${i} keeps its seven key bits`).toBe(before[i] & 0xfe);
    }
  });

  it("turns Appendix D's raw hash bytes into its printed K_Enc", () => {
    // AB94FCEDF2664EDFB9B291F85D7F77F2 -> AB94FDECF2674FDFB9B391F85D7F76F2
    expect(toHex(adjustParity(fromHex(ICAO_APPENDIX_D.kEncBeforeParity)))).toBe(
      ICAO_APPENDIX_D.kEnc
    );
    expect(toHex(adjustParity(fromHex(ICAO_APPENDIX_D.kMacBeforeParity)))).toBe(
      ICAO_APPENDIX_D.kMac
    );
  });

  it('is idempotent', () => {
    const once = adjustParity(fromHex(ICAO_APPENDIX_D.kEncBeforeParity));
    expect(toHex(adjustParity(once))).toBe(toHex(once));
  });

  it('CHANGES THE KEY BYTES but no ciphertext — mutation 5', () => {
    /**
     * The whole reason `DerivedKey` keeps both forms.
     *
     * Section 9.7.1.1 calls the adjustment OPTIONAL, and it is: PC-1 discards
     * every parity bit, so the two keys below encrypt identically. An
     * implementation that skipped the adjustment would therefore pass every
     * test that compares a cryptogram — and would print the wrong keys on
     * screen, which is what Appendix D's K_Enc and K_MAC actually pin.
     *
     * So this asserts both halves of the claim at once: the key bytes differ,
     * and the ciphertext does not.
     */
    const raw = fromHex(ICAO_APPENDIX_D.kEncBeforeParity);
    const adjusted = adjustParity(raw);
    expect(toHex(adjusted)).not.toBe(toHex(raw));

    const message = fromHex(ICAO_APPENDIX_D.s);
    expect(toHex(cbcEncrypt(tripleDesKey(adjusted), message))).toBe(
      toHex(cbcEncrypt(tripleDesKey(raw), message))
    );
    expect(toHex(cbcEncrypt(tripleDesKey(adjusted), message))).toBe(ICAO_APPENDIX_D.eIfd);
  });
});

describe("the key derivation, against Appendix D.1", () => {
  const seed = fromHex(ICAO_APPENDIX_D.kSeed);

  it('reproduces the printed hash at counter 1 and counter 2', () => {
    expect(toHex(deriveKey(seed, COUNTER_ENC).hash)).toBe(ICAO_APPENDIX_D.kdfHashC1);
    expect(toHex(deriveKey(seed, COUNTER_MAC).hash)).toBe(ICAO_APPENDIX_D.kdfHashC2);
  });

  it("reproduces Ka' and Kb' before the parity adjustment", () => {
    expect(toHex(deriveKey(seed, COUNTER_ENC).beforeParity)).toBe(
      ICAO_APPENDIX_D.kEncBeforeParity
    );
    expect(toHex(deriveKey(seed, COUNTER_MAC).beforeParity)).toBe(
      ICAO_APPENDIX_D.kMacBeforeParity
    );
  });

  it('reproduces K_Enc and K_MAC', () => {
    const keys = basicAccessKeys(seed);
    expect(toHex(keys.enc.key)).toBe(ICAO_APPENDIX_D.kEnc);
    expect(toHex(keys.mac.key)).toBe(ICAO_APPENDIX_D.kMac);
  });

  it('uses counter 1 for encryption and 2 for the MAC, not the reverse', () => {
    expect(COUNTER_ENC).toBe(1);
    expect(COUNTER_MAC).toBe(2);
    const keys = basicAccessKeys(seed);
    expect(toHex(keys.enc.key)).not.toBe(toHex(keys.mac.key));
  });

  it('takes 16 bytes of the hash, not all 20 — mutation 3', () => {
    // The hash is 20 bytes; a 3DES key is 16. Section 4.3.2 says "the most
    // significant 16 bytes". Appendix D's K_seed ends ...DF6BFBAE where the
    // full hash continues DF477565.
    const full = sha1(ascii(ICAO_APPENDIX_D.mrzInformation));
    expect(full.length).toBe(20);
    expect(toHex(full)).toBe(ICAO_APPENDIX_D.mrzInformationSha1);
    expect(toHex(full.slice(0, 16))).toBe(ICAO_APPENDIX_D.kSeed);
    expect(toHex(full)).not.toBe(ICAO_APPENDIX_D.kSeed);
  });

  it('refuses a seed that is not 16 bytes', () => {
    expect(() => basicAccessKeys(sha1(ascii('x')))).toThrow(/16 bytes/);
  });
});

describe('printed data to keys, end to end', () => {
  it("reproduces every step of Appendix D for the ICAO specimen", () => {
    const result = keysFromPrintedData({
      documentNumber: ICAO_APPENDIX_D.documentNumber,
      dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
      dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
    });
    expect(result.info.value).toBe(ICAO_APPENDIX_D.mrzInformation);
    expect(toHex(result.hash)).toBe(ICAO_APPENDIX_D.mrzInformationSha1);
    expect(toHex(result.keys.kSeed)).toBe(ICAO_APPENDIX_D.kSeed);
    expect(toHex(result.keys.enc.key)).toBe(ICAO_APPENDIX_D.kEnc);
    expect(toHex(result.keys.mac.key)).toBe(ICAO_APPENDIX_D.kMac);
  });

  it('reproduces the second vector, with letters in the document number', () => {
    const result = keysFromPrintedData({
      documentNumber: SECOND_VECTOR.documentNumber,
      dateOfBirth: SECOND_VECTOR.dateOfBirth,
      dateOfExpiry: SECOND_VECTOR.dateOfExpiry,
    });
    expect(result.info.value).toBe(SECOND_VECTOR.mrzInformation);
    expect(toHex(result.keys.kSeed)).toBe(SECOND_VECTOR.kSeed);
    expect(toHex(result.keys.enc.key)).toBe(SECOND_VECTOR.kEnc);
    expect(toHex(result.keys.mac.key)).toBe(SECOND_VECTOR.kMac);
  });

  it('hashes the ASCII of MRZ_information, nothing else', () => {
    const result = keysFromPrintedData({
      documentNumber: ICAO_APPENDIX_D.documentNumber,
      dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
      dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
    });
    expect(toHex(result.ascii)).toBe(toHex(ascii(ICAO_APPENDIX_D.mrzInformation)));
    expect(result.ascii.length).toBe(24);
  });

  it('gives different keys for one changed character', () => {
    // The point of the whole lab, stated as a test: the key is a function of
    // the printed characters and nothing else, so every candidate in exhibit
    // 5's search is a distinct key.
    const base = keysFromPrintedData({
      documentNumber: 'L898902C<',
      dateOfBirth: '690806',
      dateOfExpiry: '940623',
    });
    const oneDayLater = keysFromPrintedData({
      documentNumber: 'L898902C<',
      dateOfBirth: '690807',
      dateOfExpiry: '940623',
    });
    expect(toHex(oneDayLater.keys.enc.key)).not.toBe(toHex(base.keys.enc.key));
    expect(toHex(oneDayLater.keys.mac.key)).not.toBe(toHex(base.keys.mac.key));
  });
});

describe('session keys (Sections 9.7.4 and 4.3.1 step 5)', () => {
  const kIfd = fromHex(ICAO_APPENDIX_D.kIfd);
  const kIc = fromHex(ICAO_APPENDIX_D.kIc);

  it("reproduces Appendix D's session seed, KS_Enc and KS_MAC", () => {
    const session = sessionKeys(kIfd, kIc);
    expect(toHex(session.kSeed)).toBe(ICAO_APPENDIX_D.sessionSeed);
    expect(toHex(session.enc.key)).toBe(ICAO_APPENDIX_D.ksEnc);
    expect(toHex(session.mac.key)).toBe(ICAO_APPENDIX_D.ksMac);
  });

  it('XORs the two halves rather than concatenating them — mutation 9', () => {
    // Concatenation gives a 32-byte seed, which the KDF refuses outright; and
    // even its first 16 bytes are K.IFD itself, hashing to something else.
    expect(toHex(sessionKeys(kIfd, kIc).kSeed)).toBe(ICAO_APPENDIX_D.sessionSeed);
    expect(() => basicAccessKeys(concat(kIfd, kIc))).toThrow(/16 bytes/);
    expect(toHex(basicAccessKeys(kIfd).enc.key)).not.toBe(ICAO_APPENDIX_D.ksEnc);
  });

  it('is symmetric: both sides compute the same seed', () => {
    expect(toHex(sessionKeys(kIfd, kIc).kSeed)).toBe(toHex(sessionKeys(kIc, kIfd).kSeed));
  });

  it('refuses halves of different lengths', () => {
    expect(() => sessionKeys(kIfd, kIc.slice(0, 8))).toThrow(/length mismatch/);
  });

  it('uses the same KDF as the document keys, only a different seed', () => {
    // Section 9.7.4 reuses 9.7.1 with counters 1 and 2. Asserted by deriving
    // the session keys with the document-key function and the session seed.
    const seed = fromHex(ICAO_APPENDIX_D.sessionSeed);
    expect(toHex(basicAccessKeys(seed).enc.key)).toBe(ICAO_APPENDIX_D.ksEnc);
    expect(toHex(basicAccessKeys(seed).mac.key)).toBe(ICAO_APPENDIX_D.ksMac);
  });
});
