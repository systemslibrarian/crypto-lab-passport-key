/**
 * Exhibit 1 — The Printed Data.
 *
 * The lab's premise, shown rather than asserted: everything the chip's keys
 * are made of is printed on the page of the passport, in a font designed to be
 * read by a machine. The panel renders the machine-readable zone, marks the
 * characters the key derivation consumes, and computes each check digit one
 * multiplication at a time so a learner can add the column up by hand.
 *
 * The specimen is ICAO's own fictional Utopian document (Doc 9303 Part 11
 * Appendix D.2). A learner can also generate a random fictional document, and
 * the input says so beside itself — invariant 2: this page never asks for, and
 * has nowhere to put, a real document's data.
 */
import {
  checkDigitWorking,
  MrzError,
  mrzInformation,
  padDocumentNumber,
  TD3_LOWER_SPANS,
  td3LowerLine,
  td3UpperLine,
  validateDate,
  type PrintedData,
} from '../bac/mrz';
import { ICAO_APPENDIX_D, ICAO_SPECIMEN_HOLDER } from '../bac/vectors';
import { append, caveat, clear, disclosure, el, field, quote, table, textControl } from './dom';
import { currentDocument, onDocumentChange, setDocument, randomFictionalDocument } from './state';

export function renderPrintedData(panel: HTMLElement): void {
  const rerender = (): void => {
    clear(panel);
    append(panel, ...build());
  };
  rerender();
  // Re-render whether or not this panel is on screen. A hidden panel keeps
  // its DOM, and `main.ts` renders each panel ONCE — so skipping the re-render
  // while hidden left a panel showing the previous document the next time its
  // tab was activated. An unvisited panel has no listener at all, so it stays
  // empty until first activation, which is what `boot()` asserts.
  onDocumentChange(() => rerender());
}

function build(): HTMLElement[] {
  const data = currentDocument();
  return [
    el(
      'div',
      { class: 'panel-intro' },
      el('h2', { text: 'Everything the key is made of is printed on the page' }),
      el(
        'p',
        { class: 'lede' },
        'The two lines of chunky characters at the bottom of a passport are the ' +
          'machine-readable zone. A border officer scans them optically; the chip inside the ' +
          'document derives its access keys from three of those fields. Nothing is hidden — ' +
          'the key material is the printing itself, and this exhibit shows exactly which ' +
          'characters it is.'
      ),
      el(
        'p',
        {},
        'Eleven characters do all the work: a nine-character document number, a six-digit ' +
          'date of birth and a six-digit date of expiry, each followed by a check digit. ' +
          'The holder’s name, their nationality and their sex are printed right beside ' +
          'them and reach the key derivation not at all.'
      )
    ),
    el(
      'div',
      { class: 'scope-note' },
      'Specimen data only. The document below starts as the fictional Utopian specimen ' +
        'ICAO prints in its own worked example, and the generator produces fictional values. ' +
        'Do not type a real passport’s data into this page — it would not teach you ' +
        'anything the specimen does not, and this page has no business holding it.'
    ),
    renderZone(data),
    renderEditor(data),
    renderCheckDigits(data),
    renderMrzInformation(data),
    renderSources(),
  ];
}

/* ── The printed zone ─────────────────────────────────────────────────────── */

function renderZone(data: PrintedData): HTMLElement {
  const lower = td3LowerLine(data, 'UTO', ICAO_SPECIMEN_HOLDER.sex, '');
  const upper = td3UpperLine(
    ICAO_SPECIMEN_HOLDER.surname,
    ICAO_SPECIMEN_HOLDER.givenNames,
    ICAO_SPECIMEN_HOLDER.issuingState
  );

  // Mark each character of the lower line according to the span it falls in.
  const chars: HTMLElement[] = [];
  for (let position = 1; position <= lower.length; position++) {
    const span = TD3_LOWER_SPANS.find((s) => position >= s.from && position <= s.to);
    const character = lower[position - 1];
    chars.push(
      el(
        'span',
        {
          class: span?.hashed ? 'mrz-hashed' : undefined,
          'data-position': String(position),
        },
        character
      )
    );
  }

  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'The machine-readable zone, as printed' }),
    el(
      'div',
      { class: 'mrz-block', role: 'region', tabindex: '0', 'aria-label': 'The printed machine-readable zone, TD3 layout' },
      el(
        'pre',
        { class: 'mrz' },
        el('span', { class: 'mrz-line', id: 'mrz-upper', text: upper }),
        '\n',
        el('span', { class: 'mrz-line', id: 'mrz-lower' }, ...chars)
      )
    ),
    el(
      'p',
      { class: 'mrz-legend' },
      el(
        'span',
        {},
        el('span', { class: 'mrz-hashed', 'aria-hidden': 'true', text: 'ABC' }),
        ' = the ',
        el('strong', { id: 'hashed-count', text: String(hashedLength()) }),
        ' characters the keys are derived from'
      ),
      el('span', { text: 'Everything unmarked is printed beside them and never hashed.' })
    ),
    el(
      'p',
      { class: 'wire-note' },
      'TD3 is the passport form factor, 44 characters to a line, specified in ICAO Doc 9303 ' +
        'Part 4. The layout is generated from the field positions that document gives, and ' +
        'the composite check digit at position 44 is computed by the same rule as every ' +
        'other digit here.'
    ),
    el('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-label': 'Field positions in the lower line' },
      fieldPositionTable(lower)
    )
  );
}

function hashedLength(): number {
  return TD3_LOWER_SPANS.filter((s) => s.hashed).reduce((n, s) => n + (s.to - s.from + 1), 0);
}

function fieldPositionTable(lower: string): HTMLElement {
  const rows = TD3_LOWER_SPANS.map((span) => [
    `${span.from}${span.to > span.from ? `–${span.to}` : ''}`,
    span.label,
    el('code', { class: 'value', text: lower.slice(span.from - 1, span.to) }),
    span.hashed ? 'yes' : 'no',
  ]);
  const t = table(
    'Field positions in the lower line, and which reach the key derivation',
    [
      { text: 'Position' },
      { text: 'Field' },
      { text: 'Printed' },
      { text: 'Hashed?' },
    ],
    rows
  );
  // `table()` already wraps in a labelled region; unwrap so the caller's
  // wrapper is the only one (a region inside a region is a duplicate landmark).
  return t.firstElementChild as HTMLElement;
}

/* ── The editor ───────────────────────────────────────────────────────────── */

function renderEditor(data: PrintedData): HTMLElement {
  const number = textControl({
    id: 'doc-number',
    label: 'Document number',
    value: data.documentNumber,
    hint: 'Up to 9 characters: digits, A–Z, or < as filler. Longer is refused, not truncated.',
    // Deliberately NO maxlength. A cap of 9 would silently swallow the tenth
    // character, so a learner who typed a longer number would see it quietly
    // shortened and a key derived for a document they did not type. The
    // refusal has to be REACHABLE to teach anything, so the field accepts the
    // input and `padDocumentNumber` declines it, naming the field width and
    // what Part 11 does with longer numbers.
    size: 14,
  });
  const birth = textControl({
    id: 'doc-birth',
    label: 'Date of birth (YYMMDD)',
    value: data.dateOfBirth,
    hint: 'Six digits. The MRZ carries no century.',
    maxlength: 6,
    size: 8,
  });
  const expiry = textControl({
    id: 'doc-expiry',
    label: 'Date of expiry (YYMMDD)',
    value: data.dateOfExpiry,
    hint: 'Six digits.',
    maxlength: 6,
    size: 8,
  });

  const apply = (): void => {
    const next: PrintedData = {
      documentNumber: number.input.value,
      dateOfBirth: birth.input.value,
      dateOfExpiry: expiry.input.value,
    };
    number.setError(null);
    birth.setError(null);
    expiry.setError(null);
    try {
      padDocumentNumber(next.documentNumber);
    } catch (error) {
      number.setError(message(error));
      return;
    }
    try {
      validateDate(next.dateOfBirth, 'dateOfBirth');
    } catch (error) {
      birth.setError(message(error));
      return;
    }
    try {
      validateDate(next.dateOfExpiry, 'dateOfExpiry');
    } catch (error) {
      expiry.setError(message(error));
      return;
    }
    setDocument(next);
  };

  const applyButton = el('button', { type: 'button', class: 'btn-primary', id: 'apply-document' }, 'Use this document');
  applyButton.addEventListener('click', apply);

  const specimenButton = el('button', { type: 'button', id: 'use-specimen' }, 'Reset to the ICAO specimen');
  specimenButton.addEventListener('click', () => {
    setDocument({
      documentNumber: ICAO_APPENDIX_D.documentNumber,
      dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
      dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
    });
  });

  const randomButton = el('button', { type: 'button', id: 'random-document' }, 'Generate a fictional document');
  randomButton.addEventListener('click', () => setDocument(randomFictionalDocument()));

  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'Change the printed data' }),
    el(
      'p',
      {},
      'Every value downstream — the key seed, both document keys, the handshake and the ' +
        'size of the search — is a function of these three fields and nothing else. Change ' +
        'one character and watch the keys in exhibit 2 change completely.'
    ),
    el('div', { class: 'control-grid' }, number.wrapper, birth.wrapper, expiry.wrapper),
    el('div', { class: 'btn-row' }, applyButton, specimenButton, randomButton),
    el(
      'p',
      { class: 'wire-note', id: 'current-document' },
      'In use: ',
      el('code', { class: 'value', text: padDocumentNumber(data.documentNumber) }),
      ', born ',
      el('code', { class: 'value', text: data.dateOfBirth }),
      ', expires ',
      el('code', { class: 'value', text: data.dateOfExpiry }),
      '.'
    )
  );
}

function message(error: unknown): string {
  if (error instanceof MrzError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/* ── Check digits, step by step ───────────────────────────────────────────── */

function renderCheckDigits(data: PrintedData): HTMLElement {
  const info = mrzInformation(data);
  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'Each check digit, one multiplication at a time' }),
    el(
      'p',
      {},
      'A check digit catches a misread character; it adds nothing a searcher has to guess, ' +
        'because it is computed from the field it follows. The rule is ICAO Doc 9303 Part 3 ' +
        'Section 4.9: weight the characters 7, 3, 1 repeating from the left, add the ' +
        'products, and take the remainder modulo 10.'
    ),
    checkDigitWorkingTable('Document number', info.documentNumber),
    checkDigitWorkingTable('Date of birth', info.dateOfBirth),
    checkDigitWorkingTable('Date of expiry', info.dateOfExpiry),
    disclosure(
      'Why a letter counts as 10 to 35, and < as zero',
      el(
        'p',
        {},
        'The weighting has to work on a field that mixes letters and digits, so Part 3 ' +
          'assigns A to Z the values 10 to 35 and gives the filler character < the value ' +
          'zero. That is also why a short document number is padded with < rather than with ' +
          'spaces: the padding has to have a defined numeric value.'
      ),
      quote(
        'For data elements in which the number does not occupy all available character ' +
          'positions, the symbol < shall be used to complete vacant positions and shall be ' +
          'given the value of zero for the purpose of calculating the check digit.',
        'ICAO Doc 9303 Part 3, Eighth Edition (2021), Section 4.9'
      )
    )
  );
}

function checkDigitWorkingTable(label: string, value: string): HTMLElement {
  const working = checkDigitWorking(value);
  const rows = working.steps.map((step) => [
    el('code', { class: 'value', text: step.character }),
    String(step.value),
    String(step.weight),
    String(step.product),
  ]);
  rows.push([
    el('strong', { text: 'sum' }),
    '',
    '',
    el('strong', { class: 'cd-sum', text: String(working.sum) }),
  ]);
  return el(
    'div',
    { class: 'cd-working', 'data-field': label },
    el('h4', {}, label, ': ', el('code', { class: 'value', text: value })),
    table(
      `${label} check digit working`,
      [{ text: 'Character' }, { text: 'Value', numeric: true }, { text: 'Weight', numeric: true }, { text: 'Product', numeric: true }],
      rows
    ),
    el(
      'p',
      { class: 'wire-note' },
      el('code', { class: 'value', text: `${working.sum} mod 10 = ${working.checkDigit}` }),
      ' — so the check digit printed after ',
      el('code', { class: 'value', text: value }),
      ' is ',
      el('strong', { class: 'cd-result', 'data-field': label, text: String(working.checkDigit) }),
      '.'
    )
  );
}

/* ── MRZ_information ──────────────────────────────────────────────────────── */

function renderMrzInformation(data: PrintedData): HTMLElement {
  const info = mrzInformation(data);
  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'The string that gets hashed' }),
    el(
      'p',
      {},
      'Concatenate the three fields with their check digits, in that order, and you have ' +
        'what the standard calls MRZ_information. Twenty-four ASCII characters. Exhibit 2 ' +
        'takes it from here.'
    ),
    el('div', { class: 'field' },
      el('span', { class: 'field-label', text: 'MRZ_information' }),
      el('span', { class: 'field-value' },
        el('code', { class: 'value', id: 'mrz-information', text: info.value })
      )
    ),
    field('Length', el('code', { class: 'value', id: 'mrz-information-length', text: `${info.value.length} characters` })),
    el(
      'p',
      { class: 'wire-note' },
      'Built as document number (',
      el('code', { class: 'value', text: info.documentNumber }),
      ') + check digit (',
      el('code', { class: 'value', text: String(info.documentNumberCheckDigit) }),
      ') + date of birth (',
      el('code', { class: 'value', text: info.dateOfBirth }),
      ') + check digit (',
      el('code', { class: 'value', text: String(info.dateOfBirthCheckDigit) }),
      ') + date of expiry (',
      el('code', { class: 'value', text: info.dateOfExpiry }),
      ') + check digit (',
      el('code', { class: 'value', text: String(info.dateOfExpiryCheckDigit) }),
      ').'
    ),
    quote(
      'The inspection system reads the "MRZ_information". The "MRZ_information" consists of ' +
        'the concatenation of Document Number, Date of Birth and Date of Expiry, including ' +
        'their respective check digits [...] Alternatively, the required information can be ' +
        'typed in; in this case it SHALL be typed in as it appears in the MRZ.',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Section 4.3.2'
    )
  );
}

function renderSources(): HTMLElement {
  return disclosure(
    'Where the specimen comes from, and what is out of scope here',
    el(
      'p',
      {},
      'The document above starts as the specimen ICAO prints in Doc 9303 Part 11 Appendix ' +
        'D.2 — a fictional Utopian passport issued to ANNA MARIA ERIKSSON, document number ' +
        'L898902C, born 6 August 1969, expiring 23 June 1994. Every value in exhibits 2 and ' +
        '3 can be checked against that appendix.'
    ),
    caveat(
      'Not in scope on this page',
      el(
        'p',
        {},
        'Document numbers longer than nine characters. Part 11 continues those in the ' +
          'optional-data field of the MRZ and reassembles them, and this lab refuses them ' +
          'rather than pretending to handle them. Also out of scope: any real country’s ' +
          'numbering scheme, the contactless radio layer, and the document-signing PKI.'
      )
    )
  );
}
