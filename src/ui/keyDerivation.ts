/**
 * Exhibit 2 — From Print to Keys.
 *
 * The derivation, step by step: the ASCII of MRZ_information, its SHA-1, the
 * 16 bytes that become the key seed, and the two keys the seed produces under
 * counters 1 and 2. Each key is shown twice — as the raw hash bytes and after
 * the parity adjustment — because the standard calls that adjustment OPTIONAL
 * and it changes the printed key without changing a single ciphertext. That is
 * a fact worth seeing rather than being told.
 *
 * Specified in ICAO Doc 9303 Part 11 Sections 4.3.2, 9.7.1, 9.7.1.1 and 9.7.2.
 */
import { toHex } from '../bac/bytes';
import { hasOddParity, type DerivedKey } from '../bac/kdf';
import { ICAO_APPENDIX_D } from '../bac/vectors';
import { append, clear, disclosure, el, field, hex, quote, table, verdict } from './dom';
import { currentDocument, currentKeys, isSpecimen, onDocumentChange } from './state';

export function renderKeyDerivation(panel: HTMLElement): void {
  const rerender = (): void => {
    clear(panel);
    append(panel, ...build());
  };
  rerender();
  // See printedData.ts: re-render even while hidden, or this panel shows the
  // previous document's keys when its tab is next activated.
  onDocumentChange(() => rerender());
}

function build(): HTMLElement[] {
  const derived = currentKeys();
  const data = currentDocument();

  return [
    el(
      'div',
      { class: 'panel-intro' },
      el('h2', { text: 'One hash turns printing into a pair of keys' }),
      el(
        'p',
        { class: 'lede' },
        'A key derivation function takes something a person can read and produces something ' +
          'a cipher can use. Here it is about as simple as a derivation gets: hash the ' +
          'twenty-four printed characters with SHA-1, keep the first sixteen bytes, and hash ' +
          'those again — once with the number 1 appended, once with 2 — to get an encryption ' +
          'key and a MAC key.'
      ),
      el(
        'p',
        {},
        'There is no salt, no iteration count and no work factor. Each key is a fixed ' +
          'function of the printed data, so the same passport derives the same two keys for ' +
          'its whole ten-year life, and anyone who can guess the printing can compute them.'
      )
    ),
    renderStep1(derived),
    renderStep2(derived),
    renderStep3(derived),
    renderParityPanel(derived.keys.enc),
    isSpecimen() ? renderSpecimenCheck(derived) : renderNonSpecimenNote(data),
    renderSources(),
  ];
}

/* ── Step 1: the ASCII ────────────────────────────────────────────────────── */

function renderStep1(derived: ReturnType<typeof currentKeys>): HTMLElement {
  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'Step 1 — the printed characters, as bytes' }),
    field('MRZ_information', el('code', { class: 'value', id: 'kd-mrz-info', text: derived.info.value })),
    field('As ASCII', hex(toHex(derived.ascii), 4), `${derived.ascii.length} bytes`),
    el(
      'p',
      { class: 'wire-note' },
      'Plain ASCII, exactly as typed. No normalisation, no encoding choice to get wrong — ' +
        'the MRZ alphabet is digits, A to Z and the filler, and all of them are one byte.'
    )
  );
}

/* ── Step 2: SHA-1 and the seed ───────────────────────────────────────────── */

function renderStep2(derived: ReturnType<typeof currentKeys>): HTMLElement {
  const full = toHex(derived.hash);
  const seed = toHex(derived.keys.kSeed);
  const discarded = full.slice(32);

  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'Step 2 — SHA-1, and the sixteen bytes that survive' }),
    field('SHA-1(MRZ_information)', hex(full, 4), '20 bytes'),
    field('K_seed', el('span', {}, hex(seed, 4)), 'the most significant 16 bytes'),
    field('Discarded', el('span', {}, hex(discarded, 4)), 'the last 4 bytes are not used'),
    el(
      'p',
      { class: 'wire-note' },
      'A two-key Triple-DES key is 16 bytes and SHA-1 produces 20, so four bytes are simply ' +
        'dropped. Keeping all twenty would give a key of the wrong size and a different ' +
        'value entirely.'
    ),
    quote(
      'The most significant 16 bytes of the SHA-1 hash of this "MRZ_information" are used as ' +
        'key seed to derive the Document Basic Access Keys using the key derivation ' +
        'mechanism described in Section 9.7.2.',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Section 4.3.2'
    )
  );
}

/* ── Step 3: the two derivations ──────────────────────────────────────────── */

function renderStep3(derived: ReturnType<typeof currentKeys>): HTMLElement {
  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'Step 3 — the same function twice, with a different counter' }),
    el(
      'p',
      {},
      'KDF(K, c) is just SHA-1 of the seed with a 32-bit big-endian counter appended. ' +
        'Counter 1 gives the encryption key, counter 2 the MAC key. Changing the counter’s ' +
        'byte order would produce two keys that are perfectly valid and completely wrong.'
    ),
    derivationCard('K_Enc', derived.keys.enc, 'the cipher key for the challenge cryptograms'),
    derivationCard('K_MAC', derived.keys.mac, 'the key for the checksum over them'),
    quote(
      'The key derivation function KDF(K,c), is defined as follows [...] keydata = H(K || c) ' +
        '[...] A 32-bit, big-endian integer counter c (REQUIRED).',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Section 9.7.1'
    )
  );
}

function derivationCard(name: string, key: DerivedKey, role: string): HTMLElement {
  const id = name.toLowerCase().replace('_', '-');
  return el(
    'div',
    { class: 'card', 'data-key': name },
    el('h4', {}, name, ' — ', role),
    field(
      `K_seed ‖ ${String(key.counter).padStart(8, '0')}`,
      hex(toHex(key.hashInput), 4),
      'the 20 bytes that go into the hash'
    ),
    field('SHA-1 of that', hex(toHex(key.hash), 4)),
    field(
      'First 16 bytes',
      el('span', { 'data-field': `${id}-before-parity` }, hex(toHex(key.beforeParity), 4)),
      'keydataA ‖ keydataB, before the parity adjustment'
    ),
    field(
      `${name} (parity adjusted)`,
      el('strong', { 'data-field': id }, hex(toHex(key.key), 4)),
      'the key the standard prints'
    )
  );
}

/* ── The parity adjustment ────────────────────────────────────────────────── */

function renderParityPanel(key: DerivedKey): HTMLElement {
  /**
   * The one genuinely surprising step, so it gets its own card.
   *
   * Showing the bit-level difference matters because the two keys are
   * cryptographically identical: a reader who is told "parity bits are
   * adjusted" has no way to know whether that affects the ciphertext. Here the
   * answer is on screen — the bytes differ, and exhibit 3's cryptograms are
   * the same either way.
   */
  const rows: (readonly (HTMLElement | string)[])[] = [];
  for (let i = 0; i < key.beforeParity.length; i++) {
    const before = key.beforeParity[i];
    const after = key.key[i];
    const changed = before !== after;
    rows.push([
      String(i + 1),
      el('code', { class: 'value', text: before.toString(2).padStart(8, '0') }),
      el('code', { class: 'value', text: after.toString(2).padStart(8, '0') }),
      changed ? 'flipped' : 'unchanged',
    ]);
  }

  return el(
    'div',
    { class: 'card', id: 'parity-card' },
    el('h3', { text: 'The parity bits — and why they change the key but not the ciphertext' }),
    el(
      'p',
      {},
      'A DES key byte carries seven key bits and one parity bit. The standard adjusts each ' +
        'byte’s low bit so the byte has odd parity, and then marks that step OPTIONAL — ' +
        'because DES’s key schedule throws every parity bit away before it does anything. ' +
        'PC-1 selects 56 of the 64 bits and never names bit 8, 16, 24 and so on.'
    ),
    el(
      'p',
      {},
      'So the adjustment changes the key you would write down and cannot change a single ' +
        'byte of output. Both of those are worth knowing: the first is why the keys here ' +
        'match the standard’s printed values, the second is why an implementation that ' +
        'skipped the step would still interoperate.'
    ),
    verdict(
      hasOddParity(key.key) ? 'pass' : 'fail',
      hasOddParity(key.key)
        ? 'Every byte of K_Enc now has odd parity'
        : 'Parity adjustment did not take',
      el('span', { class: 'verdict-body' },
        'Compare the two columns below: where a byte already had odd parity nothing moved.'
      ),
      'parity-verdict'
    ),
    table(
      'K_Enc byte by byte, before and after the parity adjustment',
      [
        { text: 'Byte', numeric: true },
        { text: 'From the hash' },
        { text: 'Parity adjusted' },
        { text: 'Low bit' },
      ],
      rows
    ),
    quote(
      'Use octets 1 to 8 of keydata to form keydataA and octets 9 to 16 of keydata to form ' +
        'keydataB; additional octets are not used. Adjust the parity bits of keydataA and ' +
        'keydataB to form correct DES keys (OPTIONAL).',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Section 9.7.1.1'
    )
  );
}

/* ── Agreement with the standard ──────────────────────────────────────────── */

function renderSpecimenCheck(derived: ReturnType<typeof currentKeys>): HTMLElement {
  /**
   * While the specimen is loaded, the page states its agreement with Appendix
   * D as a comparison rather than a claim: both values side by side, and a
   * verdict computed from whether they are equal.
   */
  const checks: { label: string; got: string; want: string }[] = [
    { label: 'MRZ_information', got: derived.info.value, want: ICAO_APPENDIX_D.mrzInformation },
    { label: 'SHA-1', got: toHex(derived.hash), want: ICAO_APPENDIX_D.mrzInformationSha1 },
    { label: 'K_seed', got: toHex(derived.keys.kSeed), want: ICAO_APPENDIX_D.kSeed },
    { label: 'K_Enc', got: toHex(derived.keys.enc.key), want: ICAO_APPENDIX_D.kEnc },
    { label: 'K_MAC', got: toHex(derived.keys.mac.key), want: ICAO_APPENDIX_D.kMac },
  ];
  const allMatch = checks.every((c) => c.got === c.want);

  return el(
    'div',
    { class: 'card', id: 'specimen-agreement' },
    el('h3', { text: 'Against the standard’s own worked example' }),
    el(
      'p',
      {},
      'ICAO works this exact specimen through in Appendix D. Both columns below are on this ' +
        'page: the left is what this browser just computed, the right is what the appendix ' +
        'prints. Nothing is hardcoded to agree — change the document above and this card ' +
        'disappears, because the appendix has nothing to say about a document it never ' +
        'worked through.'
    ),
    table(
      'Computed here, against ICAO Doc 9303 Part 11 Appendix D',
      [{ text: 'Value' }, { text: 'Computed in this browser' }, { text: 'Appendix D prints' }, { text: 'Agree?' }],
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
        ? 'Every value matches ICAO Doc 9303 Part 11 Appendix D'
        : 'A value does NOT match the published worked example',
      el('span', { class: 'verdict-body' },
        allMatch
          ? 'Eighth Edition (2021), Appendix D.1 and D.2. The appendix is informative; it is ' +
            'the standard’s own statement of what its normative sections mean.'
          : 'Treat every other number on this page as suspect until this is resolved.'
      ),
      'specimen-verdict'
    )
  );
}

function renderNonSpecimenNote(data: ReturnType<typeof currentDocument>): HTMLElement {
  return el(
    'div',
    { class: 'card', id: 'specimen-agreement' },
    el('h3', { text: 'A document the standard never worked through' }),
    el(
      'p',
      {},
      'The keys above are for ',
      el('code', { class: 'value', text: data.documentNumber }),
      ', which is not the specimen ICAO works through, so there is no published value to ' +
        'compare them against. The derivation is the same one the appendix pins — reset to ' +
        'the specimen in exhibit 1 to see the comparison.'
    ),
    verdict(
      'info',
      'No published worked example for this document',
      el('span', { class: 'verdict-body' },
        'The repository’s test suite checks the specimen and a second independently ' +
          'computed vector on every run; this panel only claims agreement where there is ' +
          'something to agree with.'
      ),
      'no-reference-verdict'
    )
  );
}

function renderSources(): HTMLElement {
  return disclosure(
    'What this derivation does not have',
    el(
      'p',
      {},
      'Compare it with how a password is turned into a key today. A modern password-based ' +
        'derivation adds a random salt, so two documents with the same printed data would ' +
        'still get different keys, and a deliberately large work factor, so each guess costs ' +
        'an attacker real time. This has neither: one SHA-1 call, no salt, no iterations.'
    ),
    el(
      'p',
      {},
      'That is not an oversight in the standard so much as a consequence of what it had to ' +
        'run on — a contactless chip in 2004, with a symmetric cipher and a few milliseconds ' +
        'of budget. The cost shows up in exhibit 5: a candidate costs two SHA-1 compressions ' +
        'and seven DES block operations, which is why a laptop can try tens of thousands a ' +
        'second.'
    ),
    el(
      'p',
      {},
      'A salt would not have helped as much as it sounds, either. The salt would have to be ' +
        'printed on the document too, where the eavesdropper who already has the number can ' +
        'read it.'
    )
  );
}
