import { describe, expect, it } from 'vitest';
import {
  assertCheckDigit,
  characterValue,
  CHECK_DIGIT_WEIGHTS,
  checkDigit,
  checkDigitWorking,
  MrzError,
  mrzInformation,
  padDocumentNumber,
  TD3_LOWER_SPANS,
  td3LowerLine,
  td3UpperLine,
  validateDate,
} from './mrz';
import { ICAO_APPENDIX_D, ICAO_TD3_SPECIMEN_PART4, SECOND_VECTOR } from './vectors';

describe('the check-digit weighting of Doc 9303 Part 3 Section 4.9', () => {
  it('repeats 7, 3, 1 from the left', () => {
    expect([...CHECK_DIGIT_WEIGHTS]).toEqual([7, 3, 1]);
    const working = checkDigitWorking('ABCDEFG');
    expect(working.steps.map((s) => s.weight)).toEqual([7, 3, 1, 7, 3, 1, 7]);
  });

  it('values digits as themselves, A-Z as 10-35, and the filler as zero', () => {
    expect(characterValue('0')).toBe(0);
    expect(characterValue('9')).toBe(9);
    expect(characterValue('A')).toBe(10);
    expect(characterValue('Z')).toBe(35);
    expect(characterValue('<')).toBe(0);
  });

  it('refuses a character the MRZ cannot carry', () => {
    expect(() => characterValue('a')).toThrow(/not an MRZ character/);
    expect(() => characterValue('-')).toThrow(/not an MRZ character/);
  });

  it('is the weighted sum modulo 10', () => {
    // Computed by hand from the rule, independently of the implementation:
    // 'AB' -> A=10 x7 = 70, B=11 x3 = 33, sum 103, 103 mod 10 = 3.
    const working = checkDigitWorking('AB');
    expect(working.sum).toBe(103);
    expect(working.checkDigit).toBe(3);
  });

  it('reproduces the three check digits Appendix D prints', () => {
    expect(checkDigit(ICAO_APPENDIX_D.documentNumber)).toBe(
      ICAO_APPENDIX_D.checkDigits.documentNumber
    );
    expect(checkDigit(ICAO_APPENDIX_D.dateOfBirth)).toBe(ICAO_APPENDIX_D.checkDigits.dateOfBirth);
    expect(checkDigit(ICAO_APPENDIX_D.dateOfExpiry)).toBe(ICAO_APPENDIX_D.checkDigits.dateOfExpiry);
  });

  it('reproduces the second vector, which puts letters in the number', () => {
    expect(checkDigit(SECOND_VECTOR.documentNumber)).toBe(
      SECOND_VECTOR.checkDigits.documentNumber
    );
    expect(checkDigit(SECOND_VECTOR.dateOfBirth)).toBe(SECOND_VECTOR.checkDigits.dateOfBirth);
    expect(checkDigit(SECOND_VECTOR.dateOfExpiry)).toBe(SECOND_VECTOR.checkDigits.dateOfExpiry);
  });

  it('keeps the working so the arithmetic can be checked by eye', () => {
    const working = checkDigitWorking(ICAO_APPENDIX_D.dateOfBirth);
    expect(working.steps).toHaveLength(6);
    // The displayed products must sum to the displayed sum: exhibit 1 renders
    // both, and a reader who adds the column must get the stated total.
    expect(working.steps.reduce((t, s) => t + s.product, 0)).toBe(working.sum);
    expect(working.sum % 10).toBe(working.checkDigit);
  });

  it('is NOT the 1, 3, 7 weighting — mutation 1', () => {
    // The reversed weighting is a plausible transcription slip and it produces
    // a different digit on the standard's own specimen, which is what makes it
    // catchable at all.
    const field = ICAO_APPENDIX_D.documentNumber;
    const reversed = [1, 3, 7];
    let sum = 0;
    for (let i = 0; i < field.length; i++) sum += characterValue(field[i]) * reversed[i % 3];
    expect(sum % 10).not.toBe(ICAO_APPENDIX_D.checkDigits.documentNumber);
  });
});

describe('the document-number field', () => {
  it('pads a short number with the filler, as the specimen is padded', () => {
    expect(padDocumentNumber('L898902C')).toBe('L898902C<');
    expect(padDocumentNumber('L898902C')).toBe(ICAO_APPENDIX_D.documentNumber);
  });

  it('leaves a nine-character number alone', () => {
    expect(padDocumentNumber('AB1234567')).toBe('AB1234567');
  });

  it('upper-cases, since the MRZ has no lower case', () => {
    expect(padDocumentNumber('ab1234567')).toBe('AB1234567');
  });

  it('refuses a number longer than the field', () => {
    expect(() => padDocumentNumber('ABCDEFGHIJ')).toThrow(MrzError);
    expect(() => padDocumentNumber('ABCDEFGHIJ')).toThrow(/10 characters/);
  });

  it('refuses an empty number', () => {
    expect(() => padDocumentNumber('')).toThrow(/empty/);
  });
});

describe('dates', () => {
  it('accepts the specimen dates', () => {
    expect(() => validateDate('690806', 'dateOfBirth')).not.toThrow();
    expect(() => validateDate('940623', 'dateOfExpiry')).not.toThrow();
  });

  it('refuses month 13', () => {
    expect(() => validateDate('901301', 'dateOfBirth')).toThrow(/no month 13/);
  });

  it('refuses day 32', () => {
    expect(() => validateDate('900132', 'dateOfBirth')).toThrow(/31 days, not 32/);
  });

  it('refuses 30 February and accepts 29 February in a leap year', () => {
    expect(() => validateDate('000230', 'dateOfBirth')).toThrow(/February/);
    expect(() => validateDate('000229', 'dateOfBirth')).not.toThrow();
  });

  it('refuses anything that is not six digits', () => {
    expect(() => validateDate('69080', 'dateOfBirth')).toThrow(/six digits/);
    expect(() => validateDate('6908O6', 'dateOfBirth')).toThrow(/six digits/);
  });
});

describe('MRZ_information, per Part 11 Section 4.3.2 step 1', () => {
  it("reproduces Appendix D's string", () => {
    const info = mrzInformation({
      documentNumber: ICAO_APPENDIX_D.documentNumber,
      dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
      dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
    });
    expect(info.value).toBe(ICAO_APPENDIX_D.mrzInformation);
  });

  it("reproduces the second vector's string", () => {
    const info = mrzInformation({
      documentNumber: SECOND_VECTOR.documentNumber,
      dateOfBirth: SECOND_VECTOR.dateOfBirth,
      dateOfExpiry: SECOND_VECTOR.dateOfExpiry,
    });
    expect(info.value).toBe(SECOND_VECTOR.mrzInformation);
  });

  it('includes all three check digits — mutation 2', () => {
    const info = mrzInformation({
      documentNumber: ICAO_APPENDIX_D.documentNumber,
      dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
      dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
    });
    // 9 + 1 + 6 + 1 + 6 + 1 = 24 characters. Dropping the digits gives 21,
    // and a different hash.
    expect(info.value).toHaveLength(24);
    const withoutDigits =
      ICAO_APPENDIX_D.documentNumber + ICAO_APPENDIX_D.dateOfBirth + ICAO_APPENDIX_D.dateOfExpiry;
    expect(withoutDigits).toHaveLength(21);
    expect(info.value).not.toBe(withoutDigits);
  });

  it('puts the fields in the order number, birth, expiry', () => {
    const info = mrzInformation({
      documentNumber: 'AB1234567',
      dateOfBirth: '851231',
      dateOfExpiry: '300101',
    });
    expect(info.value.slice(0, 9)).toBe('AB1234567');
    expect(info.value.slice(10, 16)).toBe('851231');
    expect(info.value.slice(17, 23)).toBe('300101');
  });

  it('refuses invalid input rather than deriving a key for nobody', () => {
    expect(() =>
      mrzInformation({ documentNumber: 'AB1234567', dateOfBirth: '851332', dateOfExpiry: '300101' })
    ).toThrow(MrzError);
  });
});

describe('a check digit a learner typed', () => {
  it('is refused with the correct digit shown', () => {
    expect(() => assertCheckDigit('documentNumber', 'L898902C<', 4)).toThrow(/is 3, not 4/);
    try {
      assertCheckDigit('documentNumber', 'L898902C<', 4);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MrzError);
      expect((error as MrzError).expected).toBe('3');
      expect((error as MrzError).field).toBe('documentNumber');
    }
  });

  it('accepts the right one', () => {
    expect(() => assertCheckDigit('documentNumber', 'L898902C<', 3)).not.toThrow();
  });
});

describe('the printed TD3 zone', () => {
  it("reproduces the TD3 specimen printed in Doc 9303 Part 4", () => {
    /**
     * The anchor for the whole layout. Part 4 prints this line, and its
     * composite check digit verifies under the Part 3 Section 4.9 weighting —
     * which is what makes it usable as a check on `td3LowerLine`.
     *
     * Part 11's own Appendix D.2 prints TD1 and TD2 renderings of the BAC
     * specimen whose composite digits do NOT verify (TD2 shows 8 where the
     * rule gives 2). Appendix D is informative and the composite digit reaches
     * no key, but it is why this lab generates its printed line from the rule
     * rather than copying a literal.
     */
    const line = td3LowerLine(
      {
        documentNumber: ICAO_TD3_SPECIMEN_PART4.documentNumber,
        dateOfBirth: ICAO_TD3_SPECIMEN_PART4.dateOfBirth,
        dateOfExpiry: ICAO_TD3_SPECIMEN_PART4.dateOfExpiry,
      },
      'UTO',
      'F',
      ICAO_TD3_SPECIMEN_PART4.personalNumber
    );
    expect(line).toBe(ICAO_TD3_SPECIMEN_PART4.lowerLine);
  });

  it('is 44 characters, as a TD3 line is', () => {
    expect(ICAO_TD3_SPECIMEN_PART4.lowerLine).toHaveLength(44);
    expect(
      td3LowerLine({
        documentNumber: ICAO_APPENDIX_D.documentNumber,
        dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
        dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
      })
    ).toHaveLength(44);
    expect(td3UpperLine('ERIKSSON', 'ANNA MARIA')).toHaveLength(44);
  });

  it('carries a composite check digit that verifies its own line', () => {
    // Not a tautology: the composite is computed over positions 1-10, 14-20
    // and 22-43, and this recomputes it from the RENDERED line rather than
    // from the inputs, so a layout slip that shifted a field would show up.
    const line = td3LowerLine({
      documentNumber: ICAO_APPENDIX_D.documentNumber,
      dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
      dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
    });
    const covered = line.slice(0, 10) + line.slice(13, 20) + line.slice(21, 43);
    expect(String(checkDigit(covered))).toBe(line[43]);
  });

  it('places every field where TD3_LOWER_SPANS says it does', () => {
    const data = {
      documentNumber: ICAO_APPENDIX_D.documentNumber,
      dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
      dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
    };
    const line = td3LowerLine(data);
    const span = (label: string): string => {
      const s = TD3_LOWER_SPANS.find((x) => x.label === label);
      if (!s) throw new Error(`no span ${label}`);
      return line.slice(s.from - 1, s.to);
    };
    expect(span('Document number')).toBe(ICAO_APPENDIX_D.documentNumber);
    expect(span('Date of birth')).toBe(ICAO_APPENDIX_D.dateOfBirth);
    expect(span('Date of expiry')).toBe(ICAO_APPENDIX_D.dateOfExpiry);
    expect(span('Nationality')).toBe('UTO');
    expect(span('Sex')).toBe('F');
    // The spans tile the line with no gap and no overlap.
    let at = 1;
    for (const s of TD3_LOWER_SPANS) {
      expect(s.from, `${s.label} starts where the previous span ended`).toBe(at);
      at = s.to + 1;
    }
    expect(at - 1).toBe(44);
  });

  it('marks exactly the characters that MRZ_information consumes', () => {
    /**
     * The teaching claim of exhibit 1, as arithmetic: the spans flagged
     * `hashed` must concatenate to precisely the MRZ_information string. If
     * the layout table and the derivation ever disagree, the page would be
     * highlighting the wrong characters while deriving the right key.
     */
    const data = {
      documentNumber: ICAO_APPENDIX_D.documentNumber,
      dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
      dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
    };
    const line = td3LowerLine(data);
    const hashed = TD3_LOWER_SPANS.filter((s) => s.hashed)
      .map((s) => line.slice(s.from - 1, s.to))
      .join('');
    expect(hashed).toBe(mrzInformation(data).value);
    expect(hashed).toBe(ICAO_APPENDIX_D.mrzInformation);
  });

  it('does not hash the holder name at all', () => {
    // Two documents differing only in the name derive identical keys.
    const data = {
      documentNumber: ICAO_APPENDIX_D.documentNumber,
      dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
      dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
    };
    expect(td3UpperLine('ERIKSSON', 'ANNA MARIA')).not.toBe(td3UpperLine('SMITH', 'JOHN'));
    expect(mrzInformation(data).value).toBe(ICAO_APPENDIX_D.mrzInformation);
  });
});
