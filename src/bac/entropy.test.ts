import { describe, expect, it } from 'vitest';
import {
  bitsOf,
  calendarYears,
  countSpace,
  humanizeSeconds,
  ICAO_APPENDIX_A_ESTIMATES,
  JUELS_MOLNAR_WAGNER_2005,
  log2BigInt,
  NAMED_SPACES,
  nominalYears,
  oneYear,
  projectSeconds,
} from './entropy';

describe('log2 of a BigInt', () => {
  it('is exact on powers of two, well past 2^53', () => {
    for (const exponent of [1, 10, 52, 53, 54, 64, 100, 128]) {
      expect(log2BigInt(2n ** BigInt(exponent)), `2^${exponent}`).toBeCloseTo(exponent, 9);
    }
  });

  it('agrees with Math.log2 wherever a double is still exact', () => {
    for (const value of [3n, 365n, 1000n, 133_225n, 2n ** 50n - 1n]) {
      expect(log2BigInt(value)).toBeCloseTo(Math.log2(Number(value)), 9);
    }
  });

  it('refuses a non-positive count', () => {
    expect(() => log2BigInt(0n)).toThrow(/positive/);
    expect(() => log2BigInt(-1n)).toThrow(/positive/);
  });

  it('does not lose precision the way Number would', () => {
    // 36^9 x 365^2 x 10^3 is about 1.35e22 — past 2^53, where a double stops
    // counting exactly. The count itself is the claim, so this matters.
    const count = 36n ** 9n * 365n * 365n * 1000n;
    expect(count > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(count.toString()).toBe('13530325227149721600000');
  });
});

describe('the five counts the exhibit must reproduce', () => {
  /**
   * Each expected value is stated in `NAMED_SPACES` and checked here against
   * arithmetic written out independently — the product is formed from its
   * factors in this test rather than taken from `countSpace`, so a bug in the
   * counting cannot agree with itself.
   */
  const expected: Record<string, { count: bigint; bits: number; product: bigint }> = {
    'numeric-wide': {
      count: 133_225_000_000_000_000n,
      bits: 56.89,
      product: 365n * 365n * 10n ** 12n,
    },
    'alphanumeric-wide': {
      count: 13_530_325_227_149_721_600_000n,
      bits: 73.52,
      product: 365n * 365n * 36n ** 9n * 10n ** 3n,
    },
    'number-known': { count: 133_425_825n, bits: 26.99, product: 36_525n * 3_653n },
    'number-and-expiry-year-known': { count: 5_332_650n, bits: 22.35, product: 14_610n * 365n },
    'both-years-known': { count: 133_590n, bits: 17.03, product: 366n * 365n },
  };

  it('covers exactly the five rows, no more', () => {
    expect(NAMED_SPACES.map((s) => s.id).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const space of NAMED_SPACES) {
    it(`counts ${space.id} as ${space.expectedCount}`, () => {
      const want = expected[space.id];
      // The row's own declared expectation agrees with the independent product.
      expect(space.expectedCount).toBe(want.count);
      expect(want.product).toBe(want.count);
      // And the counting function agrees with both.
      const counted = countSpace(space.assumptions);
      expect(counted.count).toBe(want.count);
      expect(counted.bits).toBe(want.bits);
      expect(space.expectedBits).toBe(want.bits);
    });
  }

  it("reproduces Appendix A's printed formulas, factor for factor", () => {
    /**
     * Appendix A prints "365^2 * 10^12" and "365^2*36^9*10^3". Those factor as
     * 365 x 100 birth-date years, 365 x 10 expiry years, and the number: the
     * 10^12 of the first formula is 10^9 x 10^3, where the 10^3 is the same
     * 100 x 10 years of dates the second formula writes out separately. This
     * asserts that reading rather than describing it.
     */
    const numeric = NAMED_SPACES.find((s) => s.id === 'numeric-wide');
    const alnum = NAMED_SPACES.find((s) => s.id === 'alphanumeric-wide');
    expect(numeric?.expectedCount).toBe(365n ** 2n * 10n ** 12n);
    expect(alnum?.expectedCount).toBe(365n ** 2n * 36n ** 9n * 10n ** 3n);
    // The common factor, made explicit: 100 years x 10 years = 10^3.
    expect(365n * 100n * (365n * 10n)).toBe(365n ** 2n * 10n ** 3n);
    expect(numeric?.expectedCount).toBe(365n * 100n * (365n * 10n) * 10n ** 9n);
    expect(alnum?.expectedCount).toBe(365n * 100n * (365n * 10n) * 36n ** 9n);
  });

  it("rounds to Appendix A's own approximate bit figures", () => {
    // The standard says "approximately 56" and "73"; the exact logs are 56.89
    // and 73.52. Both round to within a bit of the published figure, which is
    // the agreement actually available — Appendix A gives no decimals.
    const numeric = NAMED_SPACES.find((s) => s.id === 'numeric-wide');
    const alnum = NAMED_SPACES.find((s) => s.id === 'alphanumeric-wide');
    expect(Math.abs((numeric?.expectedBits ?? 0) - ICAO_APPENDIX_A_ESTIMATES[0].bits)).toBeLessThan(1);
    expect(Math.abs((alnum?.expectedBits ?? 0) - ICAO_APPENDIX_A_ESTIMATES[1].bits)).toBeLessThan(1);
  });
});

describe('two ways of counting a span of years', () => {
  /**
   * Appendix A writes its formulas over a flat 365-day year; a span a searcher
   * declares contains its leap days. Both appear in this exhibit, and the
   * difference is small in bits and decisive in a search — a space counted at
   * 365 x 40 does not contain 29 February 1960.
   */
  it('counts a nominal year as 365 days, as Appendix A does', () => {
    expect(nominalYears(100).days).toBe(36_500);
    expect(nominalYears(10).days).toBe(3_650);
    expect(nominalYears(1).days).toBe(365);
  });

  it('counts calendar years with their leap days', () => {
    expect(calendarYears(100).days).toBe(36_525);
    expect(calendarYears(10).days).toBe(3_653);
    expect(calendarYears(40).days).toBe(14_610);
    // 1960 to 1999 is forty years holding ten leap days.
    expect(calendarYears(40).days).toBe(40 * 365 + 10);
  });

  it('counts a known leap year as 366 days and any other as 365', () => {
    expect(oneYear(true).days).toBe(366);
    expect(oneYear(false).days).toBe(365);
  });

  it('declares which counting it used, on screen', () => {
    expect(nominalYears(100).derivation).toMatch(/flat 365-day year/);
    expect(calendarYears(40).derivation).toMatch(/leap days included/);
    expect(oneYear(true).derivation).toMatch(/leap/);
  });

  it('disagrees by about one part in 1,460 — invisible in bits', () => {
    const nominal = nominalYears(100).days;
    const calendar = calendarYears(100).days;
    expect(calendar - nominal).toBe(25);
    expect(Math.abs(Math.log2(calendar) - Math.log2(nominal))).toBeLessThan(0.002);
  });
});

describe('check digits add nothing', () => {
  it('contributes a factor of exactly one', () => {
    // Four of MRZ_information's 24 characters are check digits, and they look
    // like they should multiply the space. They do not: each is a function of
    // the field it follows.
    const counted = countSpace({
      numberStyle: 'numeric',
      birth: nominalYears(100),
      expiry: nominalYears(10),
    });
    const digits = counted.factors.find((f) => f.label === 'Check digits');
    expect(digits?.value).toBe(1n);
  });

  it('leaves the product equal to the other factors alone', () => {
    const counted = countSpace({
      numberStyle: 'alphanumeric',
      birth: nominalYears(100),
      expiry: nominalYears(10),
    });
    const withoutDigits = counted.factors
      .filter((f) => f.label !== 'Check digits')
      .reduce((total, f) => total * f.value, 1n);
    expect(counted.count).toBe(withoutDigits);
  });
});

describe('the factors multiply to the count the exhibit prints', () => {
  it('holds for every named space', () => {
    // Parts-sum-to-whole: exhibit 4 renders each factor AND the product, so a
    // reader who multiplies the column must reach the printed total.
    for (const space of NAMED_SPACES) {
      const counted = countSpace(space.assumptions);
      const product = counted.factors.reduce((total, f) => total * f.value, 1n);
      expect(product, space.id).toBe(counted.count);
      expect(bitsOf(product), space.id).toBe(counted.bits);
    }
  });

  it('names a derivation for every factor', () => {
    for (const space of NAMED_SPACES) {
      for (const factor of countSpace(space.assumptions).factors) {
        expect(factor.derivation.length, `${space.id} / ${factor.label}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('quoted estimates stay quoted', () => {
  it("keeps Appendix A's figures attributed to Appendix A", () => {
    for (const estimate of ICAO_APPENDIX_A_ESTIMATES) {
      expect(estimate.source).toMatch(/ICAO Doc 9303 Part 11/);
      expect(estimate.source).toMatch(/Appendix A/);
      expect(estimate.source).toMatch(/Eighth Edition \(2021\)/);
    }
    expect(ICAO_APPENDIX_A_ESTIMATES.map((e) => e.bits)).toEqual([56, 73]);
  });

  it("keeps the 2005 paper's 52-bit figure attributed and dated", () => {
    // The paper's estimate is about US numbering as it stood in 2005. It is
    // never presented as this lab's own measurement, nor as current.
    expect(JUELS_MOLNAR_WAGNER_2005.bits).toBe(52);
    expect(JUELS_MOLNAR_WAGNER_2005.source).toMatch(/Juels, D\. Molnar, D\. Wagner/);
    expect(JUELS_MOLNAR_WAGNER_2005.source).toMatch(/2005/);
    expect(JUELS_MOLNAR_WAGNER_2005.note).toMatch(/that paper/);
  });

  it("reproduces the paper's own arithmetic", () => {
    // "about 14 bits" + "roughly 11" + "at most lg(15 x 10^7) ~ 27" = ~52.
    expect(Math.log2(15 * 10 ** 7)).toBeCloseTo(27.16, 2);
    expect(14 + 11 + Math.round(Math.log2(15 * 10 ** 7))).toBe(52);
  });
});

describe('projections', () => {
  it('divides the count by a measured rate', () => {
    expect(projectSeconds(1_000_000n, 1000)).toBeCloseTo(1000, 6);
  });

  it('survives counts far past Number.MAX_SAFE_INTEGER', () => {
    const count = NAMED_SPACES.find((s) => s.id === 'alphanumeric-wide')?.expectedCount ?? 0n;
    const seconds = projectSeconds(count, 25_000);
    // 1.353e22 / 25,000 = 5.41e17 seconds, about 1.7e10 years.
    expect(seconds).toBeGreaterThan(5e17);
    expect(seconds).toBeLessThan(5.5e17);
    expect(humanizeSeconds(seconds)).toMatch(/e\+1[0-9] years/);
  });

  it('refuses to project without a measured rate', () => {
    expect(() => projectSeconds(1000n, 0)).toThrow(/measured positive rate/);
    expect(() => projectSeconds(1000n, -5)).toThrow(/measured positive rate/);
    expect(() => projectSeconds(1000n, Number.NaN)).toThrow(/measured positive rate/);
  });

  it('picks a unit that leaves a readable number', () => {
    expect(humanizeSeconds(0.5)).toMatch(/seconds/);
    expect(humanizeSeconds(45)).toMatch(/second/);
    expect(humanizeSeconds(90)).toMatch(/minute/);
    expect(humanizeSeconds(7200)).toMatch(/hour/);
    expect(humanizeSeconds(172_800)).toMatch(/day/);
    expect(humanizeSeconds(63_115_200)).toMatch(/year/);
  });
});
