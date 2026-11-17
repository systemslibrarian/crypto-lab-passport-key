/**
 * Exhibit 3 — The Handshake.
 *
 * Three columns: the reader, the chip, and an eavesdropper who sees only what
 * crosses the air. The standard's worked example runs first, value for value;
 * then a live run with nonces from `crypto.getRandomValues`; then the learner
 * flips a byte and watches the chip refuse.
 *
 * The eavesdropper's column is the point of the layout, and it is a claim the
 * claims suite checks: while a handshake is on screen, nothing inside
 * `.party-eavesdropper` may be a key, a nonce or the printed data. That column
 * is also exactly the input exhibit 5's search is given.
 *
 * Specified in ICAO Doc 9303 Part 11 Sections 4.3.1 and 4.3.3, worked through
 * in Appendix D.3.
 */
import { fromHex, toHex } from '../bac/bytes';
import {
  record,
  runHandshake,
  type Handshake,
  type Rejection,
} from '../bac/bac';
import { ICAO_APPENDIX_D } from '../bac/vectors';
import { append, caveat, clear, disclosure, el, field, hex, quote, retired, table, verdict } from './dom';
import { currentDocument, currentKeys, isSpecimen, onDocumentChange } from './state';
import { setRecording } from './recordingStore';

type Mode = 'worked-example' | 'live' | 'tampered-cryptogram' | 'tampered-checksum' | 'replay';

interface PanelState {
  mode: Mode;
  handshake: Handshake;
  /** Set when the document changed under a result that is still on screen. */
  staleReason: string | null;
}

export function renderHandshake(panel: HTMLElement): void {
  const state: PanelState = {
    mode: isSpecimen() ? 'worked-example' : 'live',
    handshake: run(isSpecimen() ? 'worked-example' : 'live'),
    staleReason: null,
  };

  const rerender = (): void => {
    clear(panel);
    append(panel, ...build(state, rerender));
  };

  rerender();

  onDocumentChange(() => {
    // The printed data changed, so every cryptogram on screen was computed
    // under keys that are no longer this document's. Retire the result rather
    // than leaving it beside data it does not describe.
    state.staleReason = 'The printed data changed';
    state.mode = isSpecimen() ? 'worked-example' : 'live';
    // Re-render even while hidden: `main.ts` renders each panel once, so a
    // hidden panel that skipped this would still be showing cryptograms
    // computed under the previous document's keys when its tab was next
    // opened — the exact stale-evidence state this notice exists to prevent.
    rerender();
  });
}

function run(mode: Mode): Handshake {
  const keys = currentKeys().keys;
  switch (mode) {
    case 'worked-example':
      // Appendix D's own nonces and keying material, so the output is the
      // appendix's output. Only reachable while the specimen is loaded.
      return runHandshake(keys, {
        rndIc: fromHex(ICAO_APPENDIX_D.rndIc),
        rndIfd: fromHex(ICAO_APPENDIX_D.rndIfd),
        kIfd: fromHex(ICAO_APPENDIX_D.kIfd),
        kIc: fromHex(ICAO_APPENDIX_D.kIc),
      });
    case 'live':
      return runHandshake(keys);
    case 'tampered-cryptogram':
      return runHandshake(keys, { tamperEIfdByte: Math.floor(Math.random() * 32) });
    case 'tampered-checksum':
      return runHandshake(keys, { tamperMIfdByte: Math.floor(Math.random() * 8) });
    case 'replay':
      return runHandshake(keys);
  }
}

function build(state: PanelState, rerender: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    el(
      'div',
      { class: 'panel-intro' },
      el('h2', { text: 'Three messages, and an eavesdropper watching all of them' }),
      el(
        'p',
        { class: 'lede' },
        'The reader and the chip prove to each other that they both know the two keys, ' +
          'without either sending a key. The chip picks a random number and asks the reader ' +
          'to encrypt it back; the reader does the same in reverse. Then they combine the ' +
          'random material each contributed into a fresh pair of session keys.'
      ),
      el(
        'p',
        {},
        'Watch the third column. The eavesdropper never learns a key — the protocol is doing ' +
          'its job — but what it does record is enough to test a guess at the printed data ' +
          'later, which is exhibit 5.'
      )
    ),
    renderControls(state, rerender),
  ];

  if (state.staleReason) {
    nodes.push(retired(state.staleReason));
    return nodes;
  }

  nodes.push(renderModeNote(state.mode));
  nodes.push(renderColumns(state.handshake));
  nodes.push(renderVerdicts(state.handshake, state.mode));
  if (state.mode === 'worked-example') nodes.push(renderAppendixComparison(state.handshake));
  if (state.handshake.chip.accepted) nodes.push(renderSession(state.handshake));
  nodes.push(renderSources());
  return nodes;
}

/* ── Controls ─────────────────────────────────────────────────────────────── */

function renderControls(state: PanelState, rerender: () => void): HTMLElement {
  const go = (mode: Mode): void => {
    state.mode = mode;
    state.handshake = run(mode);
    state.staleReason = null;
    if (mode === 'live' || mode === 'worked-example') {
      // Only a successful handshake produces a recording worth searching.
      setRecording(
        state.handshake.chip.accepted ? record(state.handshake) : null,
        currentDocument()
      );
    }
    rerender();
  };

  const button = (id: string, mode: Mode, label: string, primary = false): HTMLButtonElement => {
    const node = el('button', {
      type: 'button',
      id,
      class: primary ? 'btn-primary' : undefined,
      'aria-pressed': String(state.mode === mode),
    }, label) as HTMLButtonElement;
    node.addEventListener('click', () => go(mode));
    return node;
  };

  const buttons: HTMLElement[] = [];
  if (isSpecimen()) {
    buttons.push(button('run-worked-example', 'worked-example', 'Run the standard’s example'));
  }
  buttons.push(button('run-live', 'live', 'Run live with fresh nonces', true));
  buttons.push(button('tamper-cryptogram', 'tampered-cryptogram', 'Flip a byte of E_IFD'));
  buttons.push(button('tamper-checksum', 'tampered-checksum', 'Flip a byte of M_IFD'));

  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'Run it' }),
    el('div', { class: 'btn-row', role: 'group', 'aria-label': 'Handshake runs' }, ...buttons),
    el(
      'p',
      { class: 'wire-note' },
      'A live run draws RND.IFD, K.IFD, RND.IC and K.IC from ',
      el('code', { class: 'value', text: 'crypto.getRandomValues' }),
      ', so no two runs produce the same cryptogram. The tamper buttons change one byte of ' +
        'the reader’s message after it is built and before the chip sees it.'
    )
  );
}

function renderModeNote(mode: Mode): HTMLElement {
  const notes: Record<Mode, string> = {
    'worked-example':
      'Running with the nonces and keying material ICAO Doc 9303 Part 11 Appendix D.3 ' +
      'prints, so every value below is the appendix’s own and can be checked against it.',
    live:
      'Running with fresh randomness from the browser. The structure is identical to the ' +
      'worked example; only the random values differ.',
    'tampered-cryptogram':
      'One byte of E_IFD was flipped in transit. The checksum no longer covers the ' +
      'cryptogram that arrived, so the chip stops before it decrypts anything.',
    'tampered-checksum':
      'One byte of M_IFD was flipped in transit. The cryptogram is intact but the checksum ' +
      'does not match it.',
    replay:
      'Replaying a recorded message against a chip that has since issued a new challenge.',
  };
  return el('p', { class: 'scope-note', id: 'mode-note', text: notes[mode] });
}

/* ── The three columns ────────────────────────────────────────────────────── */

function renderColumns(handshake: Handshake): HTMLElement {
  const { challenge, reader, chip } = handshake;

  const readerColumn = el(
    'div',
    { class: 'party', id: 'party-reader' },
    el('span', { class: 'party-label', text: 'Reader (the inspection system)' }),
    field('Knows', el('span', { text: 'the printed data, so both document keys' })),
    field('K_Enc', hex(toHex(handshake.keys.enc.key), 4)),
    field('K_MAC', hex(toHex(handshake.keys.mac.key), 4)),
    field('RND.IFD', hex(toHex(reader.rndIfd), 4), 'its own 8-byte nonce'),
    field('K.IFD', hex(toHex(reader.kIfd), 4), 'its 16 bytes of keying material'),
    field('S', hex(toHex(reader.s), 8), 'RND.IFD ‖ RND.IC ‖ K.IFD, encrypted to make E_IFD')
  );

  const chipColumn = el(
    'div',
    { class: 'party', id: 'party-chip' },
    el('span', { class: 'party-label', text: 'Chip (the contactless IC)' }),
    field('Knows', el('span', { text: 'the same two keys, stored at personalisation' })),
    field('RND.IC', hex(toHex(challenge.rndIc), 4), 'its challenge, sent in the clear'),
    ...(chip.accepted
      ? [
          field('K.IC', hex(toHex(chip.kIc), 4), 'its 16 bytes of keying material'),
          field('R', hex(toHex(chip.r), 8), 'RND.IC ‖ RND.IFD ‖ K.IC'),
        ]
      : [
          field(
            'Refused',
            el('span', { text: 'no keying material generated, nothing decrypted' }),
            'the chip never got as far as choosing K.IC'
          ),
        ])
  );

  /**
   * The eavesdropper's column.
   *
   * Everything here is a value that genuinely crossed the air: the chip's
   * challenge, which is sent in the clear, and the two cryptograms with their
   * checksums. No key, no keying material, no printed data — which the claims
   * suite asserts by searching this subtree for those values.
   */
  const eavesdropperRows: HTMLElement[] = [
    field('RND.IC', hex(toHex(challenge.rndIc), 4), 'the chip sends its challenge unencrypted'),
    field('E_IFD', hex(toHex(reader.eIfd), 8), '32 bytes of ciphertext'),
    field('M_IFD', hex(toHex(reader.mIfd), 4), 'its 8-byte retail MAC'),
  ];
  if (chip.accepted) {
    eavesdropperRows.push(field('E_IC', hex(toHex(chip.eIc), 8)));
    eavesdropperRows.push(field('M_IC', hex(toHex(chip.mIc), 4)));
  }

  const eavesdropperColumn = el(
    'div',
    { class: 'party party-eavesdropper', id: 'party-eavesdropper' },
    el('span', { class: 'party-label', text: 'Eavesdropper (what crossed the air)' }),
    field('Knows', el('span', { text: 'no key, no nonce of its own, nothing about the holder' })),
    ...eavesdropperRows,
    el(
      'p',
      { class: 'wire-note', id: 'eavesdropper-note' },
      'That is the whole recording. It is also exactly what the search in exhibit 5 is ' +
        'given — and it is enough, because M_IFD is a checksum under a key made of printed ' +
        'data.'
    )
  );

  return el(
    'div',
    { class: 'three-up', id: 'handshake-columns' },
    readerColumn,
    chipColumn,
    eavesdropperColumn
  );
}

/* ── Verdicts ─────────────────────────────────────────────────────────────── */

function renderVerdicts(handshake: Handshake, mode: Mode): HTMLElement {
  const nodes: HTMLElement[] = [];
  const { chip, readerVerdict } = handshake;

  if (!chip.accepted) {
    nodes.push(
      verdict(
        'fail',
        chipRefusalHeadline(chip),
        el('span', { class: 'verdict-body', text: chip.detail }),
        'chip-verdict'
      )
    );
    nodes.push(
      el(
        'p',
        { class: 'wire-note' },
        'No session keys appear anywhere on this page in this state, because none were ' +
          'derived. That is what failing closed means here: there is no partial result to ' +
          'show.'
      )
    );
  } else {
    nodes.push(
      verdict(
        'pass',
        'The chip accepted: checksum verified AND its own nonce came back',
        el('span', { class: 'verdict-body' },
          'Both conditions, every time. A chip that checked only the checksum would accept a ' +
            'replay of a recorded message — the checksum would still be perfectly valid.'
        ),
        'chip-verdict'
      )
    );
    if (readerVerdict?.accepted) {
      nodes.push(
        verdict(
          'pass',
          'The reader accepted: checksum verified AND its own nonce came back',
          el('span', { class: 'verdict-body', text: 'Mutual authentication complete.' }),
          'reader-verdict'
        )
      );
    } else if (readerVerdict) {
      nodes.push(
        verdict(
          'fail',
          'The reader refused the chip’s reply',
          el('span', { class: 'verdict-body', text: readerVerdict.detail }),
          'reader-verdict'
        )
      );
    }
  }

  if (mode === 'tampered-cryptogram' || mode === 'tampered-checksum') {
    nodes.push(
      el(
        'div',
        { class: 'callout callout-caveat' },
        el('span', { class: 'callout-title', text: 'What this does and does not show' }),
        el(
          'p',
          {},
          'The checksum works. A single flipped byte is caught, and the chip refuses without ' +
            'leaking whether the cryptogram would have decrypted correctly. What it does not ' +
            'show is anything about an attacker who does not tamper at all — one who simply ' +
            'listens. That attacker is exhibit 5, and the protocol has no answer to it.'
        )
      )
    );
  }

  return el('div', { id: 'handshake-verdicts' }, ...nodes);
}

function chipRefusalHeadline(rejection: Rejection): string {
  switch (rejection.reason) {
    case 'mac-mismatch':
      return 'The chip refused: the checksum did not match';
    case 'nonce-mismatch':
      return 'The chip refused: the checksum was valid but the nonce was not its own';
    case 'length':
      return 'The chip refused: the message was the wrong length';
  }
}

/* ── Appendix D comparison ────────────────────────────────────────────────── */

function renderAppendixComparison(handshake: Handshake): HTMLElement {
  if (!handshake.chip.accepted) {
    return el('div', { id: 'appendix-comparison' });
  }
  const chip = handshake.chip;
  const checks: { label: string; got: string; want: string }[] = [
    { label: 'E_IFD', got: toHex(handshake.reader.eIfd), want: ICAO_APPENDIX_D.eIfd },
    { label: 'M_IFD', got: toHex(handshake.reader.mIfd), want: ICAO_APPENDIX_D.mIfd },
    { label: 'E_IC', got: toHex(chip.eIc), want: ICAO_APPENDIX_D.eIc },
    { label: 'M_IC', got: toHex(chip.mIc), want: ICAO_APPENDIX_D.mIc },
    { label: 'Session seed', got: toHex(chip.session.seed), want: ICAO_APPENDIX_D.sessionSeed },
    { label: 'KS_Enc', got: toHex(chip.session.keys.enc.key), want: ICAO_APPENDIX_D.ksEnc },
    { label: 'KS_MAC', got: toHex(chip.session.keys.mac.key), want: ICAO_APPENDIX_D.ksMac },
    {
      label: 'Send sequence counter',
      got: toHex(chip.session.sendSequenceCounter),
      want: ICAO_APPENDIX_D.sendSequenceCounter,
    },
  ];
  const allMatch = checks.every((c) => c.got === c.want);

  return el(
    'div',
    { class: 'card', id: 'appendix-comparison' },
    el('h3', { text: 'Every value against Appendix D.3' }),
    table(
      'Computed here, against ICAO Doc 9303 Part 11 Appendix D.3',
      [{ text: 'Value' }, { text: 'Computed in this browser' }, { text: 'Appendix D.3 prints' }, { text: 'Agree?' }],
      checks.map((c) => [
        c.label,
        el('code', { class: 'hex', 'data-computed': c.label, text: c.got }),
        el('code', { class: 'hex', 'data-published': c.label, text: c.want }),
        c.got === c.want ? 'yes' : 'NO',
      ])
    ),
    verdict(
      allMatch ? 'pass' : 'fail',
      allMatch
        ? 'The whole handshake reproduces Appendix D.3, value for value'
        : 'A value does NOT match Appendix D.3',
      el('span', { class: 'verdict-body' },
        allMatch
          ? 'Eight values, including both cryptograms, both checksums, both session keys and ' +
            'the send sequence counter.'
          : 'Treat the rest of this page as suspect until this is resolved.'
      ),
      'appendix-verdict'
    )
  );
}

/* ── The session that results ─────────────────────────────────────────────── */

function renderSession(handshake: Handshake): HTMLElement {
  if (!handshake.chip.accepted) return el('div');
  const session = handshake.chip.session;
  return el(
    'div',
    { class: 'card', id: 'session-card' },
    el('h3', { text: 'The session keys both sides now hold' }),
    el(
      'p',
      {},
      'Each side contributed sixteen bytes of keying material. XOR them, and run the same ' +
        'derivation again with counters 1 and 2 — so the session keys come from fresh ' +
        'randomness, not from the printed data.'
    ),
    field('K.IFD ⊕ K.IC', hex(toHex(session.seed), 4), 'the new key seed'),
    field('KS_Enc', hex(toHex(session.keys.enc.key), 4)),
    field('KS_MAC', hex(toHex(session.keys.mac.key), 4)),
    field(
      'Send sequence counter',
      hex(toHex(session.sendSequenceCounter), 4),
      'the last four bytes of RND.IC, then the last four of RND.IFD'
    ),
    caveat(
      'And here is the catch',
      el(
        'p',
        {},
        'These session keys are strong: 128 bits of fresh random material, independent of ' +
          'anything printed. But they were agreed under K_Enc and K_MAC — and whoever ' +
          'recorded the exchange can recover those from the printed data, decrypt E_IFD and ' +
          'E_IC, read K.IFD and K.IC straight out of the plaintext, and XOR them. Fresh ' +
          'randomness does not help when the channel protecting it is the weak part.'
      )
    )
  );
}

function renderSources(): HTMLElement {
  return disclosure(
    'The protocol as the standard states it',
    quote(
      'Authentication and Key Establishment is provided by a three-pass challenge-response ' +
        'protocol according to [ISO/IEC 11770-2] Key Establishment Mechanism 6 using 3DES ' +
        '[FIPS 46-3] as block cipher. A cryptographic checksum according to [ISO/IEC 9797-1] ' +
        'MAC Algorithm 3 is calculated over and appended to the ciphertexts. [...] Exchanged ' +
        'nonces MUST be of size 8 bytes, exchanged keying material MUST be of size 16 bytes.',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Section 4.3.1'
    ),
    quote(
      'Two key 3DES in CBC mode with zero IV (i.e. 0x00 00 00 00 00 00 00 00) according to ' +
        '[ISO/IEC 11568-2] SHALL be used for computation of EIFD and EIC. Padding for the ' +
        'input data MUST NOT be used when performing the EXTERNAL AUTHENTICATE command.',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Section 4.3.3.1'
    ),
    quote(
      'The cryptographic checksums MIFD and MIC SHALL be calculated using [ISO/IEC 9797-1] ' +
        'MAC algorithm 3 with block cipher DES, zero IV (8 bytes), and [ISO/IEC 9797-1] ' +
        'padding method 2. The MAC length MUST be 8 bytes.',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Section 4.3.3.2'
    ),
    el(
      'p',
      {},
      'One difference from the 2005 analysis worth noting: the figure in Juels, Molnar and ' +
        'Wagner shows 64 bits of keying material from each side. The standard specifies 16 ' +
        'bytes and its worked example uses 16, so that is what runs here.'
    ),
    caveat(
      'Not implemented on this page',
      el(
        'p',
        {},
        'Secure messaging — the protected commands that follow authentication — is specified ' +
          'in Section 9.8 and Appendix D.4 and is not built here. Neither are Active ' +
          'Authentication, Chip Authentication, Passive Authentication or the ' +
          'document-signing PKI. This exhibit stops where the session keys are agreed.'
      )
    )
  );
}
