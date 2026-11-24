/**
 * Counting the possibilities — exhibit 4.
 *
 * ## What the standard says, and what it is careful not to say
 *
 * ICAO Doc 9303 Part 11, **Appendix A, "Entropy of MRZ-derived access keys
 * (informative)"**, gives the figures this exhibit reproduces:
 *
 *   "For a 10-year valid travel document the maximum strength of the keys is
 *   approximately:
 *     - 56 Bit for a numeric Document Number (365^2 * 10^12 possibilities)
 *     - 73 Bit for an alphanumeric Document Number (365^2*36^9*10^3
 *       possibilities)."
 *
 * and immediately qualifies them:
 *
 *   "Especially in the second case this estimation requires the Document
 *   Number to be randomly and uniformly chosen which is usually not the case.
 *   Depending on the knowledge of the attacker, the actual entropy of the
 *   Document Basic Access Key may be lower, e.g. if the attacker knows all
 *   Document Numbers in use or is able to correlate Document Numbers and Dates
 *   of Expiry."
 *
 * Those two formulas factor as 365 x 100 years of birth dates, times 365 x 10
 * years of expiry dates, times the document number — 10^9 numeric or 36^9
 * alphanumeric. The 10^3 in the second formula is the same 100 x 10 years of
 * dates that the first rolls into its 10^12.
 *
 * **These are counts of possibilities, not measurements of entropy.** A count
 * becomes an entropy only under a uniform distribution, which is precisely
 * what Appendix A warns does not hold. So this module counts, names its
 * assumptions, and takes the base-2 logarithm of a count — it does not claim
 * to have measured the strength of anybody's documents. Every label the UI
 * puts on these numbers says "possibilities" or "guesses", never "entropy of a
 * real passport".
 *
 * The 2005 Juels-Molnar-Wagner analysis is the other half of the picture and
 * is reported as that paper's own estimate, dated: it puts the birth date at
 * "about 14 bits" and the expiry at "roughly 11", and for US numbering of the
 * time — "United States passports issued since 1981 have 9-digit passport
 * numbers. The first two digits encode one of fifteen passport issuing
 * offices" — computes "at most lg(15 x 10^7) ~ 27 bits", for "a total of about
 * 52 bits of entropy".
 *
 * ## Why BigInt
 *
 * 365^2 * 36^9 * 10^3 is about 1.35 x 10^22, well past the 2^53 where a double
 * stops counting exactly. `Number` would print a count that is merely close,
 * and this exhibit's whole claim is that these are exact counts of a search
 * space. So the counts are BigInt and only the logarithm is a float.
 */

/** A dated figure quoted from a source, never recomputed as if it were ours. */
export interface QuotedEstimate {
  readonly bits: number;
  readonly source: string;
  readonly note: string;
}

/** Appendix A's own two figures, as Appendix A states them. */
export const ICAO_APPENDIX_A_ESTIMATES: readonly QuotedEstimate[] = [
  {
    bits: 56,
    source: 'ICAO Doc 9303 Part 11, Eighth Edition (2021), Appendix A',
    note: 'numeric document number, 10-year document: 365^2 x 10^12 possibilities',
  },
  {
    bits: 73,
    source: 'ICAO Doc 9303 Part 11, Eighth Edition (2021), Appendix A',
    note: 'alphanumeric document number: 365^2 x 36^9 x 10^3 possibilities',
  },
];

/**
 * The 2005 paper's estimate for the US numbering OF THAT TIME.
 *
 * Quoted, not computed, and dated in the text that renders it. The paper
 * describes a numbering scheme as it stood in 2005 and this lab makes no claim
 * about any country's present scheme — a non-goal stated on the page.
 */
export const JUELS_MOLNAR_WAGNER_2005: QuotedEstimate = {
  bits: 52,
  source: 'A. Juels, D. Molnar, D. Wagner, "Security and Privacy Issues in E-passports" (2005)',
  note: 'about 14 bits of birth date + roughly 11 of expiry + at most lg(15 x 10^7) ~ 27 for the US numbering described in that paper',
};

/* ── The controls ─────────────────────────────────────────────────────────── */

export type NumberStyle = 'numeric' | 'alphanumeric' | 'known';

/**
 * A span of dates, as a count of days with the reasoning kept.
 *
 * There are two ways to count a span of years, and this exhibit uses both
 * deliberately, because its sources do:
 *
 *  - **Nominal years.** Appendix A's formulas are written over `365^2`, i.e. a
 *    flat 365 days per year, leap days ignored. Reproducing its figures means
 *    reproducing that approximation rather than improving on it.
 *  - **Calendar years.** A span a searcher actually declares — "birth dates
 *    from 1960 to 1999" — contains its leap days, and ten of them across those
 *    forty years. Counting 365 x 40 would declare a space that does not
 *    contain every date in it, and a search over such a space would miss a
 *    birthday on 29 February.
 *
 * So a row says which it is using, and `derivation` says so on screen. The two
 * disagree by about one part in 1,460, which is invisible in a bit count and
 * decisive in a search.
 */
export interface DateSpan {
  readonly days: number;
  readonly derivation: string;
}

/** A span counted the way Appendix A counts one: 365 days to the year. */
export function nominalYears(years: number): DateSpan {
  return { days: 365 * years, derivation: `365 x ${years} years (Appendix A's flat 365-day year)` };
}

/**
 * A span of whole calendar years, leap days included.
 *
 * The Julian mean of 365.25 days is used, rounded up, which is exact for any
 * span divisible by four and correct to a day otherwise: 40 years gives
 * 14,610, 100 gives 36,525, 10 gives 3,653. Which particular years a span
 * covers shifts the leap count by at most one day, and the exhibit does not
 * pretend to know the window — it says "100 calendar years", not "1900-1999".
 */
export function calendarYears(years: number): DateSpan {
  return {
    days: Math.ceil(years * 365.25),
    derivation: `${Math.ceil(years * 365.25).toLocaleString('en')} days — ${years} calendar years, leap days included`,
  };
}

/** A single known year: 366 days if it is a leap year, else 365. */
export function oneYear(leap: boolean): DateSpan {
  return {
    days: leap ? 366 : 365,
    derivation: `${leap ? 366 : 365} — the days of one known${leap ? ' leap' : ''} year`,
  };
}

export interface Assumptions {
  /**
   * The document number: nine digits, nine alphanumeric characters, or known
   * to the searcher and so contributing a single possibility.
   */
  readonly numberStyle: NumberStyle;
  readonly birth: DateSpan;
  readonly expiry: DateSpan;
}

/** One factor of a count, kept so the UI can show the multiplication. */
export interface CountFactor {
  readonly label: string;
  readonly value: bigint;
  /** How the factor was arrived at, e.g. "365 x 100 years". */
  readonly derivation: string;
}

export interface SpaceCount {
  readonly factors: readonly CountFactor[];
  readonly count: bigint;
  /** log2 of the count, to two decimals. */
  readonly bits: number;
}

/** 36^9 and 10^9, as exact integers. */
const ALPHANUMERIC_NINE = 36n ** 9n;
const NUMERIC_NINE = 10n ** 9n;

/**
 * log2 of a BigInt, accurately, to two decimal places.
 *
 * `Math.log2(Number(count))` loses precision above 2^53 — and the two headline
 * counts are both above it. So the exponent is taken from the bit length and
 * only the mantissa goes through a float.
 */
export function log2BigInt(value: bigint): number {
  if (value <= 0n) throw new Error('a count of possibilities is positive');
  const bits = value.toString(2).length;
  if (bits <= 53) return Math.log2(Number(value));
  // Keep 53 significant bits; the rest only affects digits we do not print.
  const shift = BigInt(bits - 53);
  const mantissa = Number(value >> shift) / 2 ** 52;
  return bits - 53 + 52 + Math.log2(mantissa);
}

/** Round to two decimals the way the exhibit prints it. */
export function bitsOf(count: bigint): number {
  return Math.round(log2BigInt(count) * 100) / 100;
}

/**
 * Count the search space implied by a set of assumptions.
 *
 * Note what is NOT a factor: the check digits. Each is a function of the field
 * it checks, so it adds no possibilities at all — a point the exhibit makes
 * explicitly, because three of MRZ_information's 24 characters look like they
 * should contribute and do not.
 */
export function countSpace(assumptions: Assumptions): SpaceCount {
  const factors: CountFactor[] = [];

  switch (assumptions.numberStyle) {
    case 'numeric':
      factors.push({
        label: 'Document number',
        value: NUMERIC_NINE,
        derivation: '10^9 — nine digits',
      });
      break;
    case 'alphanumeric':
      factors.push({
        label: 'Document number',
        value: ALPHANUMERIC_NINE,
        derivation: '36^9 — nine characters, digits and A-Z',
      });
      break;
    case 'known':
      factors.push({
        label: 'Document number',
        value: 1n,
        derivation: 'known to the searcher — one possibility',
      });
      break;
  }

  factors.push({
    label: 'Date of birth',
    value: BigInt(assumptions.birth.days),
    derivation: assumptions.birth.derivation,
  });
  factors.push({
    label: 'Date of expiry',
    value: BigInt(assumptions.expiry.days),
    derivation: assumptions.expiry.derivation,
  });
  factors.push({
    label: 'Check digits',
    value: 1n,
    derivation: 'each is computed from the field it checks — no possibilities added',
  });

  let count = 1n;
  for (const factor of factors) count *= factor.value;
  return { factors, count, bits: bitsOf(count) };
}

/* ── The five rows the exhibit must reproduce ─────────────────────────────── */

/**
 * A named row, with the count and bits it must produce.
 *
 * The first two are Appendix A's own formulas — nominal 365-day years and all
 * — which is why their derivations read as they do: 365^2 x 10^12 is 365 x 100
 * birth-date years times 365 x 10 expiry years times 10^9 for the number. The
 * last three are narrower assumptions a searcher might actually be in a
 * position to make, counted over real calendar days, and the fifth is the
 * space exhibit 5's live search covers.
 */
export interface NamedSpace {
  readonly id: string;
  readonly label: string;
  readonly assumptions: Assumptions;
  /** Exact, so a test can state the expected count rather than recompute it. */
  readonly expectedCount: bigint;
  readonly expectedBits: number;
  /** Whether this row is Appendix A's own, or a narrower assumption. */
  readonly source: 'icao-appendix-a' | 'narrower';
}

export const NAMED_SPACES: readonly NamedSpace[] = [
  {
    id: 'numeric-wide',
    label: 'Nine-digit number, 100 years of birth dates, 10 years of expiry dates',
    assumptions: {
      numberStyle: 'numeric',
      birth: nominalYears(100),
      expiry: nominalYears(10),
    },
    expectedCount: 133_225_000_000_000_000n,
    expectedBits: 56.89,
    source: 'icao-appendix-a',
  },
  {
    id: 'alphanumeric-wide',
    label: 'Nine alphanumeric characters, same dates',
    assumptions: {
      numberStyle: 'alphanumeric',
      birth: nominalYears(100),
      expiry: nominalYears(10),
    },
    expectedCount: 13_530_325_227_149_721_600_000n,
    expectedBits: 73.52,
    source: 'icao-appendix-a',
  },
  {
    id: 'number-known',
    label: 'Number known; birth date in 100 calendar years, expiry in 10',
    assumptions: {
      numberStyle: 'known',
      birth: calendarYears(100),
      expiry: calendarYears(10),
    },
    expectedCount: 133_425_825n,
    expectedBits: 26.99,
    source: 'narrower',
  },
  {
    id: 'number-and-expiry-year-known',
    label: 'Number and expiry year known; birth 1960 to 1999',
    assumptions: {
      numberStyle: 'known',
      birth: calendarYears(40),
      expiry: oneYear(false),
    },
    expectedCount: 5_332_650n,
    expectedBits: 22.35,
    source: 'narrower',
  },
  {
    id: 'both-years-known',
    label: 'Number, birth year (a leap year) and expiry year known',
    assumptions: {
      numberStyle: 'known',
      birth: oneYear(true),
      expiry: oneYear(false),
    },
    expectedCount: 133_590n,
    expectedBits: 17.03,
    source: 'narrower',
  },
];

/* ── Projections ──────────────────────────────────────────────────────────── */

/**
 * How long a space would take at a measured rate.
 *
 * Invariant 6: projections are computed from the MEASURED rate and labelled as
 * projections. The rate argument is always a figure the browser just produced,
 * never a constant — which is why there is no default.
 */
export function projectSeconds(count: bigint, guessesPerSecond: number): number {
  if (!(guessesPerSecond > 0)) throw new Error('a projection needs a measured positive rate');
  // Through log space, because `count` can exceed Number.MAX_SAFE_INTEGER by
  // many orders of magnitude.
  return 2 ** (log2BigInt(count) - Math.log2(guessesPerSecond));
}

/** A projection in the largest unit that leaves a number worth reading. */
export function humanizeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'longer than this can express';
  const units: readonly [number, string][] = [
    [1, 'second'],
    [60, 'minute'],
    [3600, 'hour'],
    [86_400, 'day'],
    [31_557_600, 'year'],
  ];
  if (seconds < 1) return `${seconds.toPrecision(2)} seconds`;
  let chosen = units[0];
  for (const unit of units) if (seconds >= unit[0]) chosen = unit;
  const value = seconds / chosen[0];
  if (chosen[1] === 'year' && value >= 1e6) {
    return `${value.toExponential(2)} years`;
  }
  const rounded = value >= 100 ? Math.round(value).toLocaleString('en') : value.toPrecision(3);
  return `${rounded} ${chosen[1]}${value === 1 ? '' : 's'}`;
}
