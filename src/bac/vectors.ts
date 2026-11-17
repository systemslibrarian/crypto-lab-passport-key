/**
 * Published test data, with its provenance.
 *
 * Every value in this file was copied from a primary source and then
 * reproduced by computation before it was written down. The sources, and what
 * each is the authority for:
 *
 *  - **ICAO Doc 9303, Part 11, Eighth Edition (2021)**, "Security Mechanisms
 *    for MRTDs". Appendix D is the worked example for Basic Access Control;
 *    Section 9.7 is the key derivation mechanism; Section 4.3.3 is the
 *    cryptographic specification. The consolidated edition carries Amendment 1
 *    (14/6/24) and Amendment 2 (23/2/26) — Section 9.7 sits inside Amendment 2.
 *    Published free by ICAO; not redistributed here.
 *  - **ICAO Doc 9303, Part 3, Eighth Edition (2021)**, Section 4.9, for the
 *    check-digit algorithm. Part 11 defers to Parts 4 to 6 for the MRZ and
 *    they in turn to Part 3, so the weighting is NOT a Part 11 rule.
 *  - **NIST CAVP**, `tdesmmt.zip`, file `TCBCMMT2.rsp` — the TDES Multiblock
 *    Message Test for CBC, two-key file. These are NIST-published validation
 *    vectors, which is where two-key 3DES CBC test data actually lives: NIST
 *    SP 800-38A's Appendix F examples are AES only, and FIPS 46-3 (the
 *    document ICAO cites for the cipher) publishes no CBC vectors at all.
 *  - **FIPS PUB 180-4** for SHA-1's known answers.
 *
 * ATTRIBUTION IS ASSERTED, NOT ANNOTATED. `vectors.test.ts` checks that each
 * group's `source` string still names the document the numbers came from, so a
 * citation cannot drift away from its data by a later edit. A document that
 * publishes no test data is never credited with any.
 */

/* ── SHA-1, FIPS 180-4 ────────────────────────────────────────────────────── */

export const SHA1_SOURCE = 'FIPS PUB 180-4, Secure Hash Standard';

/**
 * The two short-message known answers from FIPS 180-4's own examples, plus the
 * one-million-character case from the same document.
 */
export const SHA1_KAT: readonly { readonly message: string; readonly digest: string }[] = [
  { message: 'abc', digest: 'A9993E364706816ABA3E25717850C26C9CD0D89D' },
  {
    message: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    digest: '84983E441C3BD26EBAAE4AA1F95129E5E54670F1',
  },
];

/**
 * SHA-1 of one million repetitions of 'a' (FIPS 180-4's third example).
 *
 * Kept because it is the only published case that drives the compression
 * function over many blocks and forces the 64-bit length field past one byte —
 * the padding path this lab's own 24-to-28-byte inputs never reach.
 */
export const SHA1_MILLION_A_DIGEST = '34AA973CD4C4DAA4F61EEB2BDBAD27316534016F' as const;

/* ── Two-key 3DES in CBC mode, NIST CAVP ──────────────────────────────────── */

export const TDES_CBC_SOURCE =
  'NIST CAVP, TDES Multiblock Message Test for CBC, two-key file TCBCMMT2.rsp';

export interface TdesCbcVector {
  readonly count: number;
  readonly key1: string;
  readonly key2: string;
  readonly iv: string;
  readonly plaintext: string;
  readonly ciphertext: string;
}

/**
 * All ten vectors from the file, one to ten blocks. KEY3 equals KEY1 in each,
 * which is what makes them two-key cases; the IV is non-zero throughout.
 */
export const TDES_CBC_TWO_KEY_CAVP: readonly TdesCbcVector[] = [
  {
    count: 0,
    key1: 'BCFE7F25F2B0A72C',
    key2: '6276AE1F389D8AE9',
    iv: 'F29D4BA5172FD297',
    plaintext: '0611A474FB090978',
    ciphertext: '1B3889C9DBE10D03',
  },
  {
    count: 1,
    key1: '498ADF3B0E0E0DCE',
    key2: '8C917CFD19A83802',
    iv: '96567FF62C6BFA95',
    plaintext: '9496469854AE6A74D37E3C2BAC780B75',
    ciphertext: 'E3B7F198520383B7B4E7FE146D830C85',
  },
  {
    count: 2,
    key1: '766452495BBF797C',
    key2: '0E57D6389B523D3B',
    iv: '03497624ECCC76C7',
    plaintext: 'CB90FCA413C884390077084CD866B6C8150F4F5D44C6D622',
    ciphertext: 'A835AFD4DAD376D611BE4FC1282D1E3E36B3BE081B7C3A4E',
  },
  {
    count: 3,
    key1: '160B70AD26E60E8A',
    key2: '1ADADCC240619EC2',
    iv: '200E89B4097EF967',
    plaintext: '5AC6533B1DE8EDD31224A91F7361DC2B4AB33A5DB7ACEE1CC8BFDF82BB1777C6',
    ciphertext: '50E5C5BCC3D84C47FED29CE4CACCD5FC7724F56615F8ADE5E7D26DF2148BC2BC',
  },
  {
    count: 4,
    key1: '291937806E2F7C52',
    key2: 'B90E3737049E7301',
    iv: 'E3188BEDC5AF4D4D',
    plaintext:
      '46FB64785371EE25CEE35171A6DC8FE95CDD0B73D27ADDA91D0A8A0C99209328' +
      '15A947E193467540',
    ciphertext:
      '06C3CEDD527B120634F96DBB020DF802B39F90923AAACFF013893AD81B72BCDE' +
      'A4405455C9750A70',
  },
  {
    count: 5,
    key1: 'FB1FEC80B3834FE9',
    key2: 'C1E3FE1AA2E54697',
    iv: 'F1A61E614197E86A',
    plaintext:
      'F8CB81924233608C598820198CCE452596C330910547A4E36804D693CB59F074' +
      'B935F1947FD0BEFA86854AEC28FCA9B5',
    ciphertext:
      '86E620D24A240296003F3C8D712902E5A51CBD3A5639165CA47051530B9FDDA0' +
      '91FE29C644BAB909E3E07876DC7D5023',
  },
  {
    count: 6,
    key1: '8A2A3B2546B3ADF7',
    key2: '07B552AB7F25BC7A',
    iv: '0EB578794B472A69',
    plaintext:
      '6251DDD274641E852D93A9F6ED3329FF8EB9720AFC1E6727BCF7036CD4D912D2' +
      'ABF00F8B6E0175E2FC62888FA9AE9BDED2426FC3DB32BF38',
    ciphertext:
      'B9417A8E85B9C6D66FFB42DA3C4781F2B6D3321EACBE489B3B4559B44C3944DB' +
      '5EB017F886FC3001B3D9A2CB37EADA20836782113210A58D',
  },
  {
    count: 7,
    key1: '13385E1A86D0013D',
    key2: '323DEC687C108F5D',
    iv: '37AF5EBE47DEF2DD',
    plaintext:
      '9260811CD1051BD853027C67706BE318A5D109AFA7B44A3ACD83738649C14D1D' +
      'ACEF326CCDFBD9921BBD43F81EAE0A605D4A257521EAE94C369E00004357D6DE',
    ciphertext:
      '0654B84F30CBB2846BCCD9D56463D6DB9E12F3465B2322CEBF3D416D33369CCB' +
      '0828B4FA5CC73F6342F16F001D8777CC4D7C4C780E2BA8609CEE55BD9CECA81C',
  },
  {
    count: 8,
    key1: '6BF857DA5DDFA715',
    key2: '070779B57F1615BF',
    iv: '7698969B002A8CF3',
    plaintext:
      '6AEDAE008384F76928347D32A28143B285AE712C4ECCEA617FB84AABB4332820' +
      '4AC41813A365B464FD8FCE810FCDEFF9A535456543C4D84B2DD78E24368A87E4' +
      'C46260B5B9F77031',
    ciphertext:
      '8D4DC65E0182B339C864A7CB051984803F9CA84F64B3114B0E21C475041D6FD5' +
      '04044DC9C04B4A9C26B7685AE4D061E32C938E3FB467073102520C0FE66DA3D0' +
      '4895836723643150',
  },
  {
    count: 9,
    key1: '293D0486A2E01C76',
    key2: '91AD1AECD5F8234F',
    iv: 'ACF2B26A48CC552C',
    plaintext:
      '1DAA451D2054A48C6C03337F736A63C724784B64034B669C380799B8319457D9' +
      'FDAE6747EFD15B47A5931A15980D97C309658D74D8288874554940E801986620' +
      'CFC9EF13E06EF26D938B52965C9E6A72',
    ciphertext:
      'BD80F44B6047D3577E645393D9636088E7B53EBC25AD7AD6AECF20020C4A2E97' +
      '4EC349F85A54AFB885D56D01615AD236D6FC23D775DD90A5086667076ED388AD' +
      'A6F2197329277A887DB47BCF0737CD85',
  },
];

/* ── ICAO Doc 9303 Part 11, Appendix D — the worked example ───────────────── */

export const ICAO_SOURCE =
  'ICAO Doc 9303 Part 11, Eighth Edition (2021), Appendix D and Section 9.7';

/**
 * Appendix D's Basic Access Control example, value for value.
 *
 * The specimen is ICAO's own: the fictional Utopian document of ANNA MARIA
 * ERIKSSON, which appears in Appendix D.2 in both its TD1 and TD2 forms. No
 * real document's data appears anywhere in this lab.
 *
 * Every field below was read out of the published PDF and then recomputed
 * twice: once by an independent program written for the purpose, and again by
 * this repository's own modules in `bac.test.ts`. Appendix D is informative
 * rather than normative, which is exactly why reproducing it matters — it is
 * the standard's own statement of what its normative sections mean.
 */
export const ICAO_APPENDIX_D = {
  documentNumber: 'L898902C<',
  dateOfBirth: '690806',
  dateOfExpiry: '940623',
  checkDigits: { documentNumber: 3, dateOfBirth: 1, dateOfExpiry: 6 },
  mrzInformation: 'L898902C<369080619406236',
  /** The full SHA-1, before the most significant 16 bytes are taken. */
  mrzInformationSha1: '239AB9CB282DAF66231DC5A4DF6BFBAEDF477565',
  kSeed: '239AB9CB282DAF66231DC5A4DF6BFBAE',
  /**
   * Appendix D.1 prints the full hash at each counter, and then Ka'/Kb' as its
   * first sixteen bytes — the keys BEFORE the parity adjustment. Keeping both
   * is what lets a test see the adjustment happen rather than infer it.
   */
  kdfHashC1: 'AB94FCEDF2664EDFB9B291F85D7F77F27F2F4A9D',
  kdfHashC2: '7862D9ECE03C1BCD4D77089DCF131442814EA70A',
  kEncBeforeParity: 'AB94FCEDF2664EDFB9B291F85D7F77F2',
  kMacBeforeParity: '7862D9ECE03C1BCD4D77089DCF131442',
  kEnc: 'AB94FDECF2674FDFB9B391F85D7F76F2',
  kMac: '7962D9ECE03D1ACD4C76089DCE131543',
  rndIc: '4608F91988702212',
  rndIfd: '781723860C06C226',
  kIfd: '0B795240CB7049B01C19B33E32804F0B',
  /** S = RND.IFD ‖ RND.IC ‖ K.IFD (Appendix D.3, step 3). */
  s: '781723860C06C2264608F91988702212' + '0B795240CB7049B01C19B33E32804F0B',
  eIfd: '72C29C2371CC9BDB65B779B8E8D37B29' + 'ECC154AA56A8799FAE2F498F76ED92F2',
  mIfd: '5F1448EEA8AD90A7',
  kIc: '0B4F80323EB3191CB04970CB4052790B',
  /** R = RND.IC ‖ RND.IFD ‖ K.IC (Appendix D.3, chip step 6). */
  r: '4608F91988702212781723860C06C226' + '0B4F80323EB3191CB04970CB4052790B',
  eIc: '46B9342A41396CD7386BF5803104D7CE' + 'DC122B9132139BAF2EEDC94EE178534F',
  mIc: '2F2D235D074D7449',
  sessionSeed: '0036D272F5C350ACAC50C3F572D23600',
  ksEnc: '979EC13B1CBFE9DCD01AB0FED307EAE5',
  ksMac: 'F1CB1F1FB5ADF208806B89DC579DC1F8',
  sendSequenceCounter: '887022120C06C226',
} as const;

/**
 * The specimen holder's name, as Part 11 Appendix D.2 prints it alongside the
 * fields above. Fictional, and ICAO's own: Utopia is the standard's example
 * issuing state.
 */
export const ICAO_SPECIMEN_HOLDER = {
  surname: 'ERIKSSON',
  givenNames: 'ANNA MARIA',
  issuingState: 'UTO',
  nationality: 'UTO',
  sex: 'F',
} as const;

/**
 * A TD3 specimen printed in **Doc 9303 Part 4, Eighth Edition (2021)**, used
 * here to pin the lower-line layout and the composite check digit.
 *
 * Part 4 is the authority for the TD3 (passport) form factor, and this line's
 * composite digit — position 44 — verifies under the Part 3 Section 4.9
 * weighting over positions 1-10, 14-20 and 22-43, which is what makes it a
 * usable anchor for `td3LowerLine`.
 *
 * It is NOT the Basic Access Control example: its document number is
 * `L898902C3` and its dates differ from Appendix D's. The two are separate
 * specimens that happen to share a document-number stem, and conflating them
 * would derive keys for a document ICAO never worked through.
 *
 * A note on the sibling renderings: Part 11's Appendix D.2 also prints TD1 and
 * TD2 forms of the BAC specimen, and the trailing composite check digit of
 * each does NOT verify under the rule in Part 5 / Part 6 (TD2 prints 8 where
 * the rule gives 2; TD1 prints 1 where it gives 2). Appendix D is informative
 * and the composite digit plays no part in the key derivation, so nothing
 * cryptographic turns on it — but it is the reason this lab GENERATES its
 * printed line from the rule instead of copying a literal that would show a
 * learner a check digit that fails its own check.
 */
export const ICAO_TD3_SPECIMEN_PART4 = {
  lowerLine: 'L898902C36UTO7408122F3404159ZE184226B<<<<<16',
  documentNumber: 'L898902C3',
  dateOfBirth: '740812',
  dateOfExpiry: '340415',
  personalNumber: 'ZE184226B',
} as const;

/* ── A second vector, computed for this lab ───────────────────────────────── */

export const SECOND_VECTOR_SOURCE =
  'computed for this lab and reproduced independently; not published by ICAO';

/**
 * A second end-to-end case, exercising two paths Appendix D does not.
 *
 * Appendix D's document number ends in the filler `<`, and its check digits
 * happen to fall where they fall. This one puts LETTERS at the front of the
 * number — so the A-Z to 10-35 mapping in the check-digit weighting actually
 * matters — and lands on different check digits and a different parity
 * pattern.
 *
 * IT IS NOT ATTRIBUTED TO ICAO, because ICAO did not publish it. It was
 * derived with Python's `hashlib` and a from-scratch DES, and is reproduced
 * here by this repository's modules. Nonces are the low bytes 0x10..0x17,
 * 0x20..0x27 and 0x30..0x3F so the inputs are inspectable at a glance; a real
 * run uses `crypto.getRandomValues`.
 */
export const SECOND_VECTOR = {
  documentNumber: 'AB1234567',
  dateOfBirth: '851231',
  dateOfExpiry: '300101',
  checkDigits: { documentNumber: 1, dateOfBirth: 6, dateOfExpiry: 9 },
  mrzInformation: 'AB1234567185123163001019',
  kSeed: '1CC3AEF7FAACAEDD742F670AA09F43DA',
  kEnc: '75C87061E9C1C4312FAD7ADF8C134649',
  kMac: 'DCBAE6AB8F2FF26832C4ADA885A87FC2',
  rndIc: '1011121314151617',
  rndIfd: '2021222324252627',
  kIfd: '303132333435363738393A3B3C3D3E3F',
  eIfd: '0EFA587DA8F9062FAEE36FBABA759202' + '545D376392E13A674FB0F4A592BDB7CE',
  mIfd: 'FB5A53DE424E7502',
} as const;

/* ── The retail MAC, padding method 2 versus zero padding ─────────────────── */

/**
 * What Appendix D's M_IFD becomes if the MAC pads with zeros only.
 *
 * ISO/IEC 9797-1 padding method 2 appends `0x80` and then zeros to a block
 * boundary; method 1 appends zeros alone. Over a message that is ALREADY a
 * whole number of blocks — which E_IFD, at 32 bytes, is — method 1 adds
 * nothing at all while method 2 adds a whole extra block. So the two disagree
 * on exactly the input this protocol uses, and this is the value the wrong one
 * produces. It exists so that a test can state the difference as a number
 * rather than as a sentence about padding.
 */
export const RETAIL_MAC_ZERO_PADDED_M_IFD = 'AAE3F35132ED3465' as const;
