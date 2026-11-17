# Passport Key

**E-passport Basic Access Control — the chip's keys derived from the printed machine-readable zone, exactly as ICAO Doc 9303 specifies, and one recorded session opened by an offline search.**

[Live demo](https://systemslibrarian.github.io/crypto-lab-passport-key/)

---

## What It Is

A browser demo of **Basic Access Control**, the access-control mechanism specified in
**ICAO Doc 9303, Part 11, Eighth Edition (2021)** — "Security Mechanisms for MRTDs" — for
electronic machine readable travel documents. Everything runs in the page; there is no
backend and nothing is transmitted.

The primitives are real and hand-rolled where they are the teaching subject:

- **SHA-1** (FIPS PUB 180-4), for the key derivation of Part 11 Section 9.7.1.
- **DES** and **two-key Triple-DES in CBC mode** with an all-zero IV and no padding
  (Part 11 Section 4.3.3.1, which cites FIPS PUB 46-3).
- The **retail MAC** — ISO/IEC 9797-1:2011 MAC algorithm 3 with block cipher DES, zero IV
  and **padding method 2** (Part 11 Section 4.3.3.2).
- The **three-pass mutual authentication** of Part 11 Section 4.3.1 (ISO/IEC 11770-2 Key
  Establishment Mechanism 6), and the session-key derivation of Sections 9.7.1 and 9.7.4.
- The **check-digit rule** of ICAO Doc 9303 **Part 3** Section 4.9 — modulus 10, weights
  731 repeating — which Part 11 defers to for the machine-readable zone.

The security model is the one the standard itself describes in its Appendix A. The protocol
is executed correctly: every checksum verifies, the nonces come from
`crypto.getRandomValues`, and both sides accept. The weakness is structural — the access
keys are derived from a document number and two dates, so **a recording of one handshake is
an offline test oracle for the printed data**. The lab demonstrates that by recording a
handshake and recovering the dates from the recorded bytes alone.

**Not production software — a teaching demo.** SHA-1 is collision-broken, single DES fell to
exhaustive search in 1998, two-key 3DES is limited by a meet-in-the-middle attack and NIST
disallowed TDEA for new applications after 2023. Nothing here is constant-time. **No real
document data is used, asked for, stored or transmitted:** the specimen is ICAO's own
fictional Utopian passport, and the only other input is a random fictional generator.

### What it does NOT prove

The page states its own limits, and the claims suite asserts that it does:

- **It says nothing about any country's documents.** The guess counts are counts of
  possibilities under a uniform-choice assumption that Appendix A explicitly says does not
  hold. They are not measurements of any real passport's strength.
- **It does not show how a recording would be obtained.** The contactless radio layer,
  eavesdropping range and reader hardware are out of scope; the lab starts from the
  assumption that someone has the bytes.
- **A successful handshake proves nothing about an eavesdropper.** That is the lab's
  negative claim, and exhibit 5 is its evidence.

## Exhibits

1. **The Printed Data** — the machine-readable zone as printed, with the characters the key
   derivation consumes marked, and each check digit computed one multiplication at a time.
2. **From Print to Keys** — MRZ_information, its SHA-1, the 16-byte key seed, and both
   document keys under counters 1 and 2. Each key is shown before and after the parity
   adjustment, which Section 9.7.1.1 marks OPTIONAL: it changes the printed key and cannot
   change a ciphertext, because DES's PC-1 discards every parity bit.
3. **The Handshake** — three labelled columns for the reader, the chip and an eavesdropper
   who sees only what crosses the air. Runs the standard's worked example value for value,
   then live with fresh nonces; flip a byte of either the cryptogram or the checksum and
   watch the chip refuse without deriving anything.
4. **How Many Guesses Is That?** — the assumptions as controls, with the count and its
   base-2 logarithm. Reproduces Appendix A's two formulas and three narrower counts exactly,
   in BigInt, because the largest is past where a double counts exactly.
5. **One Recording, Searched Offline** — the search worker receives E_IFD and M_IFD plus the
   fields the learner declares known, and nothing else. It recovers the birth and expiry
   dates, derives the keys, and decrypts the recording. Shows guesses tried, the measured
   rate, and projected times for the larger spaces of exhibit 4, labelled as projections.
   Measured in Chromium on the development machine: **38,714 guesses a second**,
   single-threaded in one worker — about one and a half times the single-threaded Python
   reference the analysis was sized against, and enough to open a 133,590-candidate space
   in two seconds.
6. **What Replaced It** — PACE, named and cited, not built. With the one sentence that
   matters: session keys "whose strength is independent of the entropy of the used password".

## When to Use It

Use it to teach why a key derived from printed, guessable data is weak however well the
protocol around it is executed — and to show the difference between an online guessing
attack, which a chip can rate-limit, and an offline one, which nothing can. It is a good
companion to any lesson on password-based key derivation, since it is the same problem
without a salt or a work factor.

**Do NOT use this page with a real passport's data.** It would teach you nothing the
specimen does not, and this page has no business holding it. There is no input that wants it
and no storage that would keep it.

**Do NOT read the guess counts as the strength of any particular country's documents.** They
are counts of possibilities under an assumption of uniform choice. Appendix A says in as
many words that real document numbers are not chosen that way, and the 2005 analysis quoted
in exhibit 4 describes one country's numbering scheme as it stood in 2005.

## Live Demo

<https://systemslibrarian.github.io/crypto-lab-passport-key/>

Change the printed data and watch both keys change completely. Run the standard's worked
example and check all eight values against the appendix. Tamper with a byte and see the chip
refuse with no session keys shown. Then record a handshake, declare what a searcher would
plausibly know, and watch the recording come open — or declare a birth year the holder was
not born in and watch the search honestly report that it found nothing.

## What Can Go Wrong

**The concept:** a key derived from data printed on the document is only as strong as that
data is hard to guess. The protocol around it can be executed perfectly and still leave
every recorded session open to an offline search.

Specifically:

- **The derivation has no salt and no work factor.** One SHA-1 call turns 24 printed
  characters into both keys. A candidate costs two SHA-1 compressions and seven DES block
  operations, which is why a browser tab manages tens of thousands of guesses a second. A
  salt would not have helped much either: it would have to be printed on the document too.
- **The standard's own caution.** Appendix A puts the maximum strength at "approximately 56
  Bit for a numeric Document Number" and 73 for an alphanumeric one, then adds that the
  second figure "requires the Document Number to be randomly and uniformly chosen which is
  usually not the case", and that the real entropy "may be lower, e.g. if the attacker knows
  all Document Numbers in use or is able to correlate Document Numbers and Dates of Expiry".
- **The number is not treated as a secret.** Juels, Molnar and Wagner noted in 2005 that
  "entities such as cruise ships, travel agents, airlines, and many others will see the
  number and may include it on paper documents". Declaring it known is what turns a 56-bit
  count into a 17-bit one.
- **The key never changes.** The same paper: "a single fixed key is used for the lifetime of
  the e-passport. As a consequence, it is impossible to revoke a reader's access." A
  recording does not expire.
- **A checksum-only check would accept a replay.** A chip must verify the MAC *and* confirm
  its own nonce came back. The repository tests that with a cryptogram whose MAC is
  perfectly valid and whose nonce is from another session — the only case that separates the
  two behaviours.
- **Padding method 2 is not a detail.** E_IFD is exactly four blocks, so zero padding adds
  nothing where method 2 adds a whole block. Over the standard's own message the two give
  `5F1448EEA8AD90A7` and `AAE3F35132ED3465`.

## Real-World Usage

ICAO Doc 9303 Part 11 specifies Basic Access Control in Section 4.3 and, in the same part,
PACE — Password Authenticated Connection Establishment — in Section 4.4. Appendix A says
why: Basic Access Control's "limitations are inherent to the design of the protocol based on
symmetric ('secret key') cryptography", and PACE "employs asymmetric cryptography to
establish session keys, whose strength is independent of the entropy of the used password".
Appendix A also records that Basic Access Control "is implemented in almost every eMRP".

Edition and amendments actually consulted for this lab: **Eighth Edition, 2021**, the
consolidated version carrying Amendment 1 (14 June 2024) and Amendment 2 (23 February 2026);
Section 9.7 falls inside Amendment 2. Sections used: 4.3.1 (the protocol), 4.3.2 (the
inspection process and MRZ_information), 4.3.3.1 and 4.3.3.2 (the cipher and the MAC), 9.7.1
/ 9.7.1.1 / 9.7.2 / 9.7.4 (key derivation), Appendix A (entropy) and Appendix D (the worked
example). The check-digit rule is Doc 9303 **Part 3**, Eighth Edition (2021), Section 4.9,
and the TD3 lower-line layout is Doc 9303 **Part 4**.

**Which mechanism a given country's current documents use is not claimed here.** That is a
factual question about deployments, it changes, and this lab makes no statement about it
from anything other than a primary source. The 2005 paper's remark that the United States
had elected not to include Basic Access Control is reproduced in-page only as that paper's
account at that date.

## How to Run Locally

```sh
npm install
npm run dev            # http://localhost:5173/crypto-lab-passport-key/
npm test               # the Vitest suite
npm run build          # typecheck + production build
npm run test:a11y      # the WCAG A/AA gate against the production build
npm run test:claims    # the claims suite
npm run test:e2e:all   # both, plus the functional flows
npm run mutate         # the mutation runner (see Build & Verify)
```

ICAO publishes Doc 9303 free of charge. It is **not** included in this repository and must
not be: download the parts you want from ICAO's own site. The tests carry only the values
reproduced below, as test data.

## Related Demos

- [PAKE Gate](https://systemslibrarian.github.io/crypto-lab-pake-gate/) — SRP-6a, J-PAKE,
  CPace and Dragonfly side by side. The contrast this lab draws: a passive transcript gives
  an observer no direct offline password test.
- [SPAKE Gate](https://systemslibrarian.github.io/crypto-lab-spake-gate/) — one PAKE in
  detail, including exactly what an eavesdropper can and cannot grind.
- [OPAQUE Gate](https://systemslibrarian.github.io/crypto-lab-opaque-gate/) — an augmented
  PAKE (RFC 9807) where even the server never holds the password.
- [Feistel Forge](https://systemslibrarian.github.io/crypto-lab-feistel-forge/) — DES round
  by round, with the meet-in-the-middle limit on two-key Triple-DES this lab's cipher
  inherits.
- [bcrypt Forge](https://systemslibrarian.github.io/crypto-lab-bcrypt-forge/) — the other
  half of the answer: when a key must come from something guessable, a salt and a
  deliberately large work factor are what make each guess expensive.

## Build & Verify

Vite + TypeScript, static, no backend. **159 Vitest tests** across eight files and **60
Playwright tests** (the WCAG gate at two viewports, a 44-test claims suite, and functional
flows at desktop and phone width).

Every published value was read from its primary source and then reproduced by computation
twice — once by a from-scratch program written for the purpose, and again by this
repository's modules — before it was written down.

**Known-answer tests, and where each vector comes from:**

| Vectors | Source | File |
|---|---|---|
| SHA-1 known answers, incl. the one-million-character case | FIPS PUB 180-4 | `src/bac/sha1.test.ts` |
| SHA-1 agrees with `crypto.subtle.digest` on 200 random inputs and at every padding boundary | differential | `src/bac/sha1.test.ts` |
| DES single-block vector, and parity-bit independence | FIPS PUB 46-3 | `src/bac/des.test.ts` |
| The fast path agrees with a literal bit-walk of the printed tables | differential | `src/bac/des.test.ts` |
| Ten two-key 3DES CBC multiblock vectors, 1–10 blocks, both directions | NIST CAVP `TCBCMMT2.rsp` | `src/bac/vectors.ts` |
| The complete Basic Access Control worked example, value for value | ICAO Doc 9303 Part 11 (8th ed., 2021) Appendix D | `src/bac/bac.test.ts` |
| A TD3 specimen whose composite check digit verifies | ICAO Doc 9303 Part 4 (8th ed., 2021) | `src/bac/mrz.test.ts` |
| A second end-to-end vector exercising letters in the document number | computed for this lab; **not** published by ICAO | `src/bac/vectors.ts` |
| Appendix A's two entropy formulas and three narrower counts, exact | ICAO Doc 9303 Part 11 Appendix A | `src/bac/entropy.test.ts` |

Note the attribution discipline: ICAO publishes no CBC test vectors and FIPS 46-3 publishes
none either, so the Triple-DES CBC vectors are credited to NIST's CAVP files, where they
actually come from. The second end-to-end vector is explicitly **not** attributed to ICAO.
`src/bac/vectors.ts` documents each source, and the tests assert that each group's `source`
string still names the right document — so a citation cannot drift away from its data.

**The accessibility gate** (`npm run test:a11y`) scans the production build with
`@axe-core/playwright` for zero WCAG 2.1 A/AA violations across every state the lab renders,
at 1280px and 380px. It asserts axe's `incomplete` bucket as well as `violations`, and adds
four oracles axe has no rule for: arithmetic composite-aware contrast, non-text contrast at
3:1 on every control boundary, reflow at 380px, and keyboard reachability of scrolling
regions. The palette was measured against every threshold before it was written; the
non-text baseline is empty.

**The claims suite** (`npm run test:claims`) checks the page tells the truth: every key and
cryptogram on screen recomputed from the printed data by an independent route, the displayed
bit counts recomputed from the displayed possibilities, the marked MRZ characters
cross-checked against the string the derivation consumes, every failure path naming its
actual cause, evidence retired when an input changes, the no-op guard, and the `[hidden]`
probe. It also carries the lab's **negative claim** and both of its bite fixtures.

**Mutation discipline** (`npm run mutate`) applies each of 14 recorded mutations as a
concrete patch and requires four things of a kill: the owning test passed unmutated in the
same run, the patch actually changed the file, the run served the mutated code (the built
bundle hash must move for a browser mutation), and a red run that looks like infrastructure
rather than an assertion is reported INCONCLUSIVE instead of counted. A patch that does not
compile is DOES NOT BUILD and is never a kill. **14 of 14 are killed**, including the two
that §4.1d requires of the negative claim itself. The runner found three defects in the
tests rather than the lab — see `MUTATIONS.md`.

**Playwright port:** 4247, with `--strictPort`. Chosen by checking three things rather than
two — the catalog registry, every sibling lab's config, and what was actually listening.
Port 4245 passed the first two and turned out to be serving another lab.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
