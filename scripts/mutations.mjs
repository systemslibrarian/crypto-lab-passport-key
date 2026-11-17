/**
 * The mutation ledger — each entry a CONCRETE PATCH, never a sentence.
 *
 * §4.1c of audits/_MASTER-TEMPLATE.md: for a lab that renders verdict markers,
 * each mutation is recorded as a file, an anchor that must occur EXACTLY ONCE,
 * and its replacement. A sentence describing an edit cannot be replayed; a
 * patch can, and `mutate.mjs` replays all of them on demand.
 *
 * A kill requires four things, and the runner enforces all four:
 *   1. the owning test PASSED unmutated in the same run;
 *   2. the patch actually CHANGED the file;
 *   3. the run served the MUTATED code — proved by the built bundle hash
 *      moving, and by refusing any red run whose output looks like a build
 *      error or a connection failure rather than an assertion;
 *   4. a patch that does not compile is DOES NOT BUILD and is never a kill.
 *
 * The twelve mutations are the ones the brief names. `expect` says which test
 * must go red; `why` says what the mutation gets wrong, in the standard's own
 * terms.
 */

/**
 * A mutation is a FILE plus one or more patches.
 *
 * More than one is occasionally necessary rather than a convenience: mutation
 * 9 removes the only call to `xor`, and `noUnusedLocals` then rejects the
 * now-unused import — so with a single patch the mutation reports DOES NOT
 * BUILD and is never actually tested. Adjusting the import alongside it is
 * part of writing the mutation honestly, not a way of easing it.
 *
 * @typedef {{ anchor: string, replacement: string }} Patch
 * @typedef {{ id: number, name: string, file: string, patches: Patch[], suite: 'vitest'|'playwright', grep: string, why: string }} Mutation
 */

/** @type {Mutation[]} */
export const MUTATIONS = [
  {
    id: 1,
    name: 'check-digit weights reversed to 1, 3, 7',
    file: 'src/bac/mrz.ts',
    patches: [{ anchor: 'export const CHECK_DIGIT_WEIGHTS: readonly number[] = [7, 3, 1];', replacement: 'export const CHECK_DIGIT_WEIGHTS: readonly number[] = [1, 3, 7];' }],
    suite: 'vitest',
    grep: 'check-digit weighting',
    why: 'Doc 9303 Part 3 Section 4.9 specifies "a continuously repetitive weighting of 731 731 ...". Reversed, the specimen\'s digits are no longer 3, 1 and 6.',
  },
  {
    id: 2,
    name: 'check digits left out of MRZ_information',
    file: 'src/bac/mrz.ts',
    patches: [{ anchor: `    value:
      documentNumber +
      documentNumberCheckDigit +
      data.dateOfBirth +
      dateOfBirthCheckDigit +
      data.dateOfExpiry +
      dateOfExpiryCheckDigit,`, replacement: `    value: documentNumber + data.dateOfBirth + data.dateOfExpiry,` }],
    suite: 'vitest',
    grep: 'MRZ_information',
    why: 'Part 11 Section 4.3.2 says the concatenation is "including their respective check digits". Dropping them gives a 21-character string and a different hash.',
  },
  {
    id: 3,
    name: 'K_seed taken as all 20 bytes of the hash',
    file: 'src/bac/kdf.ts',
    patches: [{ anchor: 'export const K_SEED_BYTES = 16;', replacement: 'export const K_SEED_BYTES = 20;' }],
    suite: 'vitest',
    grep: 'printed data to keys',
    why: 'Part 11 Section 4.3.2: "The most significant 16 bytes of the SHA-1 hash". Twenty bytes is not a two-key 3DES key.',
  },
  {
    id: 4,
    name: 'derivation counter written little-endian',
    file: 'src/bac/kdf.ts',
    patches: [{ anchor: `  out[0] = (counter >>> 24) & 0xff;
  out[1] = (counter >>> 16) & 0xff;
  out[2] = (counter >>> 8) & 0xff;
  out[3] = counter & 0xff;`, replacement: `  out[0] = counter & 0xff;
  out[1] = (counter >>> 8) & 0xff;
  out[2] = (counter >>> 16) & 0xff;
  out[3] = (counter >>> 24) & 0xff;` }],
    suite: 'vitest',
    grep: 'counter is a 32-bit big-endian integer',
    why: 'Part 11 Section 9.7.1 requires "A 32-bit, big-endian integer counter c". Appendix D.1 prints the hash input ending 00000001.',
  },
  {
    id: 5,
    name: 'parity adjustment removed',
    file: 'src/bac/kdf.ts',
    patches: [{ anchor: '  return { counter, hashInput, hash, beforeParity, key: adjustParity(beforeParity) };', replacement: '  return { counter, hashInput, hash, beforeParity, key: beforeParity };' }],
    suite: 'vitest',
    grep: 'parity adjustment',
    why: 'The displayed keys of Appendix D change even though no ciphertext does — PC-1 discards parity bits. Only a test comparing KEY BYTES can see it.',
  },
  {
    id: 6,
    name: 'MAC pads with zeros only (method 1, not method 2)',
    file: 'src/bac/retailmac.ts',
    patches: [{ anchor: `  const padded = new Uint8Array(
    message.length + BLOCK_BYTES - (message.length % BLOCK_BYTES)
  );
  padded.set(message, 0);
  padded[message.length] = 0x80;
  return padded;`, replacement: `  if (message.length % BLOCK_BYTES === 0) return new Uint8Array(message);
  const padded = new Uint8Array(
    message.length + BLOCK_BYTES - (message.length % BLOCK_BYTES)
  );
  padded.set(message, 0);
  return padded;` }],
    suite: 'vitest',
    grep: 'retail MAC',
    why: 'Part 11 Section 4.3.3.2 specifies padding method 2. Over the 32-byte E_IFD, method 1 adds nothing where method 2 adds a block: Appendix D\'s 5F1448EEA8AD90A7 becomes AAE3F35132ED3465.',
  },
  {
    id: 7,
    name: 'CBC uses a non-zero IV',
    file: 'src/bac/des.ts',
    patches: [{ anchor: 'export const ZERO_IV: Uint8Array = new Uint8Array(8);', replacement: 'export const ZERO_IV: Uint8Array = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]);' }],
    suite: 'vitest',
    grep: 'handshake, against Appendix D',
    why: 'Part 11 Section 4.3.3.1: "CBC mode with zero IV (i.e. 0x00 00 00 00 00 00 00 00)".',
  },
  {
    id: 8,
    name: "reader's plaintext ordered RND.IC ‖ RND.IFD ‖ K.IFD",
    file: 'src/bac/bac.ts',
    patches: [{ anchor: '  const s = concat(rndIfd, challenge.rndIc, kIfd);', replacement: '  const s = concat(challenge.rndIc, rndIfd, kIfd);' }],
    suite: 'vitest',
    grep: 'forms S as',
    why: 'Part 11 Section 4.3.1 step 2b: "generate the concatenation S = RND.IFD || RND.IC || K.IFD". The sender\'s own nonce comes first.',
  },
  {
    id: 9,
    name: 'session seed formed by concatenation instead of XOR',
    file: 'src/bac/kdf.ts',
    patches: [
      // Two patches, because removing the only call to `xor` leaves an unused
      // import and `noUnusedLocals` rejects the file. Without this the
      // mutation reports DOES NOT BUILD and is never actually tested.
      { anchor: "import { concat, xor } from './bytes';", replacement: "import { concat } from './bytes';" },
      {
        anchor: '  return basicAccessKeys(xor(kIfd, kIc));',
        replacement: '  return basicAccessKeys(concat(kIfd, kIc).slice(0, K_SEED_BYTES));',
      },
    ],
    suite: 'vitest',
    grep: 'session keys',
    why: 'Part 11 Section 4.3.1 step 5 derives the session keys "with (K.IC xor K.IFD) as shared secret".',
  },
  {
    id: 10,
    name: 'send sequence counter from the FIRST four bytes of each nonce',
    file: 'src/bac/bac.ts',
    patches: [{ anchor: '    sendSequenceCounter: concat(rndIc.slice(4), rndIfd.slice(4)),', replacement: '    sendSequenceCounter: concat(rndIc.slice(0, 4), rndIfd.slice(0, 4)),' }],
    suite: 'vitest',
    grep: 'LAST four bytes of each nonce',
    why: "Appendix D.3 prints SSC 887022120C06C226 for RND.IC 4608F91988702212 and RND.IFD 781723860C06C226 — the low halves.",
  },
  {
    id: 11,
    name: 'chip accepts on the checksum alone, without comparing the nonce',
    file: 'src/bac/bac.ts',
    patches: [{ anchor: `  if (!bytesEqual(recoveredRndIc, challenge.rndIc)) {
    return {
      accepted: false,
      reason: 'nonce-mismatch',`, replacement: `  if (false && !bytesEqual(recoveredRndIc, challenge.rndIc)) {
    return {
      accepted: false,
      reason: 'nonce-mismatch',` }],
    suite: 'vitest',
    grep: 'valid cryptogram from the wrong session',
    why: 'Part 11 Section 4.3.1 step 3c requires the chip to "extract RND.IC from S and check if IFD returned the correct value". Only a REPLAY — a valid MAC with the wrong nonce — distinguishes the two behaviours.',
  },
  {
    id: 12,
    name: 'search compares only the first 4 MAC bytes',
    file: 'src/bac/search.ts',
    patches: [{ anchor: '      if (bytesEqual(retailMacWithKey(retailMacKey(kMac), eIfd), recordedMac)) {', replacement: '      if (bytesEqual(retailMacWithKey(retailMacKey(kMac), eIfd).subarray(0, 4), recordedMac.subarray(0, 4))) {' }],
    suite: 'vitest',
    grep: 'covers all eight bytes',
    why: 'Invariant 5: the MAC comparison covers all 8 bytes. A truncated comparison accepts a candidate agreeing on four bytes, which the test constructs directly rather than waiting to meet by chance.',
  },

  /* ── The negative claim's own bite checks (§4.1d) ───────────────────────── */
  //
  // §4.1d requires the negative-claim test to be shown to bite, two ways:
  // "Delete the negative-claim text and assertion 3 must fail; break a check
  // inside the fixture and assertion 2 must fail. A negative-claim test that
  // survives both is decorative."
  //
  // They are mutations like any other, so they are recorded as patches and
  // replayed by the same runner rather than described in a paragraph. Both run
  // against the browser, so the runner also requires the built bundle hash to
  // move before it will count either as a kill.
  {
    id: 13,
    name: 'the negative-claim sentence is deleted from the page',
    file: 'src/ui/offlineSearch.ts',
    patches: [
      {
        anchor: "        el('p', { id: 'negative-claim', text: NEGATIVE_CLAIM }),",
        replacement: "        el('p', { id: 'negative-claim-removed', text: '' }),",
      },
    ],
    suite: 'playwright',
    grep: 'the negative claim',
    why: '§4.1d assertion 3: the limitation must be ON SCREEN in the fixture state. With the sentence gone the claim is a disclaimer in a README, which is what this rule exists to prevent.',
  },
  {
    id: 14,
    name: 'a check inside the evidence fixture is broken',
    file: 'src/ui/offlineSearch.ts',
    patches: [
      {
        // The two fields are COMPARED AGAINST EACH OTHER'S truth, which is a
        // plausible slip and, unlike `const datesMatch = false`, leaves
        // `truth` used so the file still compiles. A mutation that cannot
        // compile is never a kill, so it would have proved nothing.
        anchor: `  const datesMatch =
    truth !== null &&
    hit.dateOfBirth === truth.dateOfBirth &&
    hit.dateOfExpiry === truth.dateOfExpiry;`,
        replacement: `  const datesMatch =
    truth !== null &&
    hit.dateOfBirth === truth.dateOfExpiry &&
    hit.dateOfExpiry === truth.dateOfBirth;`,
      },
    ],
    suite: 'playwright',
    grep: 'the negative claim',
    why: '§4.1d assertion 2: every verdict in the fixture state must report success. If one fails, the fixture is demonstrating the mechanism breaking rather than its limit, and the claim is not earned.',
  },
];
