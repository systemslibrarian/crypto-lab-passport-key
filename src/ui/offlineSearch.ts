/**
 * Exhibit 5 — One Recording, Searched Offline.
 *
 * The lab's conclusion, and its negative claim.
 *
 * Record a handshake in exhibit 3. Hand the search worker the two recorded
 * byte strings and whatever the learner declares known — and nothing else.
 * The worker grinds candidate birth and expiry dates until one reproduces the
 * recorded checksum, and then the page derives K_Enc from the recovered data
 * and decrypts the recording to the nonces and keying material that were
 * really sent.
 *
 * ## The negative claim this panel exists to prove
 *
 * "The handshake succeeded and the session is encrypted. That says nothing
 * about someone who only listened: this one recording yields the keys to
 * anyone who can guess the printed data, and here that took the number of
 * guesses shown."
 *
 * Its evidence fixture is the state after a successful search: every check the
 * protocol performs reports success, every MAC verified, both sides accepted
 * — and the verdict reads MUTUAL AUTHENTICATION SUCCEEDED — AND THE RECORDING
 * WAS OPENED OFFLINE. The bite fixture is a declared space that excludes the
 * true dates: the handshake still succeeds, and the "opened offline" clause
 * must NOT appear.
 *
 * ## What the worker is given
 *
 * `recordingForSearch()` returns the bytes alone; `truthForChecking()` is
 * called only after the worker reports, to decide whether what it found is
 * right. The task is built from the former and the verdict from both, and
 * `search.ts`'s `assertNoSecrets` throws at the boundary if anything else
 * rides along.
 */
import { toHex } from '../bac/bytes';
import { cbcDecrypt, tripleDesKey } from '../bac/des';
import { basicAccessKeys } from '../bac/kdf';
import { NAMED_SPACES, humanizeSeconds, projectSeconds } from '../bac/entropy';
import {
  datesInYear,
  keysFromHit,
  spaceSize,
  type SearchHit,
  type SearchOutcome,
  type SearchProgress,
  type SearchTask,
} from '../bac/search';
import { startSearch, type RunningSearch } from '../bac/searchClient';
import {
  append,
  caveat,
  clear,
  disclosure,
  el,
  field,
  formatCount,
  hex,
  quote,
  retired,
  selectControl,
  table,
  verdict,
} from './dom';
import { hasRecording, onRecordingChange, recordingForSearch, truthForChecking } from './recordingStore';

/** The sentence the negative-claim test asserts, in one place. */
export const NEGATIVE_CLAIM =
  'The handshake succeeded and the session is encrypted. That says nothing about someone ' +
  'who only listened: this one recording yields the keys to anyone who can guess the ' +
  'printed data, and here that took the number of guesses shown.';

/** The verdict wording for the evidence fixture. */
export const OPENED_VERDICT = 'MUTUAL AUTHENTICATION SUCCEEDED — AND THE RECORDING WAS OPENED OFFLINE';

/**
 * How wide a window of birth years the searcher declares.
 *
 * Exhibit 4 offers a forty-calendar-year row, so exhibit 5 has to be able to
 * actually search one — otherwise the only space a learner can run is the
 * smallest, and the 22.35-bit row stays an arithmetic claim. It is also what
 * makes cancellation a real state rather than a theoretical one: a 366 x 365
 * space finishes in a few seconds, so there is nothing to cancel.
 */
export type BirthWindow = 'one-year' | 'decade' | 'forty-years';

interface PanelState {
  /** Which birth year the learner declares. */
  birthYear: number;
  birthWindow: BirthWindow;
  /** Which expiry year the learner declares. */
  expiryYear: number;
  /** Whether the document number is declared known. Required to search. */
  numberKnown: boolean;
  running: RunningSearch | null;
  progress: SearchProgress | null;
  outcome: SearchOutcome | null;
  /** Set when the recording changed under a result still on screen. */
  staleReason: string | null;
}

export function renderOfflineSearch(panel: HTMLElement): void {
  const truth = truthForChecking();
  const state: PanelState = {
    birthYear: truth ? Number(truth.dateOfBirth.slice(0, 2)) : 69,
    birthWindow: 'one-year',
    expiryYear: truth ? Number(truth.dateOfExpiry.slice(0, 2)) : 94,
    numberKnown: true,
    running: null,
    progress: null,
    outcome: null,
    staleReason: null,
  };

  const rerender = (): void => {
    clear(panel);
    append(panel, ...build(state, rerender));
  };

  rerender();

  onRecordingChange(() => {
    state.running?.cancel();
    state.running = null;
    if (state.outcome !== null || state.progress !== null) {
      state.staleReason = 'The recording changed';
    }
    state.outcome = null;
    state.progress = null;
    const next = truthForChecking();
    if (next) {
      // Pre-declare the true years so the panel opens on a space that
      // contains the answer. A learner who wants the bite fixture changes one
      // of them, which is a single click and the honest default either way.
      state.birthYear = Number(next.dateOfBirth.slice(0, 2));
      state.expiryYear = Number(next.dateOfExpiry.slice(0, 2));
    }
    // Re-render even while hidden; see handshake.ts for why.
    rerender();
  });
}

/**
 * The two-digit years a declared window covers.
 *
 * The declared year is always inside the window, so widening it can only make
 * the search slower and never make it fail — which is the honest behaviour: a
 * searcher who knows less searches more.
 */
export function windowYears(birthYear: number, window: BirthWindow): number[] {
  switch (window) {
    case 'one-year':
      return [birthYear];
    case 'decade': {
      const decade = Math.floor(birthYear / 10) * 10;
      return Array.from({ length: 10 }, (_, i) => decade + i);
    }
    case 'forty-years': {
      // 1960 to 1999 — exhibit 4's fourth row, and the window the 2005
      // analysis's "about 14 bits of entropy" for a birth date roughly
      // corresponds to.
      return Array.from({ length: 40 }, (_, i) => 60 + i);
    }
  }
}

function build(state: PanelState, rerender: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    el(
      'div',
      { class: 'panel-intro' },
      el('h2', { text: 'One recording is enough' }),
      el(
        'p',
        { class: 'lede' },
        'Nothing here breaks the protocol. The handshake in exhibit 3 ran correctly, every ' +
          'checksum verified, both sides accepted, and the session keys came from fresh ' +
          'randomness. The attack is simply this: the recorded checksum M_IFD was computed ' +
          'under a key made of printed data, so a guess at that data can be tested against ' +
          'it — without the passport, without a reader, and without going back to the chip.'
      ),
      el(
        'p',
        {},
        'Each guess costs two SHA-1 compressions and seven DES block operations. The search ' +
          'below runs in a Web Worker so the page stays responsive, and reports the rate it ' +
          'actually achieved in your browser.'
      )
    ),
    quote(
      'Eavesdropping: this is an offline attack, i.e. the attacker tries to decrypt ' +
        'intercepted communication without access to the contactless IC.',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Appendix A'
    ),
  ];

  if (!hasRecording()) {
    nodes.push(
      verdict(
        'info',
        'No recording yet',
        el('span', { class: 'verdict-body' },
          'Go to exhibit 3 and run a handshake. This panel gets the two byte strings that ' +
            'crossed the air and nothing else.'
        ),
        'no-recording'
      )
    );
    nodes.push(renderSources());
    return nodes;
  }

  nodes.push(renderRecordingCard());
  nodes.push(renderControls(state, rerender));

  if (state.staleReason) {
    nodes.push(retired(state.staleReason));
  } else if (state.running !== null) {
    nodes.push(renderProgress(state));
  } else if (state.outcome !== null) {
    nodes.push(...renderOutcome(state.outcome));
  }

  nodes.push(renderSources());
  return nodes;
}

/* ── What the searcher has ────────────────────────────────────────────────── */

function renderRecordingCard(): HTMLElement {
  const recording = recordingForSearch();
  if (recording === null) return el('div');
  return el(
    'div',
    { class: 'card', id: 'recording-card' },
    el('h3', { text: 'The recording' }),
    el(
      'p',
      {},
      'Two byte strings, lifted off the air during the reader’s EXTERNAL AUTHENTICATE. ' +
        'This is the whole input.'
    ),
    field('E_IFD', hex(toHex(recording.eIfd), 8), '32 bytes of ciphertext'),
    field('M_IFD', hex(toHex(recording.mIfd), 4), 'its 8-byte retail MAC'),
    el(
      'p',
      { class: 'wire-note' },
      'No key, no nonce, no name, no date. The worker that runs the search is handed exactly ' +
        'these two values plus the fields declared below, and the code refuses a task that ' +
        'carries anything else.'
    )
  );
}

/* ── The controls ─────────────────────────────────────────────────────────── */

function renderControls(state: PanelState, rerender: () => void): HTMLElement {
  const yearChoices = (from: number, to: number): { value: string; text: string }[] => {
    const out: { value: string; text: string }[] = [];
    for (let y = from; y <= to; y++) {
      const yy = String(y).padStart(2, '0');
      out.push({ value: yy, text: `${yy} (${datesInYear(y).length} days)` });
    }
    return out;
  };

  const birth = selectControl({
    id: 'search-birth-year',
    label: 'Declared birth year (YY)',
    value: String(state.birthYear).padStart(2, '0'),
    choices: yearChoices(0, 99),
    hint: 'The year the searcher believes the holder was born in.',
  });
  birth.select.addEventListener('change', () => {
    state.birthYear = Number(birth.select.value);
    state.outcome = null;
    state.staleReason = null;
    rerender();
  });

  const expiry = selectControl({
    id: 'search-expiry-year',
    label: 'Declared expiry year (YY)',
    value: String(state.expiryYear).padStart(2, '0'),
    choices: yearChoices(0, 99),
    hint: 'A ten-year document narrows this to a handful of candidates.',
  });
  expiry.select.addEventListener('change', () => {
    state.expiryYear = Number(expiry.select.value);
    state.outcome = null;
    state.staleReason = null;
    rerender();
  });

  const window = selectControl({
    id: 'search-birth-window',
    label: 'Birth-year window',
    value: state.birthWindow,
    choices: [
      { value: 'one-year', text: 'The declared year only' },
      { value: 'decade', text: 'That decade — ten years' },
      { value: 'forty-years', text: '1960 to 1999 — forty calendar years' },
    ],
    hint: 'Widening it can only make the search slower, never make it fail.',
  });
  window.select.addEventListener('change', () => {
    state.birthWindow = window.select.value as BirthWindow;
    state.outcome = null;
    state.staleReason = null;
    rerender();
  });

  const truth = truthForChecking();
  const years = windowYears(state.birthYear, state.birthWindow);
  const known = {
    documentNumber: truth?.documentNumber ?? '',
    birthYears: years,
    expiryYears: [state.expiryYear],
  };
  const size = spaceSize(known);

  const start = el(
    'button',
    { type: 'button', class: 'btn-primary', id: 'start-search' },
    `Search ${formatCount(size)} candidates`
  ) as HTMLButtonElement;
  const cancel = el('button', { type: 'button', id: 'cancel-search' }, 'Cancel') as HTMLButtonElement;
  cancel.disabled = state.running === null;
  start.disabled = state.running !== null;

  start.addEventListener('click', () => {
    const recording = recordingForSearch();
    const t = truthForChecking();
    if (recording === null || t === null) return;

    // The task is built from the recording and the declared fields ONLY. The
    // true dates are in `t` and deliberately not referenced here — only the
    // document number, which the learner declared known.
    const task: SearchTask = {
      known: {
        documentNumber: t.documentNumber,
        birthYears: windowYears(state.birthYear, state.birthWindow),
        expiryYears: [state.expiryYear],
      },
      recording,
    };

    state.outcome = null;
    state.staleReason = null;
    state.progress = null;
    state.running = startSearch(task, (progress) => {
      state.progress = progress;
      updateProgress(progress);
    });
    const running = state.running;
    running.done
      .then((outcome) => {
        if (state.running !== running) return;
        state.running = null;
        state.outcome = outcome;
        rerender();
      })
      .catch((error: unknown) => {
        if (state.running !== running) return;
        state.running = null;
        state.outcome = null;
        state.staleReason = `The search failed: ${error instanceof Error ? error.message : String(error)}`;
        rerender();
      });
    rerender();
  });

  cancel.addEventListener('click', () => {
    cancel.disabled = true;
    state.running?.cancel();
  });

  return el(
    'div',
    { class: 'card', id: 'search-controls' },
    el('h3', { text: 'What does the searcher declare it knows?' }),
    el(
      'p',
      {},
      'The document number is declared known — the 2005 analysis notes it "is not typically ' +
        'considered a secret", being seen by airlines, travel agents and hotels. The two ' +
        'years below bound the dates. Everything else is searched.'
    ),
    el(
      'div',
      { class: 'control-grid', role: 'group', 'aria-label': 'Declared knowledge' },
      birth.wrapper,
      window.wrapper,
      expiry.wrapper
    ),
    el(
      'p',
      { class: 'wire-note', id: 'declared-space' },
      'Declared space: ',
      el('strong', { id: 'declared-space-size', text: formatCount(size) }),
      ' candidates (',
      el('code', {
        class: 'value',
        text: `${years.reduce((n, y) => n + datesInYear(y).length, 0)} birth dates x ${datesInYear(state.expiryYear).length} expiry dates`,
      }),
      ').'
    ),
    el('div', { class: 'btn-row' }, start, cancel),
    el(
      'p',
      { class: 'wire-note' },
      'Declare a year the holder was not born in and the search will report that it found ' +
        'nothing — which is the honest outcome, and the proof that the worker really does ' +
        'only have the recorded bytes.'
    )
  );
}

/* ── Progress ─────────────────────────────────────────────────────────────── */

function renderProgress(state: PanelState): HTMLElement {
  const progress = state.progress;
  return el(
    'div',
    { class: 'card', id: 'search-progress' },
    el('h3', { text: 'Searching' }),
    el(
      'div',
      { class: 'meter', role: 'progressbar', 'aria-label': 'Search progress', id: 'search-meter' },
      el('div', { class: 'meter-fill', id: 'search-meter-fill', style: 'width:0%' })
    ),
    el(
      'div',
      { class: 'search-stats', role: 'status', 'aria-live': 'polite', id: 'search-stats' },
      stat('Tried', 'search-tried', progress ? formatCount(progress.tried) : '0'),
      stat('Of', 'search-total', progress ? formatCount(progress.total) : '—'),
      stat('Rate', 'search-rate', progress ? `${formatCount(Math.round(progress.guessesPerSecond))}/s` : '—'),
      stat('Elapsed', 'search-elapsed', progress ? `${(progress.elapsedMs / 1000).toFixed(1)}s` : '0.0s')
    ),
    el(
      'p',
      { class: 'wire-note' },
      'Cancel is read at the next chunk boundary — about a tenth of a second — because a ' +
        'worker in a tight loop cannot check its own message queue until the loop yields.'
    )
  );
}

function stat(label: string, id: string, value: string): HTMLElement {
  return el(
    'div',
    {},
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value', id, text: value })
  );
}

function updateProgress(progress: SearchProgress): void {
  const fill = document.getElementById('search-meter-fill');
  const meter = document.getElementById('search-meter');
  if (fill) fill.style.width = `${Math.min(100, (progress.tried / progress.total) * 100).toFixed(1)}%`;
  if (meter) {
    meter.setAttribute('aria-valuenow', String(progress.tried));
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(progress.total));
  }
  set('search-tried', formatCount(progress.tried));
  set('search-total', formatCount(progress.total));
  set('search-rate', `${formatCount(Math.round(progress.guessesPerSecond))}/s`);
  set('search-elapsed', `${(progress.elapsedMs / 1000).toFixed(1)}s`);
}

function set(id: string, text: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

/* ── Outcomes ─────────────────────────────────────────────────────────────── */

function renderOutcome(outcome: SearchOutcome): HTMLElement[] {
  switch (outcome.outcome) {
    case 'found':
      return renderHit(outcome);
    case 'not-found':
      return [
        verdict(
          'info',
          'Not found in the declared space',
          el('span', { class: 'verdict-body' },
            `All ${formatCount(outcome.tried)} candidates were tried and none reproduced the ` +
              'recorded checksum. The dates are outside the years declared above, or the ' +
              'document number declared is wrong — and the searcher has no way to tell which.'
          ),
          'search-verdict'
        ),
        el(
          'div',
          { class: 'card', id: 'not-found-card' },
          el('h3', { text: 'The handshake still succeeded' }),
          el(
            'p',
            {},
            'Note what did not change: the recording is a valid exchange between a genuine ' +
              'reader and a genuine chip. Every checksum in it verifies. The search failing ' +
              'is a statement about the declared space, not about the protocol — widen the ' +
              'years and it will succeed.'
          ),
          searchStats(outcome)
        ),
      ];
    case 'cancelled':
      return [
        verdict(
          'info',
          'Search cancelled',
          el('span', { class: 'verdict-body' },
            `Stopped after ${formatCount(outcome.tried)} of ${formatCount(outcome.total)} ` +
              'candidates. Nothing is claimed about the ones not tried.'
          ),
          'search-verdict'
        ),
        el('div', { class: 'card' }, searchStats(outcome)),
      ];
  }
}

function renderHit(hit: SearchHit): HTMLElement[] {
  const truth = truthForChecking();
  const recording = recordingForSearch();

  // The verdict is decided HERE, outside the search, by comparing what it
  // reported against values it never had — and by decrypting.
  const datesMatch =
    truth !== null &&
    hit.dateOfBirth === truth.dateOfBirth &&
    hit.dateOfExpiry === truth.dateOfExpiry;

  const recovered = basicAccessKeys(keysFromHit(hit).kSeed);
  let plaintext: Uint8Array | null = null;
  if (recording !== null) {
    plaintext = cbcDecrypt(tripleDesKey(recovered.enc.key), recording.eIfd);
  }

  const nodes: HTMLElement[] = [];

  /**
   * The evidence fixture's verdict.
   *
   * Tone `alarm`, not `pass`: colour tracks system integrity here, not the
   * return value. Every check the protocol performs reported success, and the
   * recording was opened anyway — that is not a green outcome.
   */
  nodes.push(
    verdict(
      'alarm',
      OPENED_VERDICT,
      el(
        'span',
        { class: 'verdict-body' },
        el('p', { id: 'negative-claim', text: NEGATIVE_CLAIM }),
        el(
          'p',
          {},
          'Guesses tried: ',
          el('strong', { id: 'hit-tried', text: formatCount(hit.tried) }),
          ' of ',
          el('strong', { text: formatCount(hit.total) }),
          ' in the declared space.'
        )
      ),
      'search-verdict'
    )
  );

  nodes.push(
    el(
      'div',
      { class: 'card', id: 'hit-card' },
      el('h3', { text: 'What the search recovered' }),
      field('Date of birth', el('code', { class: 'value', id: 'found-birth', text: hit.dateOfBirth })),
      field('Date of expiry', el('code', { class: 'value', id: 'found-expiry', text: hit.dateOfExpiry })),
      field('MRZ_information', el('code', { class: 'value', id: 'found-mrz', text: hit.mrzInformation })),
      field('K_Enc', hex(toHex(recovered.enc.key), 4), 'derived from the recovered printed data'),
      field('K_MAC', hex(toHex(recovered.mac.key), 4)),
      searchStats(hit)
    )
  );

  nodes.push(
    el(
      'div',
      { class: 'card', id: 'confirmation-card' },
      el('h3', { text: 'Two independent confirmations' }),
      el(
        'p',
        {},
        'A matching checksum is a claim. These are the evidence.'
      ),
      verdict(
        datesMatch ? 'pass' : 'fail',
        datesMatch
          ? 'The recovered dates equal the document’s real dates'
          : 'The recovered dates do NOT equal the real dates',
        el('span', { class: 'verdict-body' },
          datesMatch
            ? 'Compared after the fact, against values the search never had. The searcher was ' +
              'given E_IFD and M_IFD and two declared years.'
            : 'The search matched the checksum on data that is not the document’s. Treat ' +
              'this as a bug, not a result.'
        ),
        'dates-verdict'
      ),
      plaintext === null
        ? el('p', { text: 'No recording to decrypt.' })
        : el(
            'div',
            {},
            verdict(
              'pass',
              'The recovered key decrypts the recording',
              el('span', { class: 'verdict-body' },
                'E_IFD decrypted under the key the recovered printed data derives. The ' +
                  'plaintext below is the reader’s nonce, the chip’s nonce and the ' +
                  'reader’s 16 bytes of keying material — all three now in the hands of ' +
                  'someone who only listened.'
              ),
              'decrypt-verdict'
            ),
            field('RND.IFD', hex(toHex(plaintext.slice(0, 8)), 4)),
            field('RND.IC', hex(toHex(plaintext.slice(8, 16)), 4)),
            field('K.IFD', hex(toHex(plaintext.slice(16)), 4), 'half the session key seed')
          )
    )
  );

  nodes.push(renderProjections(hit));
  return nodes;
}

function searchStats(outcome: SearchOutcome): HTMLElement {
  return el(
    'div',
    { class: 'search-stats', id: 'final-stats' },
    stat('Guesses tried', 'final-tried', formatCount(outcome.tried)),
    stat('Declared space', 'final-total', formatCount(outcome.total)),
    stat('Measured rate', 'final-rate', `${formatCount(Math.round(outcome.guessesPerSecond))}/s`),
    stat('Elapsed', 'final-elapsed', `${(outcome.elapsedMs / 1000).toFixed(2)}s`)
  );
}

/**
 * The larger spaces of exhibit 4, timed from the rate this browser just
 * achieved.
 *
 * Invariant 6: computed from the MEASURED rate and labelled as projections.
 * There is no constant rate anywhere in this file — the number comes from the
 * search that just ran, in this browser, on this machine.
 */
function renderProjections(hit: SearchHit): HTMLElement {
  const rate = hit.guessesPerSecond;
  const rows = NAMED_SPACES.map((space) => [
    space.label,
    formatCount(space.expectedCount),
    space.expectedBits.toFixed(2),
    el('span', {
      class: 'projection',
      'data-projection': space.id,
      text: humanizeSeconds(projectSeconds(space.expectedCount, rate)),
    }),
  ]);

  return el(
    'div',
    { class: 'card', id: 'projections-card' },
    el('h3', { text: 'The same rate, against the larger spaces' }),
    el(
      'p',
      {},
      'Your browser just managed ',
      el('strong', { id: 'measured-rate', text: formatCount(Math.round(rate)) }),
      ' guesses a second, single-threaded, in one worker. Every time below is that measured ' +
        'rate divided into the counts from exhibit 4.'
    ),
    el(
      'div',
      { class: 'callout callout-caveat' },
      el('span', { class: 'callout-title', text: 'These are projections, not measurements' }),
      el(
        'p',
        {},
        'Only the first row of exhibit 4’s table was actually searched here. The rest are ' +
          'arithmetic: a count divided by a rate. A real adversary would not be ' +
          'single-threaded, would not be running in a browser tab, and would not be guessing ' +
          'dates uniformly — so treat the long numbers as an upper bound on difficulty ' +
          'rather than a schedule.'
      )
    ),
    table(
      'Projected time for each named space, at the rate measured in this browser',
      [
        { text: 'Assumption' },
        { text: 'Possibilities', numeric: true },
        { text: 'Bits', numeric: true },
        { text: 'Projected time', numeric: true },
      ],
      rows
    )
  );
}

/* ── Sources ──────────────────────────────────────────────────────────────── */

function renderSources(): HTMLElement {
  return disclosure(
    'What makes this an offline attack, and what it is not',
    el(
      'p',
      {},
      'Appendix A separates two threats. Skimming is online: the attacker talks to the chip ' +
        'in real time and is limited by how long it can hold the document and how fast the ' +
        'chip answers. Eavesdropping is offline: the attacker records one exchange and then ' +
        'has all the time and all the hardware it can buy.'
    ),
    el(
      'p',
      {},
      'This exhibit is the second kind. The chip is gone; the passport may have been renewed ' +
        'years ago. Nothing about the recording expires, which is the other half of the 2005 ' +
        'paper’s complaint: "a single fixed key is used for the lifetime of the ' +
        'e-passport. As a consequence, it is impossible to revoke a reader’s access to ' +
        'the e-passport once it has been read."'
    ),
    caveat(
      'What this does not show',
      el(
        'p',
        {},
        'Not how a recording would be obtained. The contactless radio layer, eavesdropping ' +
          'range and reader hardware are all out of scope here — this lab starts from the ' +
          'assumption that someone has the bytes, and asks what follows. Nor does it show ' +
          'anything about any particular country’s documents: the search space is the ' +
          'one declared above, on a fictional specimen.'
      )
    )
  );
}
