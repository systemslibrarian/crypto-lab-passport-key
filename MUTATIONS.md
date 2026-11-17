# Mutation ledger

Run it: `npm run mutate` (or `npm run mutate -- 7` for one).

This file describes the discipline. **It is not the record** — the record is
what `scripts/mutate.mjs` prints when you run it, and `scripts/mutations.mjs`
holds each mutation as a concrete patch so every line below can be reproduced
rather than believed. §4.1c of the fleet template is explicit about why: a
sentence describing an edit cannot be replayed, and a paragraph describing a
run is the author's side of the claim rather than the run's.

## What counts as a kill

Four things, all enforced by the runner:

1. **The baseline passed.** The whole suite runs unmutated first, and the
   owning test is run unmutated again immediately before its own mutation. A
   run that starts red cannot distinguish a kill from a pre-existing failure.
2. **The patch changed the file.** Each anchor must occur *exactly once* —
   twice patches a site nobody intended, zero times patches nothing and leaves
   a green run that reads as a survivor.
3. **The run served the mutated code.** `tsc` must still pass, and for a
   browser mutation the built bundle hash must MOVE. A red run whose output
   matches a build error, a server that never started or a refused connection
   is reported INCONCLUSIVE rather than counted — otherwise a preview server
   that died mid-run reads as fourteen kills.
4. **A patch that does not compile is never a kill.** It is reported DOES NOT
   BUILD, because the suite would otherwise run against the last good bundle
   and pass having checked nothing.

Afterwards the file is restored and the bundle hash is confirmed to return to
its pre-mutation value.

## The mutations

Twelve are the ones the build brief names, each attacking a specific sentence
of ICAO Doc 9303. Two more are the negative claim's own bite checks, which
§4.1d requires.

| # | Mutation | What it gets wrong |
|---|---|---|
| 1 | Check-digit weights reversed to 1, 3, 7 | Doc 9303 Part 3 §4.9: "a continuously repetitive weighting of 731 731 ..." |
| 2 | Check digits left out of MRZ_information | Part 11 §4.3.2: the concatenation is "including their respective check digits" |
| 3 | K_seed taken as all 20 bytes of the hash | Part 11 §4.3.2: "the most significant 16 bytes" |
| 4 | Derivation counter written little-endian | Part 11 §9.7.1: "A 32-bit, big-endian integer counter c" |
| 5 | Parity adjustment removed | Appendix D.1's printed keys change; no ciphertext does |
| 6 | MAC pads with zeros only (method 1) | Part 11 §4.3.3.2 specifies padding method 2 |
| 7 | CBC uses a non-zero IV | Part 11 §4.3.3.1: "CBC mode with zero IV" |
| 8 | Reader's plaintext ordered RND.IC ‖ RND.IFD ‖ K.IFD | Part 11 §4.3.1 step 2b: `S = RND.IFD || RND.IC || K.IFD` |
| 9 | Session seed by concatenation instead of XOR | Part 11 §4.3.1 step 5: "(K.IC xor K.IFD) as shared secret" |
| 10 | Send sequence counter from the FIRST four bytes | Appendix D.3 prints `887022120C06C226` — the low halves |
| 11 | Chip accepts on the checksum alone | Part 11 §4.3.1 step 3c also requires the nonce comparison |
| 12 | Search compares only the first 4 MAC bytes | Invariant 5: the comparison covers all 8 |
| 13 | The negative-claim sentence is deleted | §4.1d assertion 3: the limitation must be on screen in the fixture |
| 14 | A check inside the evidence fixture is broken | §4.1d assertion 2: every verdict in that state must report success |

## Three things the runner found

Recorded because they are the reason to run a script rather than keep a list,
and because each was a defect in the tests rather than in the lab.

**Mutation 5 survived its own test block.** Every test under "the parity
adjustment" called `adjustParity()` directly, so all of them passed with the
call *removed from the derivation*. The function was tested and its use was
not. It was caught only by the Appendix D comparison in the next block — the
right answer from the wrong place. `kdf.test.ts` now reaches through
`deriveKey` and asserts the key it returns has odd parity and differs from the
raw hash bytes beside it.

**Mutation 9 reported DOES NOT BUILD, twice.** Removing the only call to `xor`
leaves an unused import and `noUnusedLocals` rejects the file, so the mutation
was never actually tested. A mutation is now a list of patches, and this one
adjusts the import alongside the call. The same thing happened to mutation 14
with `const datesMatch = false`, which orphans `truth`; it compares the two
dates against each other's truth instead — a more plausible slip in any case.

**The baseline went red and the run stopped.** Several search tests run a full
exhaustive pass of 133,225 candidates, about 1.9 seconds measured, and
mutation 12's runs two. Vitest 5 enforces timeouts by elapsed time, so under
load the 5-second default reported a timeout rather than a cryptographic
result. The budget moved to a measured 30 seconds; the work did not shrink.
That the runner refused to score anything against a red baseline is the point
of rule 1.
