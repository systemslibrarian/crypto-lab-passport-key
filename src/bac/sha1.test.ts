import { describe, expect, it } from 'vitest';
import { ascii, toHex } from './bytes';
import { sha1 } from './sha1';
import { ICAO_APPENDIX_D, SHA1_KAT, SHA1_MILLION_A_DIGEST } from './vectors';

describe('SHA-1, against FIPS 180-4', () => {
  it('reproduces the published short-message known answers', () => {
    for (const { message, digest } of SHA1_KAT) {
      expect(toHex(sha1(ascii(message))), message).toBe(digest);
    }
  });

  it('hashes the empty message', () => {
    expect(toHex(sha1(new Uint8Array(0)))).toBe('DA39A3EE5E6B4B0D3255BFEF95601890AFD80709');
  });

  it('reproduces the one-million-character case', () => {
    // The only published case that drives the compression function over many
    // blocks. This lab's own inputs are 24 to 28 bytes, so without this the
    // multi-block path and the 64-bit length field are never exercised.
    const million = new Uint8Array(1_000_000).fill(0x61);
    expect(toHex(sha1(million))).toBe(SHA1_MILLION_A_DIGEST);
  });
});

describe('SHA-1 agrees with WebCrypto', () => {
  /**
   * The differential test that makes a hand-rolled hash honest.
   *
   * `sha1.ts` explains why this lab cannot call `crypto.subtle.digest` in the
   * search loop: measured here, it manages about 9,000 digests a second
   * against 610,000 for the function under test, and two digests per candidate
   * would cap the offline search below the single-threaded Python reference
   * the brief cites. The answer is not to trust the replacement — it is to
   * assert, on every run, that the platform agrees with it.
   *
   * The lengths are chosen rather than random: 55, 56, 63, 64, 119 and 120 are
   * where SHA-1's padding spills into an extra block, which is the part of the
   * implementation a random length is least likely to hit.
   */
  const BOUNDARY_LENGTHS = [0, 1, 2, 3, 20, 54, 55, 56, 57, 62, 63, 64, 65, 118, 119, 120, 121];

  it('matches crypto.subtle.digest at every padding boundary', async () => {
    for (const length of BOUNDARY_LENGTHS) {
      const input = crypto.getRandomValues(new Uint8Array(length));
      const expected = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
      expect(toHex(sha1(input)), `length ${length}`).toBe(toHex(expected));
    }
  });

  it('matches crypto.subtle.digest on 200 random inputs', async () => {
    for (let i = 0; i < 200; i++) {
      const input = crypto.getRandomValues(new Uint8Array(1 + Math.floor(Math.random() * 200)));
      const expected = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
      expect(toHex(sha1(input)), `input length ${input.length}`).toBe(toHex(expected));
    }
  });
});

describe("SHA-1 of the standard's own MRZ_information", () => {
  it("reproduces Appendix D's printed hash", () => {
    // Appendix D.2 step 3 prints this full 20-byte hash before step 4 takes
    // its most significant 16 bytes as the key seed.
    expect(toHex(sha1(ascii(ICAO_APPENDIX_D.mrzInformation)))).toBe(
      ICAO_APPENDIX_D.mrzInformationSha1
    );
  });
});
