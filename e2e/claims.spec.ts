import { expect, test, type Page } from '@playwright/test';
import { boot } from './gate';

/**
 * The claims suite: what this lab's interface SAYS, as opposed to what it is
 * shaped like. §4.1b of audits/_MASTER-TEMPLATE.md.
 *
 * Kept out of `gate.ts`'s `boot()` deliberately. An assertion in a shared
 * setup helper fails every test that imports it, under a name that has nothing
 * to do with what changed: crypto-lab-mceliece-gate lost three days of
 * corrected security claims to exactly that on 2026-09-26, with the red step
 * named "Accessibility gate". Here, a failure says "claims".
 *
 * ## The rule that makes these worth anything
 *
 * A test that re-derives the same expression the source uses will happily
 * agree with a bug. So every assertion below is one of three shapes:
 *
 *  - a **cross-check** — two surfaces on the page that must agree (the marked
 *    MRZ characters against the MRZ_information string; a factor column
 *    against the product it multiplies to);
 *  - an **independent re-derivation** — the claim recomputed from the page's
 *    own raw inputs by a DIFFERENT route than the source takes (the check-digit
 *    sum recomputed in the test from the printed characters; the bit count
 *    recomputed from the displayed possibilities with `Math.log2`);
 *  - a **published value** — compared against ICAO Doc 9303 Part 11's own
 *    printed numbers, which no amount of internal consistency can fake.
 *
 * Internal consistency alone is not enough: a page can be consistently wrong,
 * and a mutation that corrupts the derivation is reported consistently
 * everywhere. The published values are what close that gap here.
 */

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Parse a space-grouped hex readout back to a bare hex string. */
function bare(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase();
}

/** The check digit of an MRZ field, recomputed in the TEST from the rule. */
function checkDigitIndependently(field: string): number {
  // Doc 9303 Part 3 Section 4.9: weights 7,3,1 repeating; digits as
  // themselves, A-Z as 10-35, '<' as 0; the sum modulo 10. Written out here
  // rather than imported, so a mutation to src/bac/mrz.ts cannot agree with
  // its own bug.
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const c = field[i];
    const value = c === '<' ? 0 : c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 55;
    sum += value * weights[i % 3];
  }
  return sum % 10;
}

async function openExhibit(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

/* ── Exhibit 1: the printed data ──────────────────────────────────────────── */

test.describe('exhibit 1 — the printed data', () => {
  test('arrives holding the ICAO specimen from Appendix D', async ({ page }) => {
    await boot(page, 'dark');
    // The document the whole lab is a story about. A claim, so it lives here
    // and not in boot(), which asserts only that the fields are well formed.
    await expect(page.locator('#doc-number')).toHaveValue('L898902C<');
    await expect(page.locator('#doc-birth')).toHaveValue('690806');
    await expect(page.locator('#doc-expiry')).toHaveValue('940623');
    await expect(page.locator('#mrz-information')).toHaveText('L898902C<369080619406236');
  });

  test('every displayed check digit is what the rule independently gives', async ({ page }) => {
    await boot(page, 'dark');
    // An independent re-derivation: the test computes each digit from the
    // printed field by the Part 3 rule written out above, and compares against
    // what the page displays. A mutation to the weights fails here.
    for (const [label, field] of [
      ['Document number', 'L898902C<'],
      ['Date of birth', '690806'],
      ['Date of expiry', '940623'],
    ] as const) {
      const shown = await page
        .locator(`.cd-result[data-field="${label}"]`)
        .textContent();
      expect(Number(shown), `${label} check digit`).toBe(checkDigitIndependently(field));
    }
  });

  test('each check-digit column sums to the total the page prints', async ({ page }) => {
    await boot(page, 'dark');
    // Parts-sum-to-whole, read off the rendered table: a learner who adds the
    // Product column by hand must reach the printed sum.
    const working = page.locator('.cd-working').first();
    const products = await working.locator('tbody tr td:nth-child(4)').allTextContents();
    const printedSum = Number(await working.locator('.cd-sum').textContent());
    const rowProducts = products.slice(0, -1).map(Number);
    expect(rowProducts.reduce((a, b) => a + b, 0)).toBe(printedSum);
    // And the digit is that sum modulo 10.
    const digit = Number(await working.locator('.cd-result').textContent());
    expect(printedSum % 10).toBe(digit);
  });

  test('the marked characters are exactly MRZ_information', async ({ page }) => {
    await boot(page, 'dark');
    // A cross-check between two surfaces: the highlight in the printed zone
    // and the string the derivation consumes. If the layout table and the
    // derivation ever disagree, the page is highlighting the wrong characters
    // while deriving the right key — which would look perfectly fine.
    const marked = (await page.locator('#mrz-lower .mrz-hashed').allTextContents()).join('');
    const info = await page.locator('#mrz-information').textContent();
    expect(marked).toBe(info);
  });

  test('the printed line carries a composite check digit that verifies itself', async ({ page }) => {
    await boot(page, 'dark');
    // Recomputed in the test over positions 1-10, 14-20 and 22-43, which is
    // what Doc 9303 Part 4 specifies for TD3 — so a layout slip that shifted a
    // field would break this even though every individual field still looked
    // right.
    const line = (await page.locator('#mrz-lower').textContent()) ?? '';
    expect(line).toHaveLength(44);
    const covered = line.slice(0, 10) + line.slice(13, 20) + line.slice(21, 43);
    expect(Number(line[43])).toBe(checkDigitIndependently(covered));
  });

  test('a wrong date is refused by name, and the page says which field', async ({ page }) => {
    await boot(page, 'dark');
    await page.fill('#doc-birth', '901301');
    await page.getByRole('button', { name: 'Use this document' }).click();
    await expect(page.locator('#doc-birth')).toHaveAttribute('aria-invalid', 'true');
    // The page must name the ACTUAL cause, not just report failure — and the
    // message must be the one tied to THIS field, which is why it is addressed
    // by the id the input's aria-describedby points at rather than by position.
    await expect(page.locator('#doc-birth-error')).toContainText('no month 13');
    await expect(page.locator('#doc-birth')).toHaveAttribute(
      'aria-describedby',
      /doc-birth-error/
    );
  });

  test('an over-long document number is refused and the reason names the field width', async ({ page }) => {
    await boot(page, 'dark');
    await page.fill('#doc-number', 'ABCDEFGHIJ');
    await page.getByRole('button', { name: 'Use this document' }).click();
    await expect(page.locator('#doc-number')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#doc-number-error')).toContainText('10 characters');
    await expect(page.locator('#doc-number-error')).toContainText('optional-data');
  });

  test('the page says it wants specimen data, not a real document', async ({ page }) => {
    await boot(page, 'dark');
    // Invariant 2 is a promise the page makes in words; this is the test of
    // the words. The behaviour is tested by the absence of any storage call.
    await expect(page.locator('#panel-printed .scope-note')).toContainText('Specimen data only');
    await expect(page.locator('#panel-printed .scope-note')).toContainText(
      'Do not type a real passport'
    );
  });

  test('nothing about the document is persisted', async ({ page }) => {
    await boot(page, 'dark');
    await page.fill('#doc-number', 'ZZ9999999');
    await page.getByRole('button', { name: 'Use this document' }).click();
    await expect(page.locator('#mrz-information')).toContainText('ZZ9999999');
    // Invariant 2, as a measurement: the only key this lab writes is the
    // theme pin, and no document data may appear anywhere in storage.
    const storage = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) out[k] = localStorage.getItem(k) ?? '';
      }
      return { keys: Object.keys(out), json: JSON.stringify(out), session: sessionStorage.length };
    });
    expect(storage.keys).toEqual(['theme']);
    expect(storage.json).not.toContain('ZZ9999999');
    expect(storage.session).toBe(0);
    // And a reload returns to the specimen rather than the typed document.
    await page.reload();
    await expect(page.locator('#doc-number')).toHaveValue('L898902C<');
  });
});

/* ── Exhibit 2: the derivation ────────────────────────────────────────────── */

test.describe('exhibit 2 — from print to keys', () => {
  test("every key on screen matches ICAO Doc 9303 Part 11 Appendix D", async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /From Print to Keys/);
    // Published values. The page renders both its computed value and the
    // appendix's printed one; this asserts the PUBLISHED column is right (so
    // the comparison cannot be rigged by changing the reference) and that the
    // computed column equals it.
    const published: Record<string, string> = {
      'MRZ_information': 'L898902C<369080619406236',
      'SHA-1': '239AB9CB282DAF66231DC5A4DF6BFBAEDF477565',
      'K_seed': '239AB9CB282DAF66231DC5A4DF6BFBAE',
      'K_Enc': 'AB94FDECF2674FDFB9B391F85D7F76F2',
      'K_MAC': '7962D9ECE03D1ACD4C76089DCE131543',
    };
    for (const [label, want] of Object.entries(published)) {
      const shownPublished = await page.locator(`[data-published="${label}"]`).textContent();
      const shownComputed = await page.locator(`[data-computed="${label}"]`).textContent();
      expect(bare(shownPublished ?? ''), `${label} reference`).toBe(want.toUpperCase());
      expect(bare(shownComputed ?? ''), `${label} computed`).toBe(want.toUpperCase());
    }
    await expect(page.locator('#specimen-agreement .verdict-pass')).toBeVisible();
  });

  test('the parity adjustment changes the printed key bytes', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /From Print to Keys/);
    // Mutation 5's oracle, as a displayed claim. Appendix D.1 prints both
    // forms, and they differ — so a page that skipped the adjustment would
    // show the same string twice.
    const before = bare((await page.locator('[data-field="k-enc-before-parity"]').textContent()) ?? '');
    const after = bare((await page.locator('[data-field="k-enc"]').textContent()) ?? '');
    expect(before).toBe('AB94FCEDF2664EDFB9B291F85D7F77F2');
    expect(after).toBe('AB94FDECF2674FDFB9B391F85D7F76F2');
    expect(before).not.toBe(after);
    // And only the low bit of each byte moved — recomputed here, byte by byte.
    for (let i = 0; i < 16; i++) {
      const b = parseInt(before.slice(i * 2, i * 2 + 2), 16);
      const a = parseInt(after.slice(i * 2, i * 2 + 2), 16);
      expect(a & 0xfe, `byte ${i} keeps its seven key bits`).toBe(b & 0xfe);
    }
  });

  test('the parity table reports odd parity for every byte of the adjusted key', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /From Print to Keys/);
    // An independent re-derivation from what is on screen: read the binary
    // strings out of the table and count their bits.
    const rows = page.locator('#parity-card tbody tr');
    await expect(rows).toHaveCount(16);
    const adjusted = await rows.locator('td:nth-child(3) code').allTextContents();
    expect(adjusted).toHaveLength(16);
    for (const [i, bits] of adjusted.entries()) {
      const ones = bits.split('').filter((c) => c === '1').length;
      expect(ones % 2, `byte ${i + 1} must have odd parity`).toBe(1);
    }
    await expect(page.locator('#panel-keys .parity-verdict')).toHaveClass(/verdict-pass/);
  });

  test('the agreement card disappears for a document the standard never worked through', async ({ page }) => {
    await boot(page, 'dark');
    // Retirement with a reason: the page must not claim agreement with a
    // published example about a document that example never covered.
    await page.fill('#doc-number', 'AB1234567');
    await page.fill('#doc-birth', '851231');
    await page.fill('#doc-expiry', '300101');
    await page.getByRole('button', { name: 'Use this document' }).click();
    await openExhibit(page, /From Print to Keys/);
    await expect(page.locator('#specimen-agreement')).toContainText(
      'A document the standard never worked through'
    );
    await expect(page.locator('#specimen-agreement .verdict-pass')).toHaveCount(0);
    await expect(page.locator('#panel-keys .no-reference-verdict')).toBeVisible();
    // The second independently computed vector, as a published value: this
    // document's keys were derived with Python's hashlib and a from-scratch
    // DES before they were written into the test suite.
    await expect(page.locator('#kd-mrz-info')).toHaveText('AB1234567185123163001019');
  });

  test('a one-character change to the printed data changes both keys completely', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /From Print to Keys/);
    const firstEnc = bare((await page.locator('[data-field="k-enc"]').textContent()) ?? '');
    await openExhibit(page, /The Printed Data/);
    await page.fill('#doc-birth', '690807'); // one day later
    await page.getByRole('button', { name: 'Use this document' }).click();
    await openExhibit(page, /From Print to Keys/);
    const secondEnc = bare((await page.locator('[data-field="k-enc"]').textContent()) ?? '');
    expect(secondEnc).not.toBe(firstEnc);
    // Not merely different — different in most bytes, which is what a hash
    // gives and a weak derivation might not.
    let differing = 0;
    for (let i = 0; i < 32; i += 2) {
      if (firstEnc.slice(i, i + 2) !== secondEnc.slice(i, i + 2)) differing++;
    }
    expect(differing).toBeGreaterThan(10);
  });
});

/* ── Exhibit 3: the handshake ─────────────────────────────────────────────── */

test.describe('exhibit 3 — the handshake', () => {
  test("the worked example reproduces every value Appendix D.3 prints", async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run the standard’s example' }).click();
    await expect(page.locator('#appendix-comparison')).toBeVisible();
    const published: Record<string, string> = {
      'E_IFD': '72C29C2371CC9BDB65B779B8E8D37B29ECC154AA56A8799FAE2F498F76ED92F2',
      'M_IFD': '5F1448EEA8AD90A7',
      'E_IC': '46B9342A41396CD7386BF5803104D7CEDC122B9132139BAF2EEDC94EE178534F',
      'M_IC': '2F2D235D074D7449',
      'Session seed': '0036D272F5C350ACAC50C3F572D23600',
      'KS_Enc': '979EC13B1CBFE9DCD01AB0FED307EAE5',
      'KS_MAC': 'F1CB1F1FB5ADF208806B89DC579DC1F8',
      'Send sequence counter': '887022120C06C226',
    };
    for (const [label, want] of Object.entries(published)) {
      const ref = await page.locator(`#appendix-comparison [data-published="${label}"]`).textContent();
      const got = await page.locator(`#appendix-comparison [data-computed="${label}"]`).textContent();
      expect(bare(ref ?? ''), `${label} reference`).toBe(want);
      expect(bare(got ?? ''), `${label} computed`).toBe(want);
    }
    await expect(page.locator('#appendix-comparison .appendix-verdict')).toHaveClass(/verdict-pass/);
  });

  test('the send sequence counter is built from the two nonces on screen', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    // An independent re-derivation from values the page displays: the SSC is
    // the LAST four bytes of RND.IC followed by the last four of RND.IFD.
    // Mutation 10 takes the first four of each, and this is what catches it on
    // a live run rather than only against the appendix.
    const rndIc = bare(
      (await page.locator('#party-chip .field').filter({ hasText: 'RND.IC' }).locator('code').first().textContent()) ?? ''
    );
    const rndIfd = bare(
      (await page.locator('#party-reader .field').filter({ hasText: 'RND.IFD' }).locator('code').first().textContent()) ?? ''
    );
    const ssc = bare(
      (await page.locator('#session-card .field').filter({ hasText: 'Send sequence counter' }).locator('code').first().textContent()) ?? ''
    );
    expect(rndIc).toHaveLength(16);
    expect(rndIfd).toHaveLength(16);
    expect(ssc).toBe(rndIc.slice(8) + rndIfd.slice(8));
  });

  test('the eavesdropper column holds no key, no keying material and no printed data', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();

    // The claim the three-column layout makes, as a search over the rendered
    // subtree. Every secret is read off the page elsewhere and must NOT appear
    // inside the eavesdropper's column.
    const eavesdropper = bare((await page.locator('#party-eavesdropper').textContent()) ?? '');
    const secrets: Record<string, string> = {
      'K_Enc': bare((await page.locator('#party-reader .field').filter({ hasText: 'K_Enc' }).locator('code').first().textContent()) ?? ''),
      'K_MAC': bare((await page.locator('#party-reader .field').filter({ hasText: 'K_MAC' }).locator('code').first().textContent()) ?? ''),
      'K.IFD': bare((await page.locator('#party-reader .field').filter({ hasText: 'K.IFD' }).locator('code').first().textContent()) ?? ''),
      'RND.IFD': bare((await page.locator('#party-reader .field').filter({ hasText: 'RND.IFD' }).locator('code').first().textContent()) ?? ''),
      'K.IC': bare((await page.locator('#party-chip .field').filter({ hasText: 'K.IC' }).locator('code').first().textContent()) ?? ''),
      'KS_Enc': bare((await page.locator('#session-card .field').filter({ hasText: 'KS_Enc' }).locator('code').first().textContent()) ?? ''),
    };
    for (const [name, value] of Object.entries(secrets)) {
      expect(value.length, `${name} should have been read off the page`).toBeGreaterThan(8);
      expect(eavesdropper, `the eavesdropper column must not contain ${name}`).not.toContain(value);
    }
    // RND.IC is the one value that legitimately appears there: the chip sends
    // its challenge in the clear. Asserted positively, so this test cannot
    // pass by the column being empty.
    const rndIc = bare((await page.locator('#party-chip .field').filter({ hasText: 'RND.IC' }).locator('code').first().textContent()) ?? '');
    expect(eavesdropper).toContain(rndIc);
    // And the printed data itself is nowhere in that column.
    const mrzInfo = await page.evaluate(() => {
      const node = document.querySelector('#mrz-information');
      return node?.textContent ?? '';
    });
    if (mrzInfo) expect(eavesdropper).not.toContain(mrzInfo);
  });

  test('a tampered cryptogram is refused, and NO session keys are shown', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Flip a byte of E_IFD' }).click();
    await expect(page.locator('#panel-handshake .chip-verdict')).toHaveClass(/verdict-fail/);
    // The page must name the actual cause.
    await expect(page.locator('#panel-handshake .chip-verdict')).toContainText('checksum did not match');
    await expect(page.locator('#panel-handshake .chip-verdict')).toContainText('never decrypts');
    // Failing closed: nothing partial on screen.
    await expect(page.locator('#session-card')).toHaveCount(0);
    await expect(page.locator('#panel-handshake')).not.toContainText('KS_Enc');
    await expect(page.locator('#panel-handshake .reader-verdict')).toHaveCount(0);
  });

  test('a tampered checksum is refused for the checksum, by name', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Flip a byte of M_IFD' }).click();
    await expect(page.locator('#panel-handshake .chip-verdict')).toHaveClass(/verdict-fail/);
    await expect(page.locator('#panel-handshake .chip-verdict')).toContainText('checksum');
    await expect(page.locator('#session-card')).toHaveCount(0);
  });

  test('the accept verdict names BOTH conditions, not just the checksum', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    // Invariant 5 as a displayed claim: a chip that checked only the MAC would
    // accept a replay, and the page says so rather than implying the checksum
    // is the whole check.
    await expect(page.locator('#panel-handshake .chip-verdict')).toContainText(
      'checksum verified AND its own nonce came back'
    );
    await expect(page.locator('#panel-handshake .chip-verdict')).toContainText('replay');
  });

  test('a verdict is retired when the printed data changes under it', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();

    await openExhibit(page, /The Printed Data/);
    await page.fill('#doc-expiry', '350101');
    await page.getByRole('button', { name: 'Use this document' }).click();
    await openExhibit(page, /The Handshake/);

    // Both halves §4.1b requires: the stale verdict is GONE, and the page says
    // it was retired and why.
    await expect(page.locator('#panel-handshake .evidence-retired')).toContainText(
      'The printed data changed'
    );
    await expect(page.locator('#session-card')).toHaveCount(0);
    await expect(page.locator('#panel-handshake .chip-verdict')).toHaveCount(0);
  });

  test('re-running the same mode does NOT retire a fresh verdict', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    // The no-op guard §4.1b asks for: pressing the same button again produces
    // a new result, not a retirement notice.
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    await expect(page.locator('#panel-handshake .evidence-retired')).toHaveCount(0);
    await expect(page.locator('#panel-handshake .chip-verdict')).toHaveClass(/verdict-pass/);
  });
});

/* ── Exhibit 4: the counting ──────────────────────────────────────────────── */

test.describe('exhibit 4 — how many guesses', () => {
  test('the displayed bits are the log2 of the displayed possibilities', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /How Many Guesses/);
    // An independent re-derivation by a different route: the test parses the
    // printed count and takes its logarithm with Math.log2 (via BigInt scaling
    // for the large cases), and asserts the page's own bit figure matches.
    for (const [number, birth, expiry] of [
      ['numeric', 'nominal-100', 'nominal-10'],
      ['alphanumeric', 'nominal-100', 'nominal-10'],
      ['known', 'calendar-100', 'calendar-10'],
      ['known', 'one-leap-year', 'one-year'],
    ] as const) {
      await page.selectOption('#count-number', number);
      await page.selectOption('#count-birth', birth);
      await page.selectOption('#count-expiry', expiry);
      const countText = (await page.locator('#count-total').textContent()) ?? '';
      const bitsText = (await page.locator('#count-bits').textContent()) ?? '';
      const count = BigInt(countText.replace(/,/g, ''));
      const shownBits = parseFloat(bitsText);
      // log2 of a BigInt, computed here independently of the source's helper.
      const digits = count.toString(2).length;
      const scaled = Number(count >> BigInt(Math.max(0, digits - 53)));
      const expectedBits = Math.max(0, digits - 53) + Math.log2(scaled);
      expect(shownBits, `${number}/${birth}/${expiry}`).toBeCloseTo(expectedBits, 1);
    }
  });

  test('the factor column multiplies to the total the page prints', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /How Many Guesses/);
    // Parts-sum-to-whole, read off the rendered table.
    const factors = await page.locator('#count-result tbody tr td:nth-child(2)').allTextContents();
    expect(factors.length).toBeGreaterThanOrEqual(4);
    const product = factors
      .map((t) => BigInt(t.replace(/,/g, '')))
      .reduce((a, b) => a * b, 1n);
    const total = BigInt(((await page.locator('#count-total').textContent()) ?? '').replace(/,/g, ''));
    expect(product).toBe(total);
  });

  test("reproduces Appendix A's two formulas exactly", async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /How Many Guesses/);
    // Published values, and the exact counts the brief's acceptance check D
    // specifies. 365^2 x 10^12 and 365^2 x 36^9 x 10^3, recomputed here.
    await expect(page.locator('[data-space-count="numeric-wide"]')).toHaveText(
      (365n ** 2n * 10n ** 12n).toLocaleString('en')
    );
    await expect(page.locator('[data-space-bits="numeric-wide"]')).toHaveText('56.89');
    await expect(page.locator('[data-space-count="alphanumeric-wide"]')).toHaveText(
      (365n ** 2n * 36n ** 9n * 10n ** 3n).toLocaleString('en')
    );
    await expect(page.locator('[data-space-bits="alphanumeric-wide"]')).toHaveText('73.52');
  });

  test('reproduces the three narrower counts exactly', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /How Many Guesses/);
    for (const [id, count, bits] of [
      ['number-known', 36_525n * 3_653n, '26.99'],
      ['number-and-expiry-year-known', 14_610n * 365n, '22.35'],
      ['both-years-known', 366n * 365n, '17.03'],
    ] as const) {
      await expect(page.locator(`[data-space-count="${id}"]`)).toHaveText(count.toLocaleString('en'));
      await expect(page.locator(`[data-space-bits="${id}"]`)).toHaveText(bits);
    }
  });

  test('the check-digit factor is one, and the page says why', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /How Many Guesses/);
    await expect(page.locator('[data-factor="Check digits"]')).toHaveText('1');
    await expect(page.locator('#count-result')).toContainText('no possibilities added');
  });

  test('the page says a count is not an entropy, and dates the 2005 figure', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /How Many Guesses/);
    // The honesty copy, which is a claim and belongs here. Deleting it must
    // fail a test named "claims".
    await expect(page.locator('#counting-caveat')).toContainText('A count is not an entropy');
    await expect(page.locator('#counting-caveat')).toContainText('not drawn uniformly at random');
    await expect(page.locator('#quoted-estimates')).toContainText('that figure is from 2005', {
      ignoreCase: true,
    });
    await expect(page.locator('#quoted-estimates')).toContainText('52-bit');
    await expect(page.locator('#quoted-estimates')).toContainText(
      'makes no claim about any country'
    );
    // Appendix A's own caution must be quoted, not paraphrased away.
    await expect(page.locator('#quoted-estimates')).toContainText(
      'randomly and uniformly chosen which is usually not the case'
    );
  });

  test('changing an assumption retires nothing but updates everything', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /How Many Guesses/);
    const before = await page.locator('#count-total').textContent();
    await page.selectOption('#count-number', 'known');
    const after = await page.locator('#count-total').textContent();
    expect(after).not.toBe(before);
    // Re-selecting the SAME value is a no-op, not a change of state.
    const again = await page.locator('#count-total').textContent();
    await page.selectOption('#count-number', 'known');
    await expect(page.locator('#count-total')).toHaveText(again ?? '');
  });
});

/* ── Exhibit 5: the offline search, and the negative claim ─────────────────── */

test.describe('exhibit 5 — one recording, searched offline', () => {
  /**
   * §4.1d — the negative claim.
   *
   * Three assertions, in the order the template specifies:
   *   1. reach the fixture through the UI;
   *   2. every verdict the page renders in that state reports success;
   *   3. the limitation is on screen in that state, visible and not behind a
   *      disclosure.
   *
   * Plus two bite fixtures below: a space that excludes the true dates (the
   * handshake still succeeds and the "opened offline" clause must NOT appear),
   * and a cancelled search (which claims nothing).
   */
  test('the negative claim: the protocol succeeds AND the recording is opened', async ({ page }) => {
    test.setTimeout(400_000);
    await boot(page, 'dark');

    // 1. Reach the fixture. Record a live handshake, then search the space
    //    that contains the true dates.
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    await openExhibit(page, /One Recording/);
    await expect(page.locator('#recording-card')).toBeVisible();
    await page.getByRole('button', { name: /^Search / }).click();
    await expect(page.locator('#hit-card')).toBeVisible({ timeout: 300_000 });

    // 2. Everything the protocol checks reported success. Asserted against the
    //    RENDERED verdicts in this state, not a flag the test sets — if any of
    //    these failed, the fixture would be demonstrating the mechanism
    //    breaking rather than its limit.
    await openExhibit(page, /The Handshake/);
    await expect(page.locator('#panel-handshake .chip-verdict')).toHaveClass(/verdict-pass/);
    await expect(page.locator('#panel-handshake .reader-verdict')).toHaveClass(/verdict-pass/);
    await expect(page.locator('#panel-handshake .verdict-fail')).toHaveCount(0);
    await expect(page.locator('#session-card')).toBeVisible();

    await openExhibit(page, /One Recording/);
    // The search's own confirmations are green too: the recovered dates equal
    // the real ones, and the recovered key decrypts the recording.
    await expect(page.locator('#panel-search .dates-verdict')).toHaveClass(/verdict-pass/);
    await expect(page.locator('#panel-search .decrypt-verdict')).toHaveClass(/verdict-pass/);

    // 3. The limitation is on screen, in this state, visible.
    const alarm = page.locator('#panel-search .search-verdict');
    await expect(alarm).toHaveClass(/verdict-alarm/);
    await expect(alarm).toContainText(
      'MUTUAL AUTHENTICATION SUCCEEDED — AND THE RECORDING WAS OPENED OFFLINE'
    );
    const claim = page.locator('#negative-claim');
    await expect(claim).toBeVisible();
    await expect(claim).toContainText('The handshake succeeded and the session is encrypted');
    await expect(claim).toContainText('That says nothing about someone who only listened');
    await expect(claim).toContainText('took the number of guesses shown');
    // Not behind a disclosure.
    expect(await claim.evaluate((el) => el.closest('details') === null)).toBe(true);

    // The declared-known fields and the guess count are visible in that state.
    await expect(page.locator('#hit-tried')).toBeVisible();
    await expect(page.locator('#search-birth-year')).toBeVisible();
    await expect(page.locator('#search-expiry-year')).toBeVisible();
    await expect(page.locator('#declared-space-size')).toBeVisible();
  });

  test('BITE: a space that excludes the true dates must NOT claim the recording was opened', async ({ page }) => {
    test.setTimeout(400_000);
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    await openExhibit(page, /One Recording/);

    const trueBirthYear = await page.locator('#search-birth-year').inputValue();
    await page.selectOption('#search-birth-year', trueBirthYear === '71' ? '72' : '71');
    await page.getByRole('button', { name: /^Search / }).click();
    await expect(page.locator('#not-found-card')).toBeVisible({ timeout: 300_000 });

    // The handshake still succeeded — that is the point of this fixture.
    await expect(page.locator('#panel-search')).toContainText('The handshake still succeeded');

    // And the "opened offline" clause must be absent.
    await expect(page.locator('#panel-search')).not.toContainText(
      'THE RECORDING WAS OPENED OFFLINE'
    );
    await expect(page.locator('#negative-claim')).toHaveCount(0);
    await expect(page.locator('#panel-search .verdict-alarm')).toHaveCount(0);
    await expect(page.locator('#hit-card')).toHaveCount(0);
    // Nothing is claimed about the dates.
    await expect(page.locator('#found-birth')).toHaveCount(0);
  });

  test('BITE: a cancelled search reports a partial count and claims nothing', async ({ page }) => {
    test.setTimeout(400_000);
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    await openExhibit(page, /One Recording/);
    /**
     * To cancel a search, the search has to still be running.
     *
     * Two things are needed, and the first attempt at this test had only one.
     * A forty-calendar-year window makes the space big — exhibit 4's
     * 5,332,650-candidate row — but that window CONTAINS the true birth year,
     * so the search found the dates after 1.28 million guesses and reported
     * "found" before the cancel was observed. That is the correct outcome for
     * that run, and a useless fixture.
     *
     * So the declared expiry year is wrong as well. Nothing in the space
     * matches, the search must exhaust all 5,332,650 candidates, and there is
     * plenty of run left to cancel.
     */
    await page.selectOption('#search-birth-window', 'forty-years');
    const trueExpiryYear = await page.locator('#search-expiry-year').inputValue();
    await page.selectOption('#search-expiry-year', trueExpiryYear === '71' ? '72' : '71');
    await expect(page.locator('#declared-space-size')).toHaveText('5,332,650');
    await page.getByRole('button', { name: /^Search / }).click();
    await expect(page.locator('#search-progress')).toBeVisible();
    await expect(page.locator('#search-tried')).not.toHaveText('0');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#panel-search .search-verdict')).toContainText('Search cancelled', {
      timeout: 60_000,
    });
    await expect(page.locator('#panel-search')).toContainText('Nothing is claimed about the ones not tried');
    await expect(page.locator('#hit-card')).toHaveCount(0);
    await expect(page.locator('#negative-claim')).toHaveCount(0);
    // A partial count, strictly less than the declared space.
    const tried = Number(((await page.locator('#final-tried').textContent()) ?? '0').replace(/,/g, ''));
    const total = Number(((await page.locator('#final-total').textContent()) ?? '0').replace(/,/g, ''));
    expect(tried).toBeGreaterThan(0);
    expect(tried).toBeLessThan(total);
  });

  test('the forty-year window is exhibit 4\u2019s own 22.35-bit space', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    await openExhibit(page, /One Recording/);
    // A cross-check between two exhibits: the space exhibit 5 declares must be
    // the one exhibit 4 counts. 14,610 birth dates x 365 expiry dates.
    await page.selectOption('#search-birth-window', 'forty-years');
    await expect(page.locator('#declared-space-size')).toHaveText((14_610n * 365n).toLocaleString('en'));
    await openExhibit(page, /How Many Guesses/);
    await expect(page.locator('[data-space-count="number-and-expiry-year-known"]')).toHaveText(
      (14_610n * 365n).toLocaleString('en')
    );
  });

  test('the recovered dates equal the document on the table', async ({ page }) => {
    test.setTimeout(400_000);
    await boot(page, 'dark');
    // A cross-check between two surfaces the search never connected: the dates
    // exhibit 1 holds and the dates exhibit 5 recovered from the bytes alone.
    const birth = await page.locator('#doc-birth').inputValue();
    const expiry = await page.locator('#doc-expiry').inputValue();
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    await openExhibit(page, /One Recording/);
    await page.getByRole('button', { name: /^Search / }).click();
    await expect(page.locator('#hit-card')).toBeVisible({ timeout: 300_000 });
    await expect(page.locator('#found-birth')).toHaveText(birth);
    await expect(page.locator('#found-expiry')).toHaveText(expiry);
    // And the recovered MRZ_information equals the one exhibit 1 prints.
    await openExhibit(page, /The Printed Data/);
    const info = await page.locator('#mrz-information').textContent();
    await openExhibit(page, /One Recording/);
    await expect(page.locator('#found-mrz')).toHaveText(info ?? '');
  });

  test('the projections are labelled as projections and come from the measured rate', async ({ page }) => {
    test.setTimeout(400_000);
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    await openExhibit(page, /One Recording/);
    await page.getByRole('button', { name: /^Search / }).click();
    await expect(page.locator('#projections-card')).toBeVisible({ timeout: 300_000 });

    // Invariant 6: labelled as projections.
    await expect(page.locator('#projections-card')).toContainText(
      'These are projections, not measurements'
    );
    // And computed FROM the measured rate: the rate on screen must be the one
    // the search reported, and a projection must be the count divided by it.
    const rate = Number(((await page.locator('#measured-rate').textContent()) ?? '0').replace(/,/g, ''));
    const finalRate = Number(
      ((await page.locator('#final-rate').textContent()) ?? '0').replace(/[^0-9]/g, '')
    );
    expect(rate).toBeGreaterThan(0);
    expect(Math.abs(rate - finalRate)).toBeLessThanOrEqual(1);
    // The 17.03-bit row, projected: 133,590 / rate seconds. Recomputed here.
    const shown = (await page.locator('[data-projection="both-years-known"]').textContent()) ?? '';
    const expectedSeconds = 133_590 / rate;
    if (expectedSeconds < 60) {
      expect(shown).toMatch(/second/);
    } else {
      expect(shown).toMatch(/minute|hour/);
    }
  });

  test('the recording shown is only what crossed the air', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /The Handshake/);
    await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
    await expect(page.locator('#session-card')).toBeVisible();
    // Read the secrets off exhibit 3 before leaving it.
    const kEnc = bare((await page.locator('#party-reader .field').filter({ hasText: 'K_Enc' }).locator('code').first().textContent()) ?? '');
    const kIfd = bare((await page.locator('#party-reader .field').filter({ hasText: 'K.IFD' }).locator('code').first().textContent()) ?? '');
    await openExhibit(page, /One Recording/);
    const card = bare((await page.locator('#recording-card').textContent()) ?? '');
    expect(kEnc.length).toBeGreaterThan(8);
    expect(card).not.toContain(kEnc);
    expect(card).not.toContain(kIfd);
    await expect(page.locator('#recording-card')).toContainText('No key, no nonce, no name, no date');
  });

  test('with no recording, the panel says so and offers nothing to search', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /One Recording/);
    // Exhibit 3 has not been visited, so nothing has been recorded.
    await expect(page.locator('#panel-search .no-recording')).toContainText('No recording yet');
    await expect(page.locator('#start-search')).toHaveCount(0);
    await expect(page.locator('#negative-claim')).toHaveCount(0);
  });
});

/* ── Exhibit 6, and page-wide claims ─────────────────────────────────────── */

test.describe('exhibit 6 and the page as a whole', () => {
  test('PACE is named as the replacement and explicitly not built', async ({ page }) => {
    await boot(page, 'dark');
    await openExhibit(page, /What Replaced It/);
    await expect(page.locator('#panel-pace')).toContainText('Password Authenticated Connection Establishment');
    await expect(page.locator('#panel-pace')).toContainText('Named here, not built here');
    await expect(page.locator('#panel-pace')).toContainText('does not implement PACE');
    // Appendix A's own sentence, quoted rather than paraphrased.
    await expect(page.locator('#panel-pace')).toContainText(
      'whose strength is independent of the entropy of the used password'
    );
    // And it declines to say which mechanism current documents use.
    await expect(page.locator('#panel-pace')).toContainText(
      'Nor does this lab say which mechanism any particular country'
    );
  });

  test('the non-goals are stated on the page, not only in the README', async ({ page }) => {
    await boot(page, 'dark');
    // Honest scoping, §1. Each of these is a brief non-goal and each must be
    // visible somewhere in the page rather than only in the repository.
    await openExhibit(page, /The Printed Data/);
    await page.locator('#panel-printed details > summary').last().click();
    await expect(page.locator('#panel-printed')).toContainText('contactless radio layer');
    await expect(page.locator('#panel-printed')).toContainText('document-signing PKI');

    await openExhibit(page, /The Handshake/);
    await page.locator('#panel-handshake details > summary').first().click();
    await expect(page.locator('#panel-handshake')).toContainText('Secure messaging');
    await expect(page.locator('#panel-handshake')).toContainText('is not built here');
    await expect(page.locator('#panel-handshake')).toContainText('Active Authentication');

    await openExhibit(page, /One Recording/);
    await expect(page.locator('#panel-search')).toContainText('No recording yet');
  });

  test('the scripture footer is present exactly once and verbatim', async ({ page }) => {
    await boot(page, 'dark');
    const footer = page.locator('.scripture-footer p').last();
    await expect(footer).toHaveText(
      'So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31'
    );
    await expect(page.locator('.scripture-footer')).toHaveCount(1);
  });

  test('the hero description and the why-box say different things', async ({ page }) => {
    await boot(page, 'dark');
    // §3.1's standing mistake is making these two say the same thing. The
    // description is mechanism (what you will see and do); the why-box is
    // stakes.
    const desc = (await page.locator('.cl-hero-desc').textContent()) ?? '';
    const why = (await page.locator('.cl-hero-why-text').textContent()) ?? '';
    expect(desc.length).toBeGreaterThan(40);
    expect(why.length).toBeGreaterThan(40);
    expect(desc).not.toBe(why);
    await expect(page.locator('.cl-hero-sub')).toHaveText(
      'Basic Access Control · ICAO Doc 9303 Part 11'
    );
  });

  test('the [hidden] probe: a hidden panel paints nothing', async ({ page }) => {
    await boot(page, 'dark');
    // The §4.1 cascade trap: a class rule setting `display` outranks the UA's
    // `[hidden]` rule, so an element can paint while the code believes it is
    // hidden. Asked of the rendering rather than the attribute.
    const painting = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('[hidden]'))) {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (cs.display !== 'none' && (rect.width > 0 || rect.height > 0)) {
          out.push(`${el.tagName.toLowerCase()}#${el.id} display:${cs.display}`);
        }
      }
      return out;
    });
    expect(painting).toEqual([]);
  });

  test('the citations name the edition they were read from', async ({ page }) => {
    await boot(page, 'dark');
    // Attribution that cannot drift: every ICAO citation on the page names the
    // Eighth Edition (2021), which is the edition actually consulted. A
    // citation naming a different edition would be a claim about a document
    // nobody read.
    await openExhibit(page, /From Print to Keys/);
    const cites = await page.locator('#panel-keys cite').allTextContents();
    expect(cites.length).toBeGreaterThan(0);
    for (const cite of cites) {
      if (!cite.includes('ICAO')) continue;
      expect(cite, `citation must name its edition: ${cite}`).toContain('Eighth Edition (2021)');
    }
    await openExhibit(page, /The Printed Data/);
    await page.locator('#panel-printed details > summary').first().click();
    const printedCites = await page.locator('#panel-printed cite').allTextContents();
    for (const cite of printedCites) {
      if (!cite.includes('ICAO')) continue;
      expect(cite).toContain('Eighth Edition (2021)');
    }
  });

  test('the page says it is a teaching demo and not production', async ({ page }) => {
    await boot(page, 'dark');
    // Honest scoping. The page must not read as production software.
    await openExhibit(page, /From Print to Keys/);
    await page.locator('#panel-keys details > summary').first().click();
    await expect(page.locator('#panel-keys')).toContainText('no salt, no iterations');
  });
});
