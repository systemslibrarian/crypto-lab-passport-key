import { describe, expect, it } from 'vitest';
import { bytesEqual, concat, fromHex, toHex } from './bytes';
import {
  chipReply,
  CRYPTOGRAM_BYTES,
  establishSession,
  getChallenge,
  KEYING_MATERIAL_BYTES,
  NONCE_BYTES,
  randomBytes,
  readerCheckReply,
  readerMessage,
  record,
  runHandshake,
} from './bac';
import { basicAccessKeys, keysFromPrintedData } from './kdf';
import { cbcEncrypt, tripleDesKey } from './des';
import { retailMac } from './retailmac';
import { ICAO_APPENDIX_D, SECOND_VECTOR } from './vectors';

const specimen = {
  documentNumber: ICAO_APPENDIX_D.documentNumber,
  dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
  dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
};

function specimenKeys() {
  return keysFromPrintedData(specimen).keys;
}

describe('the sizes Section 4.3.1 fixes', () => {
  it('uses 8-byte nonces and 16 bytes of keying material', () => {
    // "Exchanged nonces MUST be of size 8 bytes, exchanged keying material
    // MUST be of size 16 bytes." The 2005 Juels-Molnar-Wagner paper's figure
    // shows 64-bit keying material from each side; the standard's worked
    // example uses 16 bytes, and the standard is what this follows.
    expect(NONCE_BYTES).toBe(8);
    expect(KEYING_MATERIAL_BYTES).toBe(16);
    expect(CRYPTOGRAM_BYTES).toBe(32);
    expect(fromHex(ICAO_APPENDIX_D.kIfd).length).toBe(16);
    expect(fromHex(ICAO_APPENDIX_D.eIfd).length).toBe(32);
  });

  it('refuses a nonce or keying material of the wrong size', () => {
    const keys = specimenKeys();
    expect(() => getChallenge(new Uint8Array(7))).toThrow(/RND.IC is 8 bytes/);
    const challenge = getChallenge(fromHex(ICAO_APPENDIX_D.rndIc));
    expect(() => readerMessage(keys, challenge, new Uint8Array(9))).toThrow(/RND.IFD is 8 bytes/);
    expect(() =>
      readerMessage(keys, challenge, fromHex(ICAO_APPENDIX_D.rndIfd), new Uint8Array(8))
    ).toThrow(/K.IFD is 16 bytes/);
  });
});

describe("the handshake, against Appendix D.3", () => {
  const keys = specimenKeys();
  const challenge = getChallenge(fromHex(ICAO_APPENDIX_D.rndIc));
  const reader = readerMessage(
    keys,
    challenge,
    fromHex(ICAO_APPENDIX_D.rndIfd),
    fromHex(ICAO_APPENDIX_D.kIfd)
  );

  it('forms S as RND.IFD ‖ RND.IC ‖ K.IFD — mutation 8', () => {
    // The sender's own nonce comes FIRST in S. Appendix D.3 step 3 prints the
    // whole concatenation, so the order is pinned by a value rather than by
    // the verdict a wrong order would produce.
    expect(toHex(reader.s)).toBe(ICAO_APPENDIX_D.s);
    expect(toHex(reader.s.slice(0, 8))).toBe(ICAO_APPENDIX_D.rndIfd);
    expect(toHex(reader.s.slice(8, 16))).toBe(ICAO_APPENDIX_D.rndIc);
    const wrongOrder = concat(
      fromHex(ICAO_APPENDIX_D.rndIc),
      fromHex(ICAO_APPENDIX_D.rndIfd),
      fromHex(ICAO_APPENDIX_D.kIfd)
    );
    expect(toHex(cbcEncrypt(tripleDesKey(keys.enc.key), wrongOrder))).not.toBe(
      ICAO_APPENDIX_D.eIfd
    );
  });

  it("reproduces E_IFD and M_IFD", () => {
    expect(toHex(reader.eIfd)).toBe(ICAO_APPENDIX_D.eIfd);
    expect(toHex(reader.mIfd)).toBe(ICAO_APPENDIX_D.mIfd);
  });

  it("reproduces the chip's R, E_IC and M_IC", () => {
    const reply = chipReply(keys, challenge, reader.eIfd, reader.mIfd, fromHex(ICAO_APPENDIX_D.kIc));
    expect(reply.accepted).toBe(true);
    if (!reply.accepted) return;
    expect(toHex(reply.r)).toBe(ICAO_APPENDIX_D.r);
    expect(toHex(reply.r.slice(0, 8))).toBe(ICAO_APPENDIX_D.rndIc);
    expect(toHex(reply.eIc)).toBe(ICAO_APPENDIX_D.eIc);
    expect(toHex(reply.mIc)).toBe(ICAO_APPENDIX_D.mIc);
  });

  it("reproduces the session keys and the send sequence counter", () => {
    const reply = chipReply(keys, challenge, reader.eIfd, reader.mIfd, fromHex(ICAO_APPENDIX_D.kIc));
    expect(reply.accepted).toBe(true);
    if (!reply.accepted) return;
    expect(toHex(reply.session.seed)).toBe(ICAO_APPENDIX_D.sessionSeed);
    expect(toHex(reply.session.keys.enc.key)).toBe(ICAO_APPENDIX_D.ksEnc);
    expect(toHex(reply.session.keys.mac.key)).toBe(ICAO_APPENDIX_D.ksMac);
    expect(toHex(reply.session.sendSequenceCounter)).toBe(ICAO_APPENDIX_D.sendSequenceCounter);
  });

  it('takes the LAST four bytes of each nonce for the SSC — mutation 10', () => {
    const rndIc = fromHex(ICAO_APPENDIX_D.rndIc);
    const rndIfd = fromHex(ICAO_APPENDIX_D.rndIfd);
    const session = establishSession(
      fromHex(ICAO_APPENDIX_D.kIfd),
      fromHex(ICAO_APPENDIX_D.kIc),
      rndIc,
      rndIfd
    );
    expect(toHex(session.sendSequenceCounter)).toBe(ICAO_APPENDIX_D.sendSequenceCounter);
    // 4608F919|88702212 and 78172386|0C06C226 -> 88702212 0C06C226.
    const firstFour = toHex(concat(rndIc.slice(0, 4), rndIfd.slice(0, 4)));
    expect(firstFour).toBe('4608F91978172386');
    expect(firstFour).not.toBe(ICAO_APPENDIX_D.sendSequenceCounter);
  });

  it('runs all three passes and both sides accept', () => {
    const handshake = runHandshake(keys, {
      rndIc: fromHex(ICAO_APPENDIX_D.rndIc),
      rndIfd: fromHex(ICAO_APPENDIX_D.rndIfd),
      kIfd: fromHex(ICAO_APPENDIX_D.kIfd),
      kIc: fromHex(ICAO_APPENDIX_D.kIc),
    });
    expect(handshake.chip.accepted).toBe(true);
    expect(handshake.readerVerdict?.accepted).toBe(true);
  });

  it('has both sides agree on the session keys', () => {
    const handshake = runHandshake(keys, {
      rndIc: fromHex(ICAO_APPENDIX_D.rndIc),
      rndIfd: fromHex(ICAO_APPENDIX_D.rndIfd),
      kIfd: fromHex(ICAO_APPENDIX_D.kIfd),
      kIc: fromHex(ICAO_APPENDIX_D.kIc),
    });
    if (!handshake.chip.accepted || !handshake.readerVerdict?.accepted) {
      expect.unreachable('both sides should accept');
      return;
    }
    expect(toHex(handshake.readerVerdict.session.keys.enc.key)).toBe(
      toHex(handshake.chip.session.keys.enc.key)
    );
    expect(toHex(handshake.readerVerdict.session.sendSequenceCounter)).toBe(
      toHex(handshake.chip.session.sendSequenceCounter)
    );
  });
});

describe("the second vector's reader message", () => {
  it('reproduces E_IFD and M_IFD with letters in the document number', () => {
    const keys = basicAccessKeys(fromHex(SECOND_VECTOR.kSeed));
    const challenge = getChallenge(fromHex(SECOND_VECTOR.rndIc));
    const reader = readerMessage(
      keys,
      challenge,
      fromHex(SECOND_VECTOR.rndIfd),
      fromHex(SECOND_VECTOR.kIfd)
    );
    expect(toHex(reader.eIfd)).toBe(SECOND_VECTOR.eIfd);
    expect(toHex(reader.mIfd)).toBe(SECOND_VECTOR.mIfd);
  });
});

describe('a live run with fresh nonces', () => {
  it('succeeds, and never twice the same way', () => {
    const keys = specimenKeys();
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const handshake = runHandshake(keys);
      expect(handshake.chip.accepted, 'a fresh run must succeed').toBe(true);
      expect(handshake.readerVerdict?.accepted).toBe(true);
      seen.add(toHex(handshake.reader.eIfd));
    }
    // Fresh nonces from crypto.getRandomValues: 25 distinct cryptograms.
    expect(seen.size).toBe(25);
  });

  it('draws nonces from crypto.getRandomValues, not a counter', () => {
    const drawn = new Set<string>();
    for (let i = 0; i < 64; i++) drawn.add(toHex(randomBytes(8)));
    expect(drawn.size).toBe(64);
  });
});

describe('fail-closed: a tampered cryptogram', () => {
  const keys = specimenKeys();

  it('is rejected by the chip, which never decrypts it', () => {
    for (let byte = 0; byte < 32; byte += 7) {
      const handshake = runHandshake(keys, { tamperEIfdByte: byte });
      expect(handshake.chip.accepted, `byte ${byte}`).toBe(false);
      if (handshake.chip.accepted) continue;
      expect(handshake.chip.reason).toBe('mac-mismatch');
      expect(handshake.chip.detail).toMatch(/never decrypts/);
    }
  });

  it('produces no session keys at all', () => {
    const handshake = runHandshake(keys, { tamperEIfdByte: 0 });
    expect(handshake.chip.accepted).toBe(false);
    // Nothing partial: the reader is never even asked for a verdict.
    expect(handshake.readerVerdict).toBeNull();
    expect(handshake.chip).not.toHaveProperty('session');
  });

  it('is rejected when the CHECKSUM is tampered instead', () => {
    for (let byte = 0; byte < 8; byte++) {
      const handshake = runHandshake(keys, { tamperMIfdByte: byte });
      expect(handshake.chip.accepted, `M_IFD byte ${byte}`).toBe(false);
      if (!handshake.chip.accepted) expect(handshake.chip.reason).toBe('mac-mismatch');
    }
  });

  it('notices a flip in ANY of the eight checksum bytes — invariant 5', () => {
    /**
     * This is what makes "the MAC comparison covers all 8 bytes" a
     * measurement. A comparison that stopped at four bytes would still reject
     * every case above — a one-bit flip in byte 0 fails either way — so the
     * loop runs over each byte individually and the last four are the ones
     * that matter.
     */
    const challenge = getChallenge(fromHex(ICAO_APPENDIX_D.rndIc));
    const reader = readerMessage(
      keys,
      challenge,
      fromHex(ICAO_APPENDIX_D.rndIfd),
      fromHex(ICAO_APPENDIX_D.kIfd)
    );
    for (let byte = 4; byte < 8; byte++) {
      const mIfd = new Uint8Array(reader.mIfd);
      mIfd[byte] ^= 0x80;
      const reply = chipReply(keys, challenge, reader.eIfd, mIfd);
      expect(reply.accepted, `a flip in checksum byte ${byte} must be caught`).toBe(false);
    }
  });

  it('refuses a cryptogram of the wrong length', () => {
    const challenge = getChallenge();
    const reply = chipReply(keys, challenge, new Uint8Array(24), new Uint8Array(8));
    expect(reply.accepted).toBe(false);
    if (!reply.accepted) expect(reply.reason).toBe('length');
  });
});

describe('fail-closed: a valid cryptogram from the wrong session', () => {
  /**
   * The fixture mutation 11 exists for.
   *
   * A chip that checks the MAC and skips the nonce comparison still rejects
   * every tampered message, because tampering breaks the MAC. The only thing
   * that catches it is a cryptogram whose MAC is PERFECTLY VALID and whose
   * nonce is wrong — which is exactly a replay of a recorded session against a
   * chip that has since issued a new challenge.
   */
  const keys = specimenKeys();

  it('is rejected by the chip for the nonce, not the checksum', () => {
    const oldChallenge = getChallenge(fromHex(ICAO_APPENDIX_D.rndIc));
    const recorded = readerMessage(keys, oldChallenge);

    // The chip has moved on: a different challenge, same document keys.
    const newChallenge = getChallenge();
    expect(bytesEqual(newChallenge.rndIc, oldChallenge.rndIc)).toBe(false);

    const reply = chipReply(keys, newChallenge, recorded.eIfd, recorded.mIfd);
    expect(reply.accepted).toBe(false);
    if (reply.accepted) return;
    expect(reply.reason).toBe('nonce-mismatch');
    // And the page must say WHY, since this is the interesting rejection.
    expect(reply.detail).toMatch(/replay/);
    expect(reply.detail).toMatch(/checksum verified/);
  });

  it('would have passed a checksum-only check', () => {
    // Stated explicitly: the recorded message's MAC really is valid under the
    // chip's own K_MAC. So a MAC-only chip accepts a replay.
    const oldChallenge = getChallenge(fromHex(ICAO_APPENDIX_D.rndIc));
    const recorded = readerMessage(keys, oldChallenge);
    expect(toHex(retailMac(keys.mac.key, recorded.eIfd))).toBe(toHex(recorded.mIfd));
  });
});

describe("fail-closed: the chip's reply carries the wrong RND.IFD", () => {
  it('is rejected by the reader', () => {
    const keys = specimenKeys();
    const challenge = getChallenge();
    const sent = readerMessage(keys, challenge);

    // A reply that is internally valid but echoes a nonce the reader never
    // sent: R built with someone else's RND.IFD, MACed correctly.
    const wrongR = concat(challenge.rndIc, randomBytes(8), randomBytes(16));
    const eIc = cbcEncrypt(tripleDesKey(keys.enc.key), wrongR);
    const mIc = retailMac(keys.mac.key, eIc);

    const verdict = readerCheckReply(keys, sent, eIc, mIc);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) {
      expect(verdict.reason).toBe('nonce-mismatch');
      expect(verdict.detail).toMatch(/different session/);
    }
  });

  it('is rejected when the reply checksum is wrong', () => {
    const keys = specimenKeys();
    const challenge = getChallenge();
    const sent = readerMessage(keys, challenge);
    const reply = chipReply(keys, challenge, sent.eIfd, sent.mIfd);
    expect(reply.accepted).toBe(true);
    if (!reply.accepted) return;
    const mIc = new Uint8Array(reply.mIc);
    mIc[7] ^= 0x01;
    const verdict = readerCheckReply(keys, sent, reply.eIc, mIc);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) expect(verdict.reason).toBe('mac-mismatch');
  });
});

describe('a recording carries only what crossed the air — invariant 3', () => {
  it('holds E_IFD and M_IFD and nothing else', () => {
    const keys = specimenKeys();
    const handshake = runHandshake(keys);
    const recording = record(handshake);

    // Asserted at runtime, not just in the type: the worker boundary is a
    // postMessage, which erases types entirely.
    expect(Object.keys(recording).sort()).toEqual(['eIfd', 'mIfd']);
    expect(recording.eIfd.length).toBe(32);
    expect(recording.mIfd.length).toBe(8);

    // None of the secrets appear anywhere in a serialized recording.
    const serialized = JSON.stringify(recording, (_k, v) =>
      v instanceof Uint8Array ? toHex(v) : v
    );
    for (const secret of [
      toHex(keys.enc.key),
      toHex(keys.mac.key),
      toHex(keys.kSeed),
      toHex(handshake.reader.kIfd),
      toHex(handshake.reader.rndIfd),
      toHex(handshake.challenge.rndIc),
    ]) {
      expect(serialized, `a recording must not carry ${secret}`).not.toContain(secret);
    }
  });
});
