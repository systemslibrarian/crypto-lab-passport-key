/**
 * Exhibit 4 — How Many Guesses Is That?
 *
 * The controls are the assumptions. A learner dials in what a searcher is
 * supposed to know, and the count and its base-2 logarithm follow. The five
 * named rows underneath are fixed reference points, two of them ICAO's own
 * formulas from Appendix A and three narrower.
 *
 * The honesty rule for this whole panel: these are COUNTS OF POSSIBILITIES,
 * and a count is an entropy only if the choice is uniform — which Appendix A
 * says plainly it is not. Every label here says "possibilities" or "guesses".
 * Nothing on this page claims to have measured the strength of any real
 * country's documents, and the panel says so where a reader might assume
 * otherwise.
 */
import {
  calendarYears,
  countSpace,
  ICAO_APPENDIX_A_ESTIMATES,
  JUELS_MOLNAR_WAGNER_2005,
  NAMED_SPACES,
  nominalYears,
  oneYear,
  type Assumptions,
  type NumberStyle,
} from '../bac/entropy';
import { append, clear, disclosure, el, formatCount, quote, selectControl, table } from './dom';

interface Controls {
  numberStyle: NumberStyle;
  birthSpan: 'nominal-100' | 'calendar-100' | 'calendar-40' | 'one-leap-year' | 'one-year';
  expirySpan: 'nominal-10' | 'calendar-10' | 'one-year';
}

export function renderCounting(panel: HTMLElement): void {
  const controls: Controls = {
    numberStyle: 'numeric',
    birthSpan: 'nominal-100',
    expirySpan: 'nominal-10',
  };

  const rerender = (): void => {
    clear(panel);
    append(panel, ...build(controls, rerender));
  };
  rerender();
}

function assumptionsOf(controls: Controls): Assumptions {
  const birth = {
    'nominal-100': nominalYears(100),
    'calendar-100': calendarYears(100),
    'calendar-40': calendarYears(40),
    'one-leap-year': oneYear(true),
    'one-year': oneYear(false),
  }[controls.birthSpan];
  const expiry = {
    'nominal-10': nominalYears(10),
    'calendar-10': calendarYears(10),
    'one-year': oneYear(false),
  }[controls.expirySpan];
  return { numberStyle: controls.numberStyle, birth, expiry };
}

function build(controls: Controls, rerender: () => void): HTMLElement[] {
  const assumptions = assumptionsOf(controls);
  const counted = countSpace(assumptions);

  return [
    el(
      'div',
      { class: 'panel-introduction panel-intro' },
      el('h2', { text: 'How many documents could have produced that key?' }),
      el(
        'p',
        { class: 'lede' },
        'The keys are a function of three printed fields, so the question "how hard is this ' +
          'key to guess" is really "how many values could those three fields have taken". ' +
          'That is a counting problem, and the answer depends entirely on what the person ' +
          'guessing already knows.'
      ),
      el(
        'p',
        {},
        'The controls below are those assumptions. Notice what the check digits do to the ' +
          'count: nothing. Four of the twenty-four characters look like they should multiply ' +
          'the space and each one is computed from the field in front of it.'
      )
    ),
    renderCaveat(),
    renderControls(controls, rerender),
    renderCount(counted, assumptions),
    renderNamedRows(),
    renderQuoted(),
    renderSources(),
  ];
}

function renderCaveat(): HTMLElement {
  return el(
    'div',
    { class: 'callout callout-caveat', id: 'counting-caveat' },
    el('span', { class: 'callout-title', text: 'A count is not an entropy' }),
    el(
      'p',
      {},
      'Every number on this page counts possibilities under the assumption that each is ' +
        'equally likely. Real document numbers are not drawn uniformly at random — they are ' +
        'issued in sequence, by office, over time — so the real difficulty is lower than ' +
        'these counts, sometimes much lower. Appendix A of the standard says this itself. ' +
        'Read these as the best case for the document, not as a measurement of any ' +
        'country’s passports.'
    )
  );
}

function renderControls(controls: Controls, rerender: () => void): HTMLElement {
  const number = selectControl({
    id: 'count-number',
    label: 'Document number assumption',
    value: controls.numberStyle,
    choices: [
      { value: 'numeric', text: 'Nine digits, unknown (10^9)' },
      { value: 'alphanumeric', text: 'Nine alphanumeric characters, unknown (36^9)' },
      { value: 'known', text: 'Known to the searcher' },
    ],
    hint: 'The 2005 analysis notes the number "is not typically considered a secret".',
  });
  number.select.addEventListener('change', () => {
    controls.numberStyle = number.select.value as NumberStyle;
    rerender();
  });

  const birth = selectControl({
    id: 'count-birth',
    label: 'Date-of-birth window',
    value: controls.birthSpan,
    choices: [
      { value: 'nominal-100', text: '100 years, counted as 365 days each (Appendix A)' },
      { value: 'calendar-100', text: '100 calendar years, leap days included' },
      { value: 'calendar-40', text: '40 calendar years, e.g. 1960 to 1999' },
      { value: 'one-leap-year', text: 'One known leap year (366 days)' },
      { value: 'one-year', text: 'One known year (365 days)' },
    ],
  });
  birth.select.addEventListener('change', () => {
    controls.birthSpan = birth.select.value as Controls['birthSpan'];
    rerender();
  });

  const expiry = selectControl({
    id: 'count-expiry',
    label: 'Date-of-expiry window',
    value: controls.expirySpan,
    choices: [
      { value: 'nominal-10', text: '10 years, counted as 365 days each (Appendix A)' },
      { value: 'calendar-10', text: '10 calendar years, leap days included' },
      { value: 'one-year', text: 'One known year (365 days)' },
    ],
    hint: 'A passport is typically valid for ten years, which bounds this field.',
  });
  expiry.select.addEventListener('change', () => {
    controls.expirySpan = expiry.select.value as Controls['expirySpan'];
    rerender();
  });

  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'What does the searcher know?' }),
    el(
      'div',
      { class: 'control-grid', role: 'group', 'aria-label': 'Counting assumptions' },
      number.wrapper,
      birth.wrapper,
      expiry.wrapper
    )
  );
}

function renderCount(
  counted: ReturnType<typeof countSpace>,
  assumptions: Assumptions
): HTMLElement {
  return el(
    'div',
    { class: 'card', id: 'count-result' },
    el('h3', { text: 'The count' }),
    table(
      'The factors of the current count',
      [{ text: 'Factor' }, { text: 'Possibilities', numeric: true }, { text: 'Where it comes from' }],
      counted.factors.map((factor) => [
        factor.label,
        el('span', { 'data-factor': factor.label, text: formatCount(factor.value) }),
        factor.derivation,
      ])
    ),
    el(
      'div',
      { class: 'search-stats' },
      el(
        'div',
        {},
        el('span', { class: 'stat-label', text: 'Possibilities' }),
        el('span', { class: 'stat-value', id: 'count-total', text: formatCount(counted.count) })
      ),
      el(
        'div',
        {},
        el('span', { class: 'stat-label', text: 'Base-2 logarithm' }),
        el('span', { class: 'stat-value', id: 'count-bits', text: `${counted.bits.toFixed(2)} bits` })
      )
    ),
    el(
      'p',
      { class: 'wire-note', id: 'count-sentence' },
      'Multiplying the column above gives ',
      el('strong', { text: formatCount(counted.count) }),
      ' possible documents, which is ',
      el('strong', { text: counted.bits.toFixed(2) }),
      ' bits — if each is equally likely, and ',
      assumptions.numberStyle === 'known'
        ? 'if the document number really is known.'
        : 'document numbers are not in fact drawn uniformly at random.'
    )
  );
}

function renderNamedRows(): HTMLElement {
  const rows = NAMED_SPACES.map((space) => [
    space.label,
    el('span', { 'data-space-count': space.id, text: formatCount(space.expectedCount) }),
    el('span', { 'data-space-bits': space.id, text: space.expectedBits.toFixed(2) }),
    space.source === 'icao-appendix-a' ? 'ICAO Appendix A' : 'narrower assumption',
  ]);
  return el(
    'div',
    { class: 'card', id: 'named-spaces' },
    el('h3', { text: 'Five reference points' }),
    el(
      'p',
      {},
      'The first two rows are the standard’s own formulas. The rest narrow the ' +
        'assumptions the way a real searcher would, and the last one is the space exhibit 5 ' +
        'actually searches in your browser.'
    ),
    table(
      'Five named search spaces, their counts and their base-2 logarithms',
      [
        { text: 'Assumption' },
        { text: 'Possibilities', numeric: true },
        { text: 'Bits', numeric: true },
        { text: 'Source' },
      ],
      rows
    ),
    el(
      'p',
      { class: 'wire-note' },
      'The first two rows count a year as a flat 365 days, because Appendix A’s formulas ' +
        'do. The narrower rows count real calendar days, leap days included — a difference ' +
        'of about one part in 1,460, invisible in a bit count and decisive in a search, since ' +
        'a space counted at 365 days a year does not contain 29 February.'
    )
  );
}

function renderQuoted(): HTMLElement {
  return el(
    'div',
    { class: 'card', id: 'quoted-estimates' },
    el('h3', { text: 'What the sources themselves say' }),
    quote(
      'For a 10-year valid travel document the maximum strength of the keys is approximately: ' +
        '56 Bit for a numeric Document Number (365^2 * 10^12 possibilities); 73 Bit for an ' +
        'alphanumeric Document Number (365^2*36^9*10^3 possibilities). Especially in the ' +
        'second case this estimation requires the Document Number to be randomly and ' +
        'uniformly chosen which is usually not the case.',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Appendix A'
    ),
    el(
      'p',
      {},
      'The two figures this page reproduces exactly: ',
      ...ICAO_APPENDIX_A_ESTIMATES.flatMap((estimate, i) => [
        i > 0 ? ' and ' : '',
        el('strong', { text: `${estimate.bits} bits` }),
        ` (${estimate.note})`,
      ]),
      '.'
    ),
    quote(
      'We estimate that the birth date yields about 14 bits of entropy and the expiration ' +
        'date, which has a 10-year maximum period, yields roughly 11 bits of entropy. [...] ' +
        'Given fifteen passport issuing agencies currently in the United States, U.S. ' +
        'passport numbers have at most lg(15 x 10^7) ~ 27 bits of entropy. This means Basic ' +
        'Access Control keys have a total of about 52 bits of entropy.',
      'A. Juels, D. Molnar, D. Wagner, "Security and Privacy Issues in E-passports", 2005'
    ),
    el(
      'div',
      { class: 'callout callout-caveat' },
      el('span', { class: 'callout-title', text: 'That figure is from 2005, and is about one scheme' }),
      el(
        'p',
        {},
        'The ',
        el('strong', { text: `${JUELS_MOLNAR_WAGNER_2005.bits}-bit` }),
        ' estimate describes the United States numbering scheme as that paper found it in ' +
          '2005 — nine digits, the first two encoding one of fifteen issuing offices. It is ' +
          'quoted here as that paper’s account of that scheme at that date. This page ' +
          'makes no claim about any country’s present numbering, and you should not read ' +
          'these counts as the strength of any particular document.'
      ),
      el(
        'p',
        {},
        'The same paper makes a point the counting misses entirely: the document number is ' +
          'not treated as a secret in the first place. "Entities such as cruise ships, travel ' +
          'agents, airlines, and many others will see the number and may include it on paper ' +
          'documents." A number that is printed on an itinerary is not 27 bits of anything.'
      )
    )
  );
}

function renderSources(): HTMLElement {
  return disclosure(
    'Why the arithmetic uses BigInt',
    el(
      'p',
      {},
      'The alphanumeric count is 365² x 36⁹ x 10³, about 1.35 x 10²². ' +
        'A JavaScript number stops counting exactly above 2⁵³, around 9 x 10¹⁵, ' +
        'so that figure would be printed merely close rather than correct. The counts here ' +
        'are exact integers and only the logarithm is a floating-point value.'
    ),
    el(
      'p',
      {},
      'The logarithm is taken from the integer’s bit length plus a floating-point ' +
        'mantissa rather than by converting the whole count to a double, for the same reason.'
    )
  );
}
