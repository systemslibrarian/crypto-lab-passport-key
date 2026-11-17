import { describe, expect, it } from 'vitest';
import { bytesEqual, fromHex, toHex } from './bytes';
import { basicAccessKeys, keysFromPrintedData } from './kdf';
import { cbcDecrypt, tripleDesKey } from './des';
import { getChallenge, randomBytes, readerMessage, record, runHandshake } from './bac';
import {
  assertNoSecrets,
  datesInYear,
  datesInYears,
  keysFromHit,
  search,
  spaceSize,
  type SearchTask,
} from './search';
import { ICAO_APPENDIX_D } from './vectors';

const specimen = {
  documentNumber: ICAO_APPENDIX_D.documentNumber,
  dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
  dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
};

describe('enumerating the declared space', () => {
  it('gives 365 days in a common year and 366 in a leap year', () => {
    expect(datesInYear(69)).toHaveLength(365);
    expect(datesInYear(68)).toHaveLength(366);
    expect(datesInYear(0)).toHaveLength(366);
  });

  it('includes 29 February only in a leap year', () => {
    expect(datesInYear(68)).toContain('680229');
    expect(datesInYear(69)).not.toContain('690229');
  });

  it('starts and ends the year where it should', () => {
    const year = datesInYear(69);
    expect(year[0]).toBe('690101');
    expect(year[year.length - 1]).toBe('691231');
  });

  it('refuses a year that is not two digits', () => {
    expect(() => datesInYear(100)).toThrow(/two-digit/);
    expect(() => datesInYear(-1)).toThrow(/two-digit/);
  });

  it('sizes a space as the product of its two date lists', () => {
    // The 366 x 365 space of acceptance check E and of exhibit 4's last row.
    const known = { documentNumber: 'L898902C<', birthYears: [68], expiryYears: [94] };
    expect(spaceSize(known)).toBe(366 * 365);
    expect(spaceSize(known)).toBe(133_590);
  });

  it('concatenates multiple declared years', () => {
    expect(datesInYears([68, 69])).toHaveLength(366 + 365);
  });
});

describe('invariant 3: the searcher gets the recording and nothing else', () => {
  it('accepts a task of exactly the right shape', () => {
    const handshake = runHandshake(keysFromPrintedData(specimen).keys);
    const task: SearchTask = {
      known: { documentNumber: specimen.documentNumber, birthYears: [69], expiryYears: [94] },
      recording: record(handshake),
    };
    expect(() => assertNoSecrets(task)).not.toThrow();
  });

  it('refuses a task carrying anything else at the top level', () => {
    const handshake = runHandshake(keysFromPrintedData(specimen).keys);
    const sneaky = {
      known: { documentNumber: 'L898902C<', birthYears: [69], expiryYears: [94] },
      recording: record(handshake),
      keys: handshake.keys,
    } as unknown as SearchTask;
    expect(() => assertNoSecrets(sneaky)).toThrow(/exactly \{ known, recording \}/);
  });

  it('refuses a recording carrying more than the two recorded fields', () => {
    const handshake = runHandshake(keysFromPrintedData(specimen).keys);
    const sneaky = {
      known: { documentNumber: 'L898902C<', birthYears: [69], expiryYears: [94] },
      recording: { ...record(handshake), kIfd: handshake.reader.kIfd },
    } as unknown as SearchTask;
    expect(() => assertNoSecrets(sneaky)).toThrow(/exactly \{ eIfd, mIfd \}/);
  });

  it('refuses declared knowledge carrying a date', () => {
    // The shape that would make the whole exhibit circular: telling the
    // searcher the answer and then reporting that it found it.
    const handshake = runHandshake(keysFromPrintedData(specimen).keys);
    const sneaky = {
      known: {
        documentNumber: 'L898902C<',
        birthYears: [69],
        expiryYears: [94],
        dateOfBirth: '690806',
      },
      recording: record(handshake),
    } as unknown as SearchTask;
    expect(() => assertNoSecrets(sneaky)).toThrow(/may not carry dateOfBirth/);
  });

  it('sends no secret in a serialized task', () => {
    const result = keysFromPrintedData(specimen);
    const handshake = runHandshake(result.keys);
    const task: SearchTask = {
      known: { documentNumber: specimen.documentNumber, birthYears: [69], expiryYears: [94] },
      recording: record(handshake),
    };
    const serialized = JSON.stringify(task, (_k, v) => (v instanceof Uint8Array ? toHex(v) : v));
    for (const secret of [
      toHex(result.keys.enc.key),
      toHex(result.keys.mac.key),
      toHex(result.keys.kSeed),
      toHex(handshake.reader.kIfd),
      toHex(handshake.reader.rndIfd),
      toHex(handshake.challenge.rndIc),
      specimen.dateOfBirth,
      specimen.dateOfExpiry,
    ]) {
      expect(serialized, `must not carry ${secret}`).not.toContain(secret);
    }
  });
});

describe('acceptance check E: the search finds the true dates', () => {
  /**
   * Twenty trials, each with a random birth date inside a declared 366 x 365
   * space, searched from E_IFD and M_IFD alone.
   *
   * A trial counts as a success only when three things hold:
   *   1. the search reports the TRUE dates — compared afterwards, outside the
   *      search, against values the searcher never had;
   *   2. the keys that the recovered data derives DECRYPT the recording to the
   *      nonces and keying material that were really sent;
   *   3. no EARLIER candidate matched the MAC — i.e. the hit is the first
   *      match in the enumeration, so the search did not stop on a collision.
   *
   * The third is what a MAC-collision bug would violate while still looking
   * like a success, and it is checked by counting the candidates the search
   * tried against the true date's own position in the enumeration.
   */
  const BIRTH_YEAR = 68; // a leap year: 366 days
  const EXPIRY_YEAR = 94;

  /**
   * The timeout carries the measurement rather than capping the work.
   *
   * Twenty trials over a 366 x 365 space stop at the true date, so each tries
   * about half the space — roughly 1.34 million candidates in total. Measured
   * on the development machine at 71,285 guesses/sec (133,225 candidates in
   * 1,869 ms), that is about 19 seconds, and the whole test was observed at
   * 20.4 s. 120 s is six times that: generous enough for a slower CI runner,
   * and still a real bound rather than `Infinity`.
   *
   * Vitest measures elapsed time and fails afterwards, so a budget set below
   * the work makes this test report a timeout instead of a cryptographic
   * result — which is why the budget moved and the trial count did not.
   */
  it('recovers the dates in all 20 trials, and decrypts the recording', () => {
    const births = datesInYear(BIRTH_YEAR);
    const expiries = datesInYear(EXPIRY_YEAR);
    const documentNumber = 'AB1234567';

    for (let trial = 0; trial < 20; trial++) {
      const dateOfBirth = births[Math.floor(Math.random() * births.length)];
      const dateOfExpiry = expiries[Math.floor(Math.random() * expiries.length)];
      const truth = { documentNumber, dateOfBirth, dateOfExpiry };

      const derived = keysFromPrintedData(truth);
      const handshake = runHandshake(derived.keys);
      expect(handshake.chip.accepted, 'the handshake itself must succeed').toBe(true);

      const outcome = search({
        known: { documentNumber, birthYears: [BIRTH_YEAR], expiryYears: [EXPIRY_YEAR] },
        recording: record(handshake),
      });

      // 1. The true dates, compared outside the search.
      expect(outcome.outcome, `trial ${trial}`).toBe('found');
      if (outcome.outcome !== 'found') return;
      expect(outcome.dateOfBirth, `trial ${trial} birth`).toBe(dateOfBirth);
      expect(outcome.dateOfExpiry, `trial ${trial} expiry`).toBe(dateOfExpiry);
      expect(outcome.total).toBe(366 * 365);

      // 2. The recovered data derives keys that open the recording.
      const recovered = basicAccessKeys(keysFromHit(outcome).kSeed);
      expect(toHex(recovered.enc.key)).toBe(toHex(derived.keys.enc.key));
      const plaintext = cbcDecrypt(tripleDesKey(recovered.enc.key), handshake.reader.eIfd);
      expect(toHex(plaintext.slice(0, 8))).toBe(toHex(handshake.reader.rndIfd));
      expect(toHex(plaintext.slice(8, 16))).toBe(toHex(handshake.challenge.rndIc));
      expect(toHex(plaintext.slice(16))).toBe(toHex(handshake.reader.kIfd));

      // 3. No earlier candidate matched: the hit is at the true date's own
      // position in the enumeration, so nothing collided before it.
      const position =
        births.indexOf(dateOfBirth) * expiries.length + expiries.indexOf(dateOfExpiry) + 1;
      expect(outcome.tried, `trial ${trial} stopped at the first match`).toBe(position);
    }
  }, 120_000);
});

describe('a space that does not contain the true dates', () => {
  it('reports not-found rather than claiming anything', () => {
    const derived = keysFromPrintedData(specimen);
    const handshake = runHandshake(derived.keys);
    // The specimen was born in 69; search 71 only.
    const outcome = search({
      known: { documentNumber: specimen.documentNumber, birthYears: [71], expiryYears: [94] },
      recording: record(handshake),
    });
    expect(outcome.outcome).toBe('not-found');
    expect(outcome.tried).toBe(365 * 365);
    expect(outcome.total).toBe(365 * 365);
  });

  it('tries every candidate before giving up', () => {
    const derived = keysFromPrintedData(specimen);
    const handshake = runHandshake(derived.keys);
    const outcome = search({
      known: { documentNumber: specimen.documentNumber, birthYears: [71], expiryYears: [71] },
      recording: record(handshake),
    });
    expect(outcome.outcome).toBe('not-found');
    expect(outcome.tried).toBe(spaceSize({ documentNumber: 'x', birthYears: [71], expiryYears: [71] }));
  });

  it('reports not-found when the DOCUMENT NUMBER declared is wrong', () => {
    // A wrong declared field is as fatal as a date outside the window, and
    // the searcher has no way to tell the two apart — which is the honest
    // outcome to report.
    const derived = keysFromPrintedData(specimen);
    const handshake = runHandshake(derived.keys);
    const outcome = search({
      known: { documentNumber: 'XY9999999', birthYears: [69], expiryYears: [94] },
      recording: record(handshake),
    });
    expect(outcome.outcome).toBe('not-found');
  });
});

describe('cancellation', () => {
  it('stops, reports a partial count, and claims nothing', () => {
    const derived = keysFromPrintedData(specimen);
    const handshake = runHandshake(derived.keys);
    let reports = 0;
    const outcome = search(
      {
        known: { documentNumber: specimen.documentNumber, birthYears: [69], expiryYears: [94] },
        recording: record(handshake),
      },
      {
        chunkSize: 128,
        onProgress: () => {
          reports++;
          return false; // cancel at the first report
        },
      }
    );
    expect(outcome.outcome).toBe('cancelled');
    expect(reports).toBe(1);
    expect(outcome.tried).toBe(128);
    expect(outcome.tried).toBeLessThan(outcome.total);
    expect(outcome).not.toHaveProperty('dateOfBirth');
  });

  it('keeps going while progress returns nothing', () => {
    const derived = keysFromPrintedData(specimen);
    const handshake = runHandshake(derived.keys);
    const outcome = search(
      {
        known: { documentNumber: specimen.documentNumber, birthYears: [69], expiryYears: [94] },
        recording: record(handshake),
      },
      { chunkSize: 1024, onProgress: () => undefined }
    );
    expect(outcome.outcome).toBe('found');
  });
});

describe('the MAC comparison covers all eight bytes — mutation 12', () => {
  /**
   * A search that compared only the first four MAC bytes would accept a
   * candidate whose MAC agrees on those four and differs after. Such a
   * collision is far too rare to meet by chance in a test, so this constructs
   * the situation directly: take the recorded MAC, keep its first four bytes,
   * change the fifth, and confirm the full comparison rejects what a truncated
   * one would accept.
   */
  it('rejects a MAC that agrees on the first four bytes only', () => {
    const derived = keysFromPrintedData(specimen);
    const challenge = getChallenge(fromHex(ICAO_APPENDIX_D.rndIc));
    const reader = readerMessage(
      derived.keys,
      challenge,
      fromHex(ICAO_APPENDIX_D.rndIfd),
      fromHex(ICAO_APPENDIX_D.kIfd)
    );
    const truncatedCollision = new Uint8Array(reader.mIfd);
    truncatedCollision[4] ^= 0xff;

    // The first four bytes are identical; the full strings are not.
    expect(bytesEqual(truncatedCollision.slice(0, 4), reader.mIfd.slice(0, 4))).toBe(true);
    expect(bytesEqual(truncatedCollision, reader.mIfd)).toBe(false);

    // So a search against the doctored recording must NOT find the true dates.
    const outcome = search({
      known: { documentNumber: specimen.documentNumber, birthYears: [69], expiryYears: [94] },
      recording: { eIfd: reader.eIfd, mIfd: truncatedCollision },
    });
    expect(outcome.outcome).toBe('not-found');

    // And against the real recording it must find them, so the test above is
    // not passing merely because the search is broken.
    const real = search({
      known: { documentNumber: specimen.documentNumber, birthYears: [69], expiryYears: [94] },
      recording: { eIfd: reader.eIfd, mIfd: reader.mIfd },
    });
    expect(real.outcome).toBe('found');
  });
});

describe('the reported rate', () => {
  it('is guesses divided by elapsed time, from the clock it was given', () => {
    const derived = keysFromPrintedData(specimen);
    const handshake = runHandshake(derived.keys);
    // A fake clock advancing 1ms per call makes the rate exact and the test
    // independent of how fast this machine happens to be.
    let t = 0;
    const outcome = search(
      {
        known: { documentNumber: specimen.documentNumber, birthYears: [71], expiryYears: [71] },
        recording: record(handshake),
      },
      { chunkSize: 1_000_000, now: () => (t += 1000) }
    );
    expect(outcome.outcome).toBe('not-found');
    // 365 x 365 candidates in 1000ms.
    expect(outcome.tried).toBe(133_225);
    expect(outcome.guessesPerSecond).toBeCloseTo(133_225, 0);
  });

  it('is a real measurement on the real clock', () => {
    const derived = keysFromPrintedData(specimen);
    const handshake = runHandshake(derived.keys);
    const outcome = search({
      known: { documentNumber: specimen.documentNumber, birthYears: [69], expiryYears: [94] },
      recording: record(handshake),
    });
    expect(outcome.outcome).toBe('found');
    expect(outcome.elapsedMs).toBeGreaterThan(0);
    expect(outcome.guessesPerSecond).toBeGreaterThan(0);
  });
});

describe('the search uses the same primitives the page displays', () => {
  it("finds Appendix D's own dates from Appendix D's own recording", () => {
    /**
     * The tightest possible check that the search and the standard agree: the
     * recording here is the one printed in Appendix D.3, byte for byte, and
     * the search is given only those bytes.
     */
    const outcome = search({
      known: { documentNumber: ICAO_APPENDIX_D.documentNumber, birthYears: [69], expiryYears: [94] },
      recording: { eIfd: fromHex(ICAO_APPENDIX_D.eIfd), mIfd: fromHex(ICAO_APPENDIX_D.mIfd) },
    });
    expect(outcome.outcome).toBe('found');
    if (outcome.outcome !== 'found') return;
    expect(outcome.dateOfBirth).toBe(ICAO_APPENDIX_D.dateOfBirth);
    expect(outcome.dateOfExpiry).toBe(ICAO_APPENDIX_D.dateOfExpiry);
    expect(outcome.mrzInformation).toBe(ICAO_APPENDIX_D.mrzInformation);
    expect(toHex(keysFromHit(outcome).kSeed)).toBe(ICAO_APPENDIX_D.kSeed);
  });

  it('derives the recorded session keys once it has the printed data', () => {
    const outcome = search({
      known: { documentNumber: ICAO_APPENDIX_D.documentNumber, birthYears: [69], expiryYears: [94] },
      recording: { eIfd: fromHex(ICAO_APPENDIX_D.eIfd), mIfd: fromHex(ICAO_APPENDIX_D.mIfd) },
    });
    expect(outcome.outcome).toBe('found');
    if (outcome.outcome !== 'found') return;
    const keys = basicAccessKeys(keysFromHit(outcome).kSeed);
    expect(toHex(keys.enc.key)).toBe(ICAO_APPENDIX_D.kEnc);
    expect(toHex(keys.mac.key)).toBe(ICAO_APPENDIX_D.kMac);
    // And those keys open the recorded cryptogram to the printed plaintext.
    expect(toHex(cbcDecrypt(tripleDesKey(keys.enc.key), fromHex(ICAO_APPENDIX_D.eIfd)))).toBe(
      ICAO_APPENDIX_D.s
    );
  });
});

describe('the measured rate is plausible for the work per guess', () => {
  it('does not run at a quadratic rate', () => {
    /**
     * A floor of 200 guesses a second, not a benchmark.
     *
     * What this exists to catch is an accidental quadratic — a per-candidate
     * cost that grows with the space, such as rebuilding the date lists or
     * re-deriving a key schedule inside the inner loop. That failure mode is
     * orders of magnitude, not percent, so the floor is set far below the
     * measured rate (71,285/s on the development machine) rather than near it.
     *
     * It was 2,000 and flaked once under parallel load, which is the wrong
     * thing for this assertion to be sensitive to: a loaded CI runner being
     * slow is not a defect, and a test that reports one is a gate nobody
     * trusts. Lowering the floor does not weaken what is measured, because
     * nothing between 200 and 71,285 would be a bug this test could name.
     */
    const derived = keysFromPrintedData(specimen);
    const handshake = runHandshake(derived.keys);
    const outcome = search({
      known: { documentNumber: specimen.documentNumber, birthYears: [71], expiryYears: [71] },
      recording: record(handshake),
    });
    expect(outcome.guessesPerSecond).toBeGreaterThan(200);
  });

  it('uses fresh randomness for every recording it is given', () => {
    expect(toHex(randomBytes(16))).not.toBe(toHex(randomBytes(16)));
  });
});
