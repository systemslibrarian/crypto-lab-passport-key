/**
 * Exhibit 6 — What Replaced It.
 *
 * One panel, no implementation. PACE is specified in the same part of the same
 * document as Basic Access Control, and ICAO says in as many words why it
 * exists. Saying that, citing it, and linking the labs that do build a
 * password-authenticated key exchange is more honest than a half-built PACE
 * would be.
 *
 * The brief puts PACE out of scope and the page says so. Nothing here claims
 * to run it.
 */
import { append, caveat, clear, el, quote, table } from './dom';

export function renderReplacement(panel: HTMLElement): void {
  clear(panel);
  append(panel, ...build());
}

function build(): HTMLElement[] {
  return [
    el(
      'div',
      { class: 'panel-intro' },
      el('h2', { text: 'The fix was to stop deriving the key from the password' }),
      el(
        'p',
        { class: 'lede' },
        'Basic Access Control’s weakness is not a bug in its cipher or its checksum — ' +
          'both do exactly what they are specified to do. The weakness is structural: the ' +
          'session keys are agreed under a key derived from low-entropy printed data, so a ' +
          'recording of the exchange is a test oracle for that data. No amount of care in the ' +
          'protocol can undo that.'
      ),
      el(
        'p',
        {},
        'The replacement, specified in the same part of Doc 9303, is a ' +
          'password-authenticated key exchange: Password Authenticated Connection ' +
          'Establishment, PACE. The printed data still acts as the password, but it is used ' +
          'to seed an asymmetric key agreement rather than to derive the session key ' +
          'directly — so a recording no longer lets an eavesdropper test a guess offline.'
      )
    ),
    quote(
      'There is no straightforward way to strengthen Basic Access Control as its limitations ' +
        'are inherent to the design of the protocol based on symmetric ("secret key") ' +
        'cryptography. A cryptographically strong access control mechanism must ' +
        '(additionally) use asymmetric ("public key") cryptography. Password Authenticated ' +
        'Connection Establishment (PACE) was designed to overcome this problem. It employs ' +
        'asymmetric cryptography to establish session keys, whose strength is independent of ' +
        'the entropy of the used password.',
      'ICAO Doc 9303 Part 11, Eighth Edition (2021), Appendix A'
    ),
    el(
      'div',
      { class: 'card' },
      el('h3', { text: 'The one sentence that matters' }),
      el(
        'p',
        {},
        el('strong', { text: 'Session keys whose strength is independent of the entropy of the password.' }),
        ' That is the property Basic Access Control does not have and cannot be patched into ' +
          'having. Appendix A gives the figure: with a 256-bit curve and AES-128, ' +
          '"the session keys have 128 Bit entropy" — regardless of how guessable the printed ' +
          'data is.'
      ),
      table(
        'What changes between the two mechanisms, as Doc 9303 Part 11 specifies them',
        [{ text: '' }, { text: 'Basic Access Control' }, { text: 'PACE' }],
        [
          ['Specified in', 'Part 11, Section 4.3', 'Part 11, Section 4.4'],
          ['Printed data is', 'hashed directly into the access keys', 'the password seeding a key agreement'],
          ['Cryptography', 'symmetric only: SHA-1, two-key 3DES, retail MAC', 'additionally asymmetric: Diffie-Hellman or ECDH'],
          [
            'Session key strength',
            'bounded by how guessable the printed data is',
            'independent of it — 128 bits for a 256-bit curve with AES-128',
          ],
          [
            'A recorded exchange',
            'is an offline test oracle for the printed data',
            'is not: a guess cannot be tested without talking to the chip',
          ],
          ['Guessing becomes', 'an offline search, as in exhibit 5', 'an online attempt, limited by the chip'],
        ]
      )
    ),
    caveat(
      'Named here, not built here',
      el(
        'p',
        {},
        'This lab does not implement PACE. It implements Basic Access Control, which is the ' +
          'mechanism whose failure it exists to show, and pointing at the replacement is not ' +
          'the same as demonstrating it. The labs below do build password-authenticated key ' +
          'exchanges, with the generic and integrated mappings, the group arithmetic and the ' +
          'attacks that go with them.'
      ),
      el(
        'p',
        {},
        'Nor does this lab say which mechanism any particular country’s current documents ' +
          'use. That is a factual question about deployments, it changes, and answering it ' +
          'from anything but a current primary source would be guessing.'
      )
    ),
    el(
      'div',
      { class: 'card' },
      el('h3', { text: 'Where to see a password-authenticated key exchange actually run' }),
      el(
        'ul',
        { role: 'list' },
        el(
          'li',
          { role: 'listitem' },
          el('a', { href: 'https://systemslibrarian.github.io/crypto-lab-pake-gate/', target: '_blank', rel: 'noopener noreferrer' }, 'PAKE Gate'),
          ' — SRP-6a, J-PAKE, CPace and Dragonfly side by side, with the point this lab ' +
            'makes by its absence: a passive transcript gives an observer no direct offline ' +
            'password test.'
        ),
        el(
          'li',
          { role: 'listitem' },
          el('a', { href: 'https://systemslibrarian.github.io/crypto-lab-spake-gate/', target: '_blank', rel: 'noopener noreferrer' }, 'SPAKE Gate'),
          ' — one PAKE in detail, including what an eavesdropper can and cannot grind.'
        ),
        el(
          'li',
          { role: 'listitem' },
          el('a', { href: 'https://systemslibrarian.github.io/crypto-lab-opaque-gate/', target: '_blank', rel: 'noopener noreferrer' }, 'OPAQUE Gate'),
          ' — an augmented PAKE (RFC 9807) where even the server never holds the password.'
        ),
        el(
          'li',
          { role: 'listitem' },
          el('a', { href: 'https://systemslibrarian.github.io/crypto-lab-feistel-forge/', target: '_blank', rel: 'noopener noreferrer' }, 'Feistel Forge'),
          ' — DES itself, round by round, including the meet-in-the-middle limit on two-key ' +
            'Triple-DES that this lab’s cipher inherits.'
        ),
        el(
          'li',
          { role: 'listitem' },
          el('a', { href: 'https://systemslibrarian.github.io/crypto-lab-bcrypt-forge/', target: '_blank', rel: 'noopener noreferrer' }, 'bcrypt Forge'),
          ' — the other half of the answer: when a key must come from something guessable, ' +
            'a salt and a deliberately large work factor are what make each guess expensive. ' +
            'Basic Access Control has neither.'
        )
      )
    ),
  ];
}
