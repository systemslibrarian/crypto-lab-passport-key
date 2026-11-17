/**
 * The machine-readable zone: check digits, and the MRZ_information string the
 * keys are derived from.
 *
 * ## Where each rule comes from
 *
 * The check-digit algorithm is NOT in Part 11. Part 11 Section 4.3.2 says the
 * inspection system reads the document number, date of birth and date of
 * expiry "including their respective check digits, as described in Doc 9303-4,
 * Doc 9303-5 or Doc 9303-6" for the TD3, TD1 and TD2 form factors — and those
 * parts defer in turn to **Doc 9303 Part 3, Eighth Edition (2021), Section
 * 4.9, "Check Digits in the MRZ"**, which is where the weighting is actually
 * specified:
 *
 *   "A special check digit calculation has been adopted for use in MRTDs. The
 *   check digits shall be calculated on modulus 10 with a continuously
 *   repetitive weighting of 731 731 ..."
 *
 * and, for the character values:
 *
 *   "For data elements in which the number does not occupy all available
 *   character positions, the symbol < shall be used to complete vacant
 *   positions and shall be given the value of zero... the characters A to Z
 *   shall have the values 10 to 35 consecutively".
 *
 * The composition of MRZ_information is Part 11 Section 4.3.2 step 1: the
 * three fields with their check digits, concatenated, "typed in as it appears
 * in the MRZ".
 *
 * ## What this module refuses
 *
 * Everything here fails closed and says why, because a quietly-corrected input
 * would derive a key for a document nobody holds. A document number longer
 * than nine characters is refused rather than truncated — Part 11 has a route
 * for those (the number continues in the optional-data field, and Section
 * 9.7.3's note describes reassembling it), and that route is out of scope here,
 * so pretending to handle it would be worse than declining.
 */

/** The repeating weights of Doc 9303 Part 3 Section 4.9. */
export const CHECK_DIGIT_WEIGHTS: readonly number[] = [7, 3, 1];

/** The character the MRZ uses for a vacant position. It counts as zero. */
export const FILLER = '<';

/** The document-number field is nine characters wide in every form factor. */
export const DOCUMENT_NUMBER_WIDTH = 9;

/**
 * The numeric value of one MRZ character: digits as themselves, A-Z as 10-35,
 * the filler as zero. Anything else is not an MRZ character at all.
 */
export function characterValue(character: string): number {
  if (character === FILLER) return 0;
  if (character >= '0' && character <= '9') return character.charCodeAt(0) - 48;
  if (character >= 'A' && character <= 'Z') return character.charCodeAt(0) - 55;
  throw new Error(
    `${JSON.stringify(character)} is not an MRZ character (digits, A-Z and ${FILLER} only)`
  );
}

/** One step of the check-digit sum, kept separate so the UI can show the work. */
export interface CheckDigitStep {
  readonly character: string;
  readonly value: number;
  readonly weight: number;
  readonly product: number;
}

export interface CheckDigitWorking {
  readonly field: string;
  readonly steps: readonly CheckDigitStep[];
  readonly sum: number;
  readonly checkDigit: number;
}

/**
 * The check digit of `field`, with every multiplication kept.
 *
 * Exhibit 1 renders these steps, which is the whole reason this returns
 * working rather than a number: a learner who can see 7x21 + 3x8 + 1x9 ... can
 * check the arithmetic by hand, and a learner who is told "the check digit is
 * 3" can only believe it.
 */
export function checkDigitWorking(field: string): CheckDigitWorking {
  const steps: CheckDigitStep[] = [];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const character = field[i];
    const value = characterValue(character);
    const weight = CHECK_DIGIT_WEIGHTS[i % CHECK_DIGIT_WEIGHTS.length];
    const product = value * weight;
    steps.push({ character, value, weight, product });
    sum += product;
  }
  return { field, steps, sum, checkDigit: sum % 10 };
}

/** The check digit of `field`, per Doc 9303 Part 3 Section 4.9. */
export function checkDigit(field: string): number {
  return checkDigitWorking(field).checkDigit;
}

/* ── Field validation ─────────────────────────────────────────────────────── */

export type FieldName = 'documentNumber' | 'dateOfBirth' | 'dateOfExpiry';

export class MrzError extends Error {
  constructor(
    readonly field: FieldName,
    message: string,
    /** The correct value, where there is one to show — a wrong check digit. */
    readonly expected?: string
  ) {
    super(message);
    this.name = 'MrzError';
  }
}

/**
 * Pad a document number to nine characters with the filler, or refuse.
 *
 * Shorter is padded: Part 3 Section 4.9 says the filler "shall be used to
 * complete vacant positions", and the specimen in Appendix D is exactly this
 * case — `L898902C` is eight characters and appears as `L898902C<`. Longer is
 * refused; see the note at the top of this file.
 */
export function padDocumentNumber(documentNumber: string): string {
  const raw = documentNumber.toUpperCase().trim();
  if (raw.length === 0) {
    throw new MrzError('documentNumber', 'The document number is empty.');
  }
  if (raw.length > DOCUMENT_NUMBER_WIDTH) {
    throw new MrzError(
      'documentNumber',
      `This document number is ${raw.length} characters. The MRZ field holds ${DOCUMENT_NUMBER_WIDTH}. ` +
        'Part 11 continues a longer number in the optional-data field, which this lab does not implement.'
    );
  }
  for (const character of raw) characterValue(character); // throws on a bad character
  return raw.padEnd(DOCUMENT_NUMBER_WIDTH, FILLER);
}

/**
 * Check a YYMMDD date.
 *
 * The year is two digits and this does NOT guess a century: the MRZ carries
 * only `YY`, and the derivation hashes those two characters, so a century is
 * information the chip never sees either. That is also why the entropy counts
 * in exhibit 4 are over calendar days rather than over real dates.
 *
 * Day-of-month is checked against the month's real length, leap years
 * included — but only as far as a two-digit year allows: `00` is treated as
 * 2000, a leap year, which is the one century choice this has to make, and it
 * is the permissive one.
 */
export function validateDate(value: string, field: FieldName): void {
  if (!/^[0-9]{6}$/.test(value)) {
    throw new MrzError(field, `A date is six digits, YYMMDD. Got ${JSON.stringify(value)}.`);
  }
  const year = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12) {
    throw new MrzError(field, `There is no month ${String(month).padStart(2, '0')}.`);
  }
  // The two-digit year is read as 20YY purely to settle February: it makes
  // YY=00 a leap year, which admits 000229 rather than refusing it.
  const length = new Date(Date.UTC(2000 + year, month, 0)).getUTCDate();
  if (day < 1 || day > length) {
    const monthName = new Date(Date.UTC(2000 + year, month - 1, 1)).toLocaleString('en', {
      month: 'long',
      timeZone: 'UTC',
    });
    throw new MrzError(field, `${monthName} ${2000 + year} has ${length} days, not ${day}.`);
  }
}

/* ── MRZ_information ──────────────────────────────────────────────────────── */

export interface PrintedData {
  /** Up to nine characters; padded with the filler. */
  readonly documentNumber: string;
  /** YYMMDD. */
  readonly dateOfBirth: string;
  /** YYMMDD. */
  readonly dateOfExpiry: string;
}

export interface MrzInformation {
  readonly documentNumber: string;
  readonly documentNumberCheckDigit: number;
  readonly dateOfBirth: string;
  readonly dateOfBirthCheckDigit: number;
  readonly dateOfExpiry: string;
  readonly dateOfExpiryCheckDigit: number;
  /** The concatenation that gets hashed. */
  readonly value: string;
}

/**
 * Build MRZ_information from the printed fields (Part 11 Section 4.3.2 step 1).
 *
 * The check digits are COMPUTED here rather than accepted from the caller.
 * They are a function of the other three fields, so a learner who types one in
 * is telling us something we can already derive — which is why
 * `assertCheckDigit` exists separately, to compare a typed digit against the
 * computed one and show the difference. Leaving them out of the string
 * entirely is mutation 2, and it changes the hash.
 */
export function mrzInformation(data: PrintedData): MrzInformation {
  const documentNumber = padDocumentNumber(data.documentNumber);
  validateDate(data.dateOfBirth, 'dateOfBirth');
  validateDate(data.dateOfExpiry, 'dateOfExpiry');

  const documentNumberCheckDigit = checkDigit(documentNumber);
  const dateOfBirthCheckDigit = checkDigit(data.dateOfBirth);
  const dateOfExpiryCheckDigit = checkDigit(data.dateOfExpiry);

  return {
    documentNumber,
    documentNumberCheckDigit,
    dateOfBirth: data.dateOfBirth,
    dateOfBirthCheckDigit,
    dateOfExpiry: data.dateOfExpiry,
    dateOfExpiryCheckDigit,
    value:
      documentNumber +
      documentNumberCheckDigit +
      data.dateOfBirth +
      dateOfBirthCheckDigit +
      data.dateOfExpiry +
      dateOfExpiryCheckDigit,
  };
}

/**
 * Compare a check digit a learner typed against the computed one.
 *
 * Refuses with the correct digit shown, which is the teaching behaviour the
 * brief asks for: a wrong check digit means the inspection system would derive
 * the wrong key and the chip would simply refuse, with no hint as to which of
 * the four fields was mistyped.
 */
export function assertCheckDigit(field: FieldName, value: string, typed: number): void {
  const correct = checkDigit(value);
  if (correct !== typed) {
    throw new MrzError(
      field,
      `The check digit for ${value} is ${correct}, not ${typed}. ` +
        'A wrong digit derives a different key, and the chip would just refuse.',
      String(correct)
    );
  }
}

/* ── Rendering the machine-readable zone ──────────────────────────────────── */

/**
 * The lower MRZ line of a TD3 travel document — a passport.
 *
 * TD3 is the passport form factor, specified in **Doc 9303 Part 4, Eighth
 * Edition (2021)**, Section 4.2.2: a 44-character lower line laid out as
 * document number (1-9), its check digit (10), nationality (11-13), date of
 * birth (14-19), its check digit (20), sex (21), date of expiry (22-27), its
 * check digit (28), personal number or optional data (29-42), its check digit
 * (43), and the composite check digit (44).
 *
 * The composite digit covers "positions 1 to 10, 14 to 20 and 22 to 43" — Part
 * 4's own wording — excluding nationality and sex. It is computed with the
 * same Part 3 Section 4.9 weighting as every other check digit, and it plays
 * NO part in the key derivation: MRZ_information takes the three field digits
 * only. It is rendered because a reader looking at a printed zone should be
 * able to find every character in it, including the ones the protocol ignores.
 *
 * `mrz.test.ts` pins this layout against the TD3 specimen printed in Part 4
 * itself, whose composite digit does verify under the rule above.
 */
export function td3LowerLine(
  data: PrintedData,
  nationality = 'UTO',
  sex = 'F',
  personalNumber = ''
): string {
  const info = mrzInformation(data);
  const optional = personalNumber.toUpperCase().padEnd(14, FILLER);
  // An all-filler optional-data field takes check digit 0, per Part 4's note.
  const optionalCheckDigit = personalNumber.trim() === '' ? 0 : checkDigit(optional);

  // Positions 1-10, 14-20 and 22-43: everything the composite covers.
  const covered =
    info.documentNumber +
    info.documentNumberCheckDigit +
    info.dateOfBirth +
    info.dateOfBirthCheckDigit +
    info.dateOfExpiry +
    info.dateOfExpiryCheckDigit +
    optional +
    optionalCheckDigit;

  return (
    info.documentNumber +
    info.documentNumberCheckDigit +
    nationality.toUpperCase().padEnd(3, FILLER) +
    info.dateOfBirth +
    info.dateOfBirthCheckDigit +
    sex.toUpperCase() +
    info.dateOfExpiry +
    info.dateOfExpiryCheckDigit +
    optional +
    optionalCheckDigit +
    checkDigit(covered)
  );
}

/**
 * The upper MRZ line of a TD3 document: document code, issuing state, and the
 * holder's name in the `SURNAME<<GIVEN<NAMES` form, filler-padded to 44.
 *
 * Nothing here reaches the key derivation at all — the name is not hashed —
 * which is itself worth showing: the line a learner's eye goes to first is the
 * one the cryptography never touches.
 */
export function td3UpperLine(
  surname: string,
  givenNames: string,
  issuingState = 'UTO',
  documentCode = 'P'
): string {
  const name = `${surname.toUpperCase()}<<${givenNames.toUpperCase().replace(/\s+/g, '<')}`;
  return (
    documentCode.toUpperCase().padEnd(2, FILLER) +
    issuingState.toUpperCase().padEnd(3, FILLER) +
    name
  )
    .padEnd(44, FILLER)
    .slice(0, 44);
}

/** The positions each field occupies in a TD3 lower line, for labelling. */
export interface MrzFieldSpan {
  readonly label: string;
  /** 1-based, inclusive, as Doc 9303 numbers them. */
  readonly from: number;
  readonly to: number;
  /** Whether these characters are part of MRZ_information. */
  readonly hashed: boolean;
}

/**
 * The TD3 lower-line layout, as data.
 *
 * Exhibit 1 renders this to label every character of the printed zone and to
 * mark which ones the key derivation consumes. Keeping it as a table rather
 * than as markup means the claim "these eleven characters are the ones that
 * get hashed" is checkable by a test.
 */
export const TD3_LOWER_SPANS: readonly MrzFieldSpan[] = [
  { label: 'Document number', from: 1, to: 9, hashed: true },
  { label: 'Check digit', from: 10, to: 10, hashed: true },
  { label: 'Nationality', from: 11, to: 13, hashed: false },
  { label: 'Date of birth', from: 14, to: 19, hashed: true },
  { label: 'Check digit', from: 20, to: 20, hashed: true },
  { label: 'Sex', from: 21, to: 21, hashed: false },
  { label: 'Date of expiry', from: 22, to: 27, hashed: true },
  { label: 'Check digit', from: 28, to: 28, hashed: true },
  { label: 'Personal number', from: 29, to: 42, hashed: false },
  { label: 'Check digit', from: 43, to: 43, hashed: false },
  { label: 'Composite check digit', from: 44, to: 44, hashed: false },
];
