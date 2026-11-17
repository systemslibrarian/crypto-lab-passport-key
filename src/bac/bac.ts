/**
 * Basic Access Control: both sides of the three-pass handshake.
 *
 * ICAO Doc 9303 Part 11 Section 4.3.1 specifies the protocol as
 * "[ISO/IEC 11770-2] Key Establishment Mechanism 6 using 3DES [FIPS 46-3] as
 * block cipher", with "Exchanged nonces MUST be of size 8 bytes, exchanged
 * keying material MUST be of size 16 bytes."
 *
 * The three passes, in the standard's own order:
 *
 *   1. The reader sends GET CHALLENGE. The chip answers with a nonce RND.IC.
 *   2. The reader picks RND.IFD and K.IFD, forms **S = RND.IFD ‖ RND.IC ‖
 *      K.IFD**, sends E_IFD = E(K_Enc, S) with M_IFD = MAC(K_MAC, E_IFD).
 *   3. The chip checks the MAC, decrypts, checks its OWN nonce came back,
 *      picks K.IC, forms **R = RND.IC ‖ RND.IFD ‖ K.IC**, and answers with
 *      E_IC and M_IC.
 *
 * Both sides then derive session keys from K.IC xor K.IFD and set the send
 * sequence counter.
 *
 * Note the field order reverses between S and R — the sender's own nonce comes
 * first in each. Getting that backwards in the reader's message is mutation 8;
 * it produces a cryptogram the chip decrypts to the wrong nonce and rejects,
 * which is the right behaviour for the wrong reason, so the test pins the
 * cryptogram against Appendix D rather than the verdict.
 *
 * ## What "accepted" means here
 *
 * Invariant 5: a handshake is accepted only if the MAC verifies AND the
 * decrypted nonce equals the one sent. Both, every time, and the MAC
 * comparison covers all eight bytes (`bytesEqual` in `bytes.ts`). Checking the
 * MAC and skipping the nonce is mutation 11 — and a MAC-only check still
 * rejects a tampered cryptogram, so the only thing that notices is a test
 * that replays a VALID cryptogram carrying the wrong nonce. `bac.test.ts`
 * builds exactly that.
 */
import { bytesEqual, concat, toHex } from './bytes';
import { cbcDecrypt, cbcEncrypt, tripleDesKey } from './des';
import { retailMac } from './retailmac';
import { sessionKeys, type BasicAccessKeys } from './kdf';

/** Part 11 Section 4.3.1: nonces are 8 bytes. */
export const NONCE_BYTES = 8;
/** Part 11 Section 4.3.1: keying material is 16 bytes. */
export const KEYING_MATERIAL_BYTES = 16;
/** S and R are 8 + 8 + 16 bytes, so each cryptogram is 32. */
export const CRYPTOGRAM_BYTES = NONCE_BYTES * 2 + KEYING_MATERIAL_BYTES;

/**
 * Fresh random bytes from the platform CSPRNG.
 *
 * Invariant 4: nonces and keying material come from `crypto.getRandomValues`.
 * Nothing in this lab derives a nonce from a clock, a counter or `Math.random`
 * — which matters because the whole point of exhibit 5 is that the recorded
 * session's secrecy rests on the PRINTED data, not on the nonces. If the
 * nonces were guessable the exhibit would be demonstrating the wrong flaw.
 */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/* ── Pass 1: the chip's challenge ─────────────────────────────────────────── */

/** What the chip answers GET CHALLENGE with, and remembers. */
export interface Challenge {
  readonly rndIc: Uint8Array;
}

export function getChallenge(rndIc: Uint8Array = randomBytes(NONCE_BYTES)): Challenge {
  assertLength(rndIc, NONCE_BYTES, 'RND.IC');
  return { rndIc };
}

/* ── Pass 2: the reader's EXTERNAL AUTHENTICATE ───────────────────────────── */

/** Everything the reader sends, plus the values it keeps to check the reply. */
export interface ReaderMessage {
  readonly rndIfd: Uint8Array;
  readonly rndIc: Uint8Array;
  readonly kIfd: Uint8Array;
  /** S = RND.IFD ‖ RND.IC ‖ K.IFD. */
  readonly s: Uint8Array;
  /** E_IFD = E(K_Enc, S), 32 bytes. */
  readonly eIfd: Uint8Array;
  /** M_IFD = MAC(K_MAC, E_IFD), 8 bytes. */
  readonly mIfd: Uint8Array;
}

export function readerMessage(
  keys: BasicAccessKeys,
  challenge: Challenge,
  rndIfd: Uint8Array = randomBytes(NONCE_BYTES),
  kIfd: Uint8Array = randomBytes(KEYING_MATERIAL_BYTES)
): ReaderMessage {
  assertLength(rndIfd, NONCE_BYTES, 'RND.IFD');
  assertLength(kIfd, KEYING_MATERIAL_BYTES, 'K.IFD');
  // Section 4.3.1 step 2b: the reader's own nonce first.
  const s = concat(rndIfd, challenge.rndIc, kIfd);
  const eIfd = cbcEncrypt(tripleDesKey(keys.enc.key), s);
  const mIfd = retailMac(keys.mac.key, eIfd);
  return { rndIfd, rndIc: challenge.rndIc, kIfd, s, eIfd, mIfd };
}

/* ── Pass 3: the chip's reply, or its refusal ─────────────────────────────── */

/** Why a side refused. Each is surfaced in the UI as its own message. */
export type RejectionReason =
  | 'mac-mismatch'
  | 'nonce-mismatch'
  | 'length';

export interface Rejection {
  readonly accepted: false;
  readonly reason: RejectionReason;
  /** A sentence naming the actual cause, for the panel to render. */
  readonly detail: string;
}

export interface ChipReply {
  readonly accepted: true;
  readonly kIc: Uint8Array;
  /** The nonce the chip recovered from S, which must equal its own. */
  readonly recoveredRndIc: Uint8Array;
  /** The reader nonce the chip recovered, which it echoes back in R. */
  readonly recoveredRndIfd: Uint8Array;
  readonly recoveredKIfd: Uint8Array;
  /** R = RND.IC ‖ RND.IFD ‖ K.IC. */
  readonly r: Uint8Array;
  readonly eIc: Uint8Array;
  readonly mIc: Uint8Array;
  readonly session: SessionState;
}

/**
 * The chip's side of pass 3 (Section 4.3.1 step 3).
 *
 * The order of the checks is the standard's: check the checksum, THEN decrypt,
 * then extract and compare the nonce. A failure at any point returns a
 * Rejection and no session keys are produced — there is nothing partial to
 * show, which is what "fails closed" means here.
 */
export function chipReply(
  keys: BasicAccessKeys,
  challenge: Challenge,
  eIfd: Uint8Array,
  mIfd: Uint8Array,
  kIc: Uint8Array = randomBytes(KEYING_MATERIAL_BYTES)
): ChipReply | Rejection {
  if (eIfd.length !== CRYPTOGRAM_BYTES || mIfd.length !== 8) {
    return {
      accepted: false,
      reason: 'length',
      detail:
        `EXTERNAL AUTHENTICATE carries ${CRYPTOGRAM_BYTES} bytes of cryptogram and 8 of checksum; ` +
        `this one has ${eIfd.length} and ${mIfd.length}.`,
    };
  }

  // Step 3a: check the checksum of the cryptogram. All eight bytes.
  const expected = retailMac(keys.mac.key, eIfd);
  if (!bytesEqual(expected, mIfd)) {
    return {
      accepted: false,
      reason: 'mac-mismatch',
      detail:
        `The checksum does not match: the chip computed ${toHex(expected)} over the cryptogram ` +
        `it received, and was sent ${toHex(mIfd)}. It stops here and never decrypts.`,
    };
  }

  // Step 3b: decrypt. Step 3c: extract RND.IC and check it.
  const s = cbcDecrypt(tripleDesKey(keys.enc.key), eIfd);
  const recoveredRndIfd = s.slice(0, NONCE_BYTES);
  const recoveredRndIc = s.slice(NONCE_BYTES, NONCE_BYTES * 2);
  const recoveredKIfd = s.slice(NONCE_BYTES * 2);
  if (!bytesEqual(recoveredRndIc, challenge.rndIc)) {
    return {
      accepted: false,
      reason: 'nonce-mismatch',
      detail:
        `The cryptogram carries ${toHex(recoveredRndIc)} where the chip's own challenge was ` +
        `${toHex(challenge.rndIc)}. The checksum verified, so this is a replay of a valid ` +
        'message from another session, not a corrupted one.',
    };
  }

  // Steps 3d-3g: the chip's own keying material, and its reply.
  assertLength(kIc, KEYING_MATERIAL_BYTES, 'K.IC');
  const r = concat(challenge.rndIc, recoveredRndIfd, kIc);
  const eIc = cbcEncrypt(tripleDesKey(keys.enc.key), r);
  const mIc = retailMac(keys.mac.key, eIc);

  return {
    accepted: true,
    kIc,
    recoveredRndIc,
    recoveredRndIfd,
    recoveredKIfd,
    r,
    eIc,
    mIc,
    session: establishSession(recoveredKIfd, kIc, challenge.rndIc, recoveredRndIfd),
  };
}

/* ── The reader checks the reply ──────────────────────────────────────────── */

export interface ReaderAccept {
  readonly accepted: true;
  readonly kIc: Uint8Array;
  readonly recoveredRndIfd: Uint8Array;
  readonly session: SessionState;
}

/** The reader's side of pass 4 (Section 4.3.1 step 4). */
export function readerCheckReply(
  keys: BasicAccessKeys,
  sent: ReaderMessage,
  eIc: Uint8Array,
  mIc: Uint8Array
): ReaderAccept | Rejection {
  if (eIc.length !== CRYPTOGRAM_BYTES || mIc.length !== 8) {
    return {
      accepted: false,
      reason: 'length',
      detail: `The chip's response should be ${CRYPTOGRAM_BYTES} + 8 bytes; this one is ${eIc.length} + ${mIc.length}.`,
    };
  }
  const expected = retailMac(keys.mac.key, eIc);
  if (!bytesEqual(expected, mIc)) {
    return {
      accepted: false,
      reason: 'mac-mismatch',
      detail: `The reader computed ${toHex(expected)} over the response and was sent ${toHex(mIc)}.`,
    };
  }
  const r = cbcDecrypt(tripleDesKey(keys.enc.key), eIc);
  const recoveredRndIc = r.slice(0, NONCE_BYTES);
  const recoveredRndIfd = r.slice(NONCE_BYTES, NONCE_BYTES * 2);
  const kIc = r.slice(NONCE_BYTES * 2);
  if (!bytesEqual(recoveredRndIfd, sent.rndIfd)) {
    return {
      accepted: false,
      reason: 'nonce-mismatch',
      detail:
        `The response carries ${toHex(recoveredRndIfd)} where the reader sent ` +
        `${toHex(sent.rndIfd)}. The checksum verified, so the chip answered a different session.`,
    };
  }
  void recoveredRndIc;
  return {
    accepted: true,
    kIc,
    recoveredRndIfd,
    session: establishSession(sent.kIfd, kIc, sent.rndIc, sent.rndIfd),
  };
}

/* ── Session state ────────────────────────────────────────────────────────── */

export interface SessionState {
  readonly seed: Uint8Array;
  readonly keys: BasicAccessKeys;
  /**
   * The send sequence counter: the last four bytes of RND.IC followed by the
   * last four of RND.IFD.
   *
   * Part 11 Appendix D.3 prints `887022120C06C226` for RND.IC
   * `4608F91988702212` and RND.IFD `781723860C06C226` — the LOW halves of
   * each, in that order. Taking the first four bytes of each instead is
   * mutation 10, and it is caught by that printed value.
   */
  readonly sendSequenceCounter: Uint8Array;
}

export function establishSession(
  kIfd: Uint8Array,
  kIc: Uint8Array,
  rndIc: Uint8Array,
  rndIfd: Uint8Array
): SessionState {
  const keys = sessionKeys(kIfd, kIc);
  return {
    seed: keys.kSeed,
    keys,
    sendSequenceCounter: concat(rndIc.slice(4), rndIfd.slice(4)),
  };
}

/* ── A whole handshake, for the exhibits ──────────────────────────────────── */

/** Everything a run produces, including what an eavesdropper would have. */
export interface Handshake {
  readonly keys: BasicAccessKeys;
  readonly challenge: Challenge;
  readonly reader: ReaderMessage;
  readonly chip: ChipReply | Rejection;
  readonly readerVerdict: ReaderAccept | Rejection | null;
}

/**
 * Run all three passes.
 *
 * Deterministic when the nonces are supplied, which is how Appendix D is
 * reproduced; random from `crypto.getRandomValues` when they are not, which is
 * how the live run works.
 */
export function runHandshake(
  keys: BasicAccessKeys,
  options: {
    readonly rndIc?: Uint8Array;
    readonly rndIfd?: Uint8Array;
    readonly kIfd?: Uint8Array;
    readonly kIc?: Uint8Array;
    /** Flip one bit of E_IFD before the chip sees it, to watch the MAC fail. */
    readonly tamperEIfdByte?: number;
    /** Flip one bit of M_IFD before the chip sees it. */
    readonly tamperMIfdByte?: number;
  } = {}
): Handshake {
  const challenge = getChallenge(options.rndIc);
  const reader = readerMessage(keys, challenge, options.rndIfd, options.kIfd);

  let eIfd = reader.eIfd;
  let mIfd = reader.mIfd;
  if (options.tamperEIfdByte !== undefined) {
    eIfd = new Uint8Array(eIfd);
    eIfd[options.tamperEIfdByte % eIfd.length] ^= 0x01;
  }
  if (options.tamperMIfdByte !== undefined) {
    mIfd = new Uint8Array(mIfd);
    mIfd[options.tamperMIfdByte % mIfd.length] ^= 0x01;
  }

  const chip = chipReply(keys, challenge, eIfd, mIfd, options.kIc);
  const readerVerdict = chip.accepted
    ? readerCheckReply(keys, reader, chip.eIc, chip.mIc)
    : null;
  return { keys, challenge, reader, chip, readerVerdict };
}

/** A recording: exactly what crosses the air in pass 2, and nothing else. */
export interface Recording {
  readonly eIfd: Uint8Array;
  readonly mIfd: Uint8Array;
}

/**
 * Take a recording of a handshake.
 *
 * Invariant 3: the search worker receives only the recorded bytes. This is the
 * type that enforces it — a `Recording` holds two byte strings and has no
 * field for a key, a nonce or the printed data, so there is nothing for a
 * caller to accidentally pass along. `search.test.ts` asserts the shape as
 * well, because a type is erased at runtime and the worker boundary is a
 * `postMessage`.
 */
export function record(handshake: Handshake): Recording {
  return { eIfd: handshake.reader.eIfd, mIfd: handshake.reader.mIfd };
}

function assertLength(value: Uint8Array, expected: number, name: string): void {
  if (value.length !== expected) {
    throw new Error(`${name} is ${expected} bytes, got ${value.length}`);
  }
}
