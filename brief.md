# Build brief — crypto-lab-passport-key

Written 15 November 2026. Paste this whole file to the coding agent, or save it as `brief.md`
in the new repo. It is self-contained apart from `_MASTER-TEMPLATE.md`, which must be in the
repo root (or readable at `audits/_MASTER-TEMPLATE.md` in the crypto-lab catalog repo).

One source paper is on the owner's machine at
`~/Downloads/crypto-lab-brief-sources/crypto-lab-passport-key/`. The governing document, ICAO
Doc 9303 Part 11, is published free by ICAO: download it once from ICAO's own site, keep it
outside the repo, and do not commit it. If you cannot obtain it, pause and ask the owner.

---

## KICKOFF (read this first)

Build a new Crypto Lab browser demo (Vite + TypeScript, static site, no backend) in the
repository **`crypto-lab-passport-key`**.

Read `_MASTER-TEMPLATE.md` in full and treat it as the BINDING spec for build, teaching,
look, accessibility, README and deploy. If `audits/kickoff.md` has been given to you, it
governs how you work inside this repo. This brief supplies only the demo-specific facts and
the acceptance checks. Where the template and this brief disagree on build/teach/look/a11y,
the template wins. Where this brief states cryptographic facts, check them against the cited
primary sources and by computation; if you find one wrong, do not silently deviate: write
"Brief said X; that is wrong because Y (source or computation)" in your report and build the
correct thing.

Build to every standard in the template, in its order: §1 Build, §3 Look, §2 Teach,
§4 Accessibility (including §4.1a setup rules, §4.1b claims suite, §4.1c mutation
discipline run from a script, §4.1d negative claim), §5 README, §6 Deploy with §6.1 and §6.2.

Hard rules (from the template; repeated because they are the ones that get broken):
real computation only, never a canned or simulated verdict; honest scoping in the page and
the README; do NOT weaken a gate to get a green run; if something cannot pass honestly,
leave it failing and say so. Do not touch the shared catalog files. Copy the top bar from an
existing lab. Copy the accessibility gate and `claims.spec.ts` shape from
`crypto-lab-schnorr-forge` and rewrite every lab-specific passage.

When done, report: one-line summary with the test count; the mutation ledger (each mutation,
killed or not); the edition, section and appendix numbers of ICAO Doc 9303 Part 11 you
actually used; your measured search rate (guesses per second) in the browser; confirmation
that grouping / auto-merge / PR gate / workflow_dispatch are all present; and the card
metadata listed at the end of this brief.

---

## NEW DEMO BRIEF

- Repo name:         crypto-lab-passport-key
- Short name (H1):   Passport Key
- Subtitle:          E-passport Basic Access Control · keys from printed data · offline search
- One-liner:         Browser-based e-passport Basic Access Control — the chip's keys derived from the printed machine-readable zone exactly as ICAO Doc 9303 specifies, the standard's worked example reproduced value for value, the entropy of those keys counted under stated assumptions, and one recorded session opened by an offline search over birth and expiry dates
- Concept to teach:  A key derived from data printed on the document is only as strong as that data is hard to guess. The protocol around it can be executed perfectly and still leave every recorded session open to an offline search, which is why the scheme was replaced by a password-authenticated key exchange.
- Primitives/spec:   ICAO Doc 9303, Part 11 (Security Mechanisms for MRTDs): Basic Access Control, its key derivation and its worked example. SHA-1 (FIPS 180-4), DES and two-key Triple-DES (NIST SP 800-67), CBC mode, the retail MAC (ISO/IEC 9797-1 MAC algorithm 3, padding method 2). Analysis: A. Juels, D. Molnar, D. Wagner, "Security and Privacy Issues in E-passports" (IACR ePrint 2005/095).
- Accent (--accent): #d1a05a   (not used by any of the 203 labs whose accent is recorded in the 12 November 2026 snapshot; confirm against the live catalog and against neighbouring cards)
- Favicon emoji:     🛂
- In scope:          see SCOPE below
- Non-goals:         see SCOPE below

GitHub "About" line: use the one-liner above.

---

## PRE-FLIGHT (verify, do not assume)

1. Confirm the repository name is free under `systemslibrarian` and no catalog card is titled
   "Passport Key".
2. In the catalog repo, search `CATALOG.md` and the lab READMEs for `passport`, `ICAO`,
   `9303`, `machine-readable`, `Basic Access Control`, `MRTD`, `retail MAC`. What the brief
   author found (12 November 2026 snapshot): no lab covers e-passports; one lab implements
   DES inside a Feistel study, and password-authenticated key exchange has its own labs. If
   a lab already runs Basic Access Control, STOP and report. Link the DES/Feistel lab, the
   PAKE labs and the password-hashing labs you actually find under Related Demos.
3. Playwright port: ask the catalog tool (`node tools/port-sync.js` in the catalog repo). If you
   cannot reach the catalog repo, stop and ask the owner for a port. Never 4173.

---

## SOURCES AND WHAT EACH IS FOR

- **ICAO Doc 9303 Part 11.** The brief author did NOT read the PDF directly: a helper read
  it through an automated summary and then recomputed its entire worked example, and the
  brief author recomputed the same example again with a separate program. All values in
  check B matched both times, so the procedure in FACTS is confirmed by computation. What
  is NOT confirmed is the document's edition and its section and appendix numbers (reported
  as 7th edition; sections 4.3.2 and 9.7; Appendix A for entropy, Appendix D for the worked
  example). Open the current edition, find them yourself, and cite what you see.
- **ePrint 2005/095** (in the sources folder). Read by a helper: the protocol description
  and the entropy discussion. Note one difference from the standard: the paper's figure
  shows 64-bit key material from each side; the standard's worked example uses 16 bytes
  (FACTS 5). Follow the standard.
- PACE, the replacement, is specified in the same ICAO part. Not read; see SCOPE.

---

## FACTS (write tests from these, not from your code)

1. **Check digit.** Weights 7, 3, 1 repeating from the left; digits count as themselves,
   letters A to Z as 10 to 35, the filler `<` as 0; the check digit is the weighted sum
   modulo 10.
2. **Key seed.** MRZ_information = document number (9 characters, padded with `<`) ‖ its
   check digit ‖ date of birth (YYMMDD) ‖ its check digit ‖ date of expiry (YYMMDD) ‖ its
   check digit, as ASCII. K_seed = the first 16 bytes of SHA-1(MRZ_information).
3. **Key derivation.** For counter c (1 for encryption, 2 for MAC): take the first 16 bytes
   of SHA-1(K_seed ‖ c as a 4-byte big-endian integer), then set the low bit of every byte
   to give odd parity. The result is a two-key Triple-DES key (8 + 8 bytes).
4. **Cipher and MAC.** Two-key Triple-DES in CBC mode with an all-zero IV and no padding.
   MAC: ISO/IEC 9797-1 algorithm 3 ("retail MAC") with padding method 2 (append 0x80, then
   zeros to a block boundary): single-DES CBC under the first key half over the padded
   message, then on the last block decrypt with the second half and encrypt with the first.
5. **Authentication.** The chip sends an 8-byte nonce RND.IC. The reader picks an 8-byte
   RND.IFD and 16 bytes of key material K.IFD, sends E_IFD = Enc(K_Enc, RND.IFD ‖ RND.IC ‖
   K.IFD) (32 bytes) and M_IFD = MAC(K_MAC, E_IFD) (8 bytes). The chip checks the MAC,
   decrypts, checks its own nonce, picks 16 bytes K.IC, and returns E_IC = Enc(K_Enc,
   RND.IC ‖ RND.IFD ‖ K.IC) with its MAC.
6. **Session keys.** Seed = K.IFD ⊕ K.IC; KS_Enc and KS_MAC come from that seed by the same
   derivation (counters 1 and 2). The send-sequence counter is the last four bytes of RND.IC
   followed by the last four bytes of RND.IFD.
7. **Entropy** (counting possibilities, uniform choice assumed; check digits add nothing).
   The standard's own estimate is about 56 bits for numeric document numbers and about 73
   for alphanumeric ones, and it cautions that real numbers are not uniformly random; the
   2005 paper estimates about 52 bits for the US numbering of that time, and less once
   anything is known. See check D for the counts.
8. **Offline search.** Whoever records E_IFD and M_IFD from one session can test a guess of
   the printed data without the passport: derive K_MAC from the guess and compare the MAC.
   A helper's single-threaded Python search over 2^22.35 candidates took 135 s at about
   25,000 guesses per second, each guess costing two SHA-1 calls and one retail MAC.

---

## SCOPE

In scope, as exhibits in this order:

1. **The printed data.** A specimen machine-readable zone (use ICAO's specimen values from
   check B; never ask for a real passport's data); check digits computed step by step.
2. **From print to keys.** MRZ_information, SHA-1, K_seed, the two derivations, parity bits
   shown.
3. **The handshake.** The standard's worked example value for value, then a live run with
   fresh nonces from the browser; tamper with one ciphertext byte and watch the MAC fail.
4. **How many guesses is that?** A counter with the assumptions as controls (numeric or
   alphanumeric number; number known or not; birth-date window; expiry window), showing the
   count and its base-2 logarithm.
5. **One recording, searched offline.** Record a live handshake; the search worker gets only
   E_IFD and M_IFD plus whatever the learner declares "known"; it finds the dates, derives
   the keys and decrypts the recording. Show guesses tried, rate, and the projected time for
   the larger spaces of exhibit 4 (labelled as projections).
6. **What replaced it, in one panel.** State that ICAO introduced a password-authenticated
   key exchange (PACE) for this purpose and link the site's PAKE labs. Named, not built.

Non-goals (say so on the page and in the README): PACE; secure messaging after
authentication (protected commands); Active and Chip Authentication, Passive Authentication
and the document-signing PKI; contactless radio, eavesdropping range or reader hardware; any
country's actual numbering scheme (the 2005 US description may be quoted as that paper's
account, dated); any real person's document data.

---

## SECURITY / CORRECTNESS INVARIANTS

1. DES and Triple-DES are real implementations checked against published vectors (check A);
   SHA-1 comes from WebCrypto. No reduced-round or toy cipher.
2. The page never asks for, stores or transmits real document data. Inputs are restricted to
   the specimen and to randomly generated fictional values; say so beside the input.
3. The search worker receives only the recorded bytes and the declared-known fields (enforce
   by message type; a test sends a recording with no secrets attached). "Found" is decided
   by comparing the recovered dates with the true ones afterwards, and by decrypting.
4. Nonces and key material come from `crypto.getRandomValues`.
5. A handshake is "accepted" only if the MAC verifies AND the decrypted nonce equals the one
   sent. MAC comparison covers all 8 bytes.
6. Projected times are computed from the measured rate and labelled as projections.

---

## ARCHITECTURE

Pure modules, no DOM: `mrz.ts` (check digits, MRZ_information), `des.ts` (DES, two-key
Triple-DES, CBC), `retailmac.ts`, `kdf.ts`, `bac.ts` (both sides of the handshake, session
keys), `entropy.ts`, `search.ts` (cancellable Web Worker). If you reuse the DES code of the
portfolio's Feistel lab, copy it in, cite the lab, and still run check A here.

---

## UI AND VISUAL SEMANTICS

Follow §3. The machine-readable zone in a monospaced block with each field labelled in text.
Reader, chip and eavesdropper are three labelled columns; the eavesdropper's column shows
only what crosses the air. Hex in tabular figures with byte grouping. Verdicts are words.

---

## EDGE CASES (each fails closed and teaches via its message)

- A document number shorter than 9 characters: padded with `<`; longer: refused.
- A wrong check digit typed by the learner: refused with the correct one shown.
- Invalid dates (month 13, day 32): refused.
- Tampered E_IFD or M_IFD: chip rejects; no session keys shown.
- Chip's reply with the wrong RND.IFD: reader rejects.
- Search space that does not contain the true dates: "not found in the declared space".
- Search cancelled: partial count shown, no result claimed.

---

## EXTENSION SEAMS (shape now, do not build)

An `AccessProtocol` interface so PACE could be added beside Basic Access Control; a
`NumberingScheme` interface for document-number formats. Name both as "not built here".

---

## ACCEPTANCE CHECKS — expected outcomes, derived independently of any implementation

**A. Primitives.** DES: key `133457799BBCDFF1`, block `0123456789ABCDEF` gives
`85E813540F0AB405`, and back. Take at least one two-key Triple-DES CBC vector spanning more
than one block from a NIST document. SHA-1 of "abc" from FIPS 180-4. Retail MAC: check B
supplies two 32-byte messages with their MACs.

**B. The standard's worked example** (recomputed twice, independently, on 15 November 2026;
confirm each value against the ICAO document as well). Document number `L898902C<`, birth
`690806`, expiry `940623`:
- check digits 3, 1, 6; MRZ_information `L898902C<369080619406236`;
- SHA-1 = `239AB9CB282DAF66231DC5A4DF6BFBAEDF477565`; K_seed = `239AB9CB282DAF66231DC5A4DF6BFBAE`;
- before parity adjustment: `AB94FCEDF2664EDFB9B291F85D7F77F2` and `7862D9ECE03C1BCD4D77089DCF131442`;
- K_Enc = `AB94FDECF2674FDFB9B391F85D7F76F2`; K_MAC = `7962D9ECE03D1ACD4C76089DCE131543`;
- RND.IC `4608F91988702212`, RND.IFD `781723860C06C226`, K.IFD `0B795240CB7049B01C19B33E32804F0B`:
  E_IFD = `72C29C2371CC9BDB65B779B8E8D37B29ECC154AA56A8799FAE2F498F76ED92F2`, M_IFD = `5F1448EEA8AD90A7`;
- K.IC `0B4F80323EB3191CB04970CB4052790B`:
  E_IC = `46B9342A41396CD7386BF5803104D7CEDC122B9132139BAF2EEDC94EE178534F`, M_IC = `2F2D235D074D7449`;
- session seed `0036D272F5C350ACAC50C3F572D23600`; KS_Enc = `979EC13B1CBFE9DCD01AB0FED307EAE5`;
  KS_MAC = `F1CB1F1FB5ADF208806B89DC579DC1F8`; send-sequence counter `887022120C06C226`.

**C. A second vector** (the brief author's, computed with Python's `hashlib` and the
`cryptography` library; exercises letters in the number and a different check-digit path).
Document number `AB1234567`, birth `851231`, expiry `300101`: check digits 1, 6, 9;
MRZ_information `AB1234567185123163001019`; K_seed `1CC3AEF7FAACAEDD742F670AA09F43DA`;
K_Enc `75C87061E9C1C4312FAD7ADF8C134649`; K_MAC `DCBAE6AB8F2FF26832C4ADA885A87FC2`.
With RND.IC = bytes `10 … 17`, RND.IFD = bytes `20 … 27`, K.IFD = bytes `30 … 3F`:
E_IFD = `0EFA587DA8F9062FAEE36FBABA759202545D376392E13A674FB0F4A592BDB7CE`,
M_IFD = `FB5A53DE424E7502`.

**D. Counting.** The exhibit must reproduce these counts exactly and their logarithms to two
decimals:

| Assumption | Count | Bits |
|---|---|---|
| 9-digit number, 100 years of birth dates, 10 years of expiry dates (365² × 10^12) | 133,225,000,000,000,000 | 56.89 |
| 9 alphanumeric characters, same dates (365² × 36^9 × 10^3) | 13,530,325,227,149,721,600,000 | 73.52 |
| number known; birth date in 100 calendar years, expiry in 10 (36,525 × 3,653) | 133,425,825 | 26.99 |
| number and expiry year known; birth 1960 to 1999 (14,610 × 365) | 5,332,650 | 22.35 |
| number, birth year (a leap year) and expiry year known (366 × 365) | 133,590 | 17.03 |

Use BigInt for the first two. The first two rows are the standard's formulas as a helper
read them; confirm the printed formulas.

**E. Search.** For a random birth date in a declared 366 × 365 space, the worker finds the
true dates from E_IFD and M_IFD alone in every one of 20 trials, the recovered K_Enc
decrypts E_IFD to the true nonces and K.IFD, and no earlier guess matched the MAC. With the
true date outside the declared space: "not found".

**F. Mutations that must be killed (§4.1c, run from a script, each a concrete patch).**
(1) check-digit weights 1, 3, 7; (2) check digits left out of MRZ_information; (3) K_seed
taken as all 20 bytes of the hash; (4) derivation counter little-endian; (5) parity
adjustment removed (the displayed keys of check B change even though ciphertexts do not:
the test must compare the key bytes); (6) MAC with zero padding only (check B's M_IFD
becomes `AAE3F35132ED3465`); (7) CBC with a non-zero IV; (8) plaintext order
RND.IC ‖ RND.IFD ‖ K.IFD in the reader's message; (9) session seed formed by concatenation
instead of XOR; (10) send-sequence counter from the first four bytes of each nonce;
(11) chip accepts when the MAC verifies without comparing the returned nonce; (12) search
compares only the first 4 MAC bytes. A surviving mutation is reported, not explained away.

**G. Fail-closed paths, each a NAMED test:** every item under EDGE CASES; invariants 3
and 5.

**H. Claims suite (§4.1b).** At minimum: every key and ciphertext on screen in exhibit 3 is
recomputed by the test from the specimen data with the test's own SHA-1 call and the
repository's DES checked in A; the count and bits shown in exhibit 4 equal the test's own
arithmetic for the controls on screen; the dates the search reports equal the hidden true
dates; the eavesdropper column contains no key or nonce in clear; stale verdicts are
retired when any input changes; the no-op guard; the `[hidden]` probe.

---

## NEGATIVE CLAIM (§4.1d)

Claim, scoped to the session on the page: **"The handshake succeeded and the session is
encrypted. That says nothing about someone who only listened: this one recording yields the
keys to anyone who can guess the printed data, and here that took the number of guesses
shown."**

Evidence fixture: exhibit 5 after a successful search. Reader and chip both report success,
every MAC verified, and the verdict reads
`MUTUAL AUTHENTICATION SUCCEEDED — AND THE RECORDING WAS OPENED OFFLINE`, with the
negative-claim sentence, the declared-known fields and the guess count visible in that state.

Bite fixture for mutation (12) and for the verdict logic: a search space that excludes the
true dates. The handshake still succeeds; the page must NOT show the "opened offline" clause.
The three assertions and two bite tests are as §4.1d specifies.

---

## README NOTES

Follow §5. "What It Is" names Basic Access Control, the primitives, the worked example, the
entropy count, the search, and "not production software — a teaching demo; no real document
data". "When to Use It" must include a "do NOT": do not use this page with a real passport's
data, and do not read its guess counts as the strength of any particular country's
documents. "What Can Go Wrong" is the concept line, plus the standard's own caution that
document numbers are not uniformly random. "Real-World Usage": cite ICAO for what the
standard specifies and for PACE; say which mechanism current documents use only from a
primary source, with its date. "Build & Verify" states the test count, the DES and SHA-1
vectors, the ICAO worked example (with the edition you used), the second vector, and the
a11y gate. Credit the ICAO document and the 2005 paper by title; link ICAO's own page and
the ePrint page; no links to PDF copies elsewhere.

---

## CARD METADATA TO REPORT BACK (for the catalog session; do not edit the catalog yourself)

Title: Passport Key. Subtitle as above. Suggested categories: PROTOCOLS, ATTACKS (confirm
both exist in the catalog's CATEGORIES). Suggested level: intermediate. Chips: only what the
source implements (SHA-1, DES, two-key Triple-DES CBC, retail MAC, Basic Access Control key
derivation and handshake, offline dictionary search). Accent #d1a05a.

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
