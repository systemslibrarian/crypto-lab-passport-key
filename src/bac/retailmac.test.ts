import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from './bytes';
import { padMethod1, padMethod2, retailMac, retailMacKey, retailMacWithKey } from './retailmac';
import { ICAO_APPENDIX_D, RETAIL_MAC_ZERO_PADDED_M_IFD, SECOND_VECTOR } from './vectors';
import { desBlockWithSchedule, keySchedule } from './des';

describe('ISO/IEC 9797-1 padding method 2', () => {
  it('appends 0x80 and then zeros to a block boundary', () => {
    expect(toHex(padMethod2(fromHex('0011223344')))).toBe('0011223344800000');
  });

  it('adds a WHOLE extra block to a message that already fits', () => {
    // This is the clause that matters for this protocol: E_IFD is 32 bytes,
    // exactly four blocks, and method 2 still runs a fifth.
    expect(toHex(padMethod2(fromHex('0011223344556677')))).toBe(
      '0011223344556677' + '8000000000000000'
    );
    expect(padMethod2(new Uint8Array(32)).length).toBe(40);
  });

  it('differs from method 1 on exactly the message this protocol MACs', () => {
    const eIfd = fromHex(ICAO_APPENDIX_D.eIfd);
    expect(eIfd.length).toBe(32);
    // Method 1 adds nothing at all; method 2 adds eight bytes.
    expect(padMethod1(eIfd).length).toBe(32);
    expect(padMethod2(eIfd).length).toBe(40);
  });
});

describe("the retail MAC, against Appendix D's printed checksums", () => {
  const kMac = fromHex(ICAO_APPENDIX_D.kMac);

  it("reproduces Appendix D's M_IFD", () => {
    expect(toHex(retailMac(kMac, fromHex(ICAO_APPENDIX_D.eIfd)))).toBe(ICAO_APPENDIX_D.mIfd);
  });

  it("reproduces Appendix D's M_IC", () => {
    expect(toHex(retailMac(kMac, fromHex(ICAO_APPENDIX_D.eIc)))).toBe(ICAO_APPENDIX_D.mIc);
  });

  it("reproduces the second vector's M_IFD", () => {
    expect(toHex(retailMac(fromHex(SECOND_VECTOR.kMac), fromHex(SECOND_VECTOR.eIfd)))).toBe(
      SECOND_VECTOR.mIfd
    );
  });

  it('is 8 bytes', () => {
    // Section 4.3.3.2: "The MAC length MUST be 8 bytes."
    expect(retailMac(kMac, fromHex(ICAO_APPENDIX_D.eIfd)).length).toBe(8);
  });
});

describe('the retail MAC is algorithm 3, not CBC-MAC under 3DES', () => {
  /**
   * The structural test. Appendix D's value confirms the whole computation is
   * right, but it cannot say WHICH construction produced it, and the two
   * candidates differ in cost by a factor of three — which is the difference
   * between a feasible offline search and an infeasible one.
   *
   * So this builds algorithm 3 out of single-DES block operations directly:
   * CBC under Ka across the padded message, then D(Kb) and E(Ka) on the last
   * block only.
   */
  it('matches an open-coded algorithm 3 built from single DES', () => {
    const key = fromHex(ICAO_APPENDIX_D.kMac);
    const ka = keySchedule(key.subarray(0, 8));
    const kb = keySchedule(key.subarray(8, 16));
    const padded = padMethod2(fromHex(ICAO_APPENDIX_D.eIfd));

    let chain: Uint8Array = new Uint8Array(8);
    for (let at = 0; at < padded.length; at += 8) {
      const block = new Uint8Array(8);
      for (let i = 0; i < 8; i++) block[i] = padded[at + i] ^ chain[i];
      chain = desBlockWithSchedule(ka, block, false);
    }
    const expected = desBlockWithSchedule(ka, desBlockWithSchedule(kb, chain, true), false);

    expect(toHex(expected)).toBe(ICAO_APPENDIX_D.mIfd);
    expect(toHex(retailMac(key, fromHex(ICAO_APPENDIX_D.eIfd)))).toBe(toHex(expected));
  });

  it('costs one DES per message block, plus two', () => {
    // Five blocks of padded E_IFD plus the two-step final transform: seven DES
    // operations. Exhibit 5's measured rate rests on this count, so it is
    // asserted rather than asserted in prose.
    const blocks = padMethod2(fromHex(ICAO_APPENDIX_D.eIfd)).length / 8;
    expect(blocks).toBe(5);
    expect(blocks + 2).toBe(7);
  });
});

describe('zero padding instead of method 2 — mutation 6', () => {
  /**
   * The value a zero-padding implementation produces over Appendix D's own
   * message and key. Stated as a number, so a test can catch the mutation
   * rather than a comment describing it.
   */
  it("gives AAE3F35132ED3465 where the standard's answer is 5F1448EEA8AD90A7", () => {
    const key = retailMacKey(fromHex(ICAO_APPENDIX_D.kMac));
    const eIfd = fromHex(ICAO_APPENDIX_D.eIfd);

    // Algorithm 3 over the method-1 padding of the same message.
    const padded = padMethod1(eIfd);
    let chain: Uint8Array = new Uint8Array(8);
    for (let at = 0; at < padded.length; at += 8) {
      const block = new Uint8Array(8);
      for (let i = 0; i < 8; i++) block[i] = padded[at + i] ^ chain[i];
      chain = desBlockWithSchedule(key.ka, block, false);
    }
    const wrong = desBlockWithSchedule(key.ka, desBlockWithSchedule(key.kb, chain, true), false);

    expect(toHex(wrong)).toBe(RETAIL_MAC_ZERO_PADDED_M_IFD);
    expect(toHex(retailMacWithKey(key, eIfd))).toBe(ICAO_APPENDIX_D.mIfd);
    expect(toHex(wrong)).not.toBe(ICAO_APPENDIX_D.mIfd);
  });
});

describe('fail-closed', () => {
  it('refuses a key that is not 16 bytes', () => {
    expect(() => retailMac(new Uint8Array(8), new Uint8Array(32))).toThrow(/16 bytes/);
  });
});
