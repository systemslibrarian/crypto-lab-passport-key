import { expect, test } from '@playwright/test';

/**
 * Functional scenarios, by role rather than by selector.
 *
 * These are the paths a learner actually takes, asserted through the
 * accessibility tree — so a control that works but has no accessible name
 * fails here rather than only in the a11y gate. Run at desktop and phone
 * widths, because the tab strip wraps and the three handshake columns stack.
 *
 * The crypto itself is pinned by the Vitest suite against published vectors;
 * these tests are about the page being operable.
 */

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(20_000);
  await page.goto('.');
});

test('every exhibit can be reached by clicking its tab', async ({ page }) => {
  const tabs = [
    /The Printed Data/,
    /From Print to Keys/,
    /The Handshake/,
    /How Many Guesses/,
    /One Recording/,
    /What Replaced It/,
  ];
  for (const name of tabs) {
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toBeVisible();
    await expect(page.getByRole('tabpanel')).not.toBeEmpty();
  }
});

test('the tablist is operable from the keyboard', async ({ page }) => {
  // The ARIA tab pattern: one tab in the tab order, arrows move between them.
  await page.getByRole('tab', { name: /The Printed Data/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /From Print to Keys/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /What Replaced It/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: /The Printed Data/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
});

test('a learner can change the document and see the keys follow', async ({ page }) => {
  await page.getByLabel('Document number', { exact: true }).fill('AB1234567');
  await page.getByLabel('Date of birth (YYMMDD)').fill('851231');
  await page.getByLabel('Date of expiry (YYMMDD)').fill('300101');
  await page.getByRole('button', { name: 'Use this document' }).click();
  await expect(page.locator('#mrz-information')).toHaveText('AB1234567185123163001019');

  await page.getByRole('tab', { name: /From Print to Keys/ }).click();
  // The second independently computed vector's K_seed.
  await expect(page.locator('#panel-keys')).toContainText('1CC3AEF7');
});

test('a learner can run a handshake and record it, then search it', async ({ page }) => {
  test.setTimeout(400_000);
  await page.getByRole('tab', { name: /The Handshake/ }).click();
  await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
  await expect(page.locator('#session-card')).toBeVisible();

  await page.getByRole('tab', { name: /One Recording/ }).click();
  await expect(page.locator('#recording-card')).toBeVisible();
  await page.getByRole('button', { name: /^Search / }).click();
  await expect(page.locator('#hit-card')).toBeVisible({ timeout: 300_000 });
  await expect(page.locator('#panel-search .verdict-alarm')).toBeVisible();
});

test('the tamper buttons produce a refusal with no session keys', async ({ page }) => {
  await page.getByRole('tab', { name: /The Handshake/ }).click();
  await page.getByRole('button', { name: 'Flip a byte of E_IFD' }).click();
  await expect(page.locator('#panel-handshake .verdict-fail')).toBeVisible();
  await expect(page.locator('#session-card')).toHaveCount(0);
});

test('the counting controls change the count', async ({ page }) => {
  await page.getByRole('tab', { name: /How Many Guesses/ }).click();
  const before = await page.locator('#count-total').textContent();
  await page.getByLabel('Document number assumption').selectOption('alphanumeric');
  await expect(page.locator('#count-total')).not.toHaveText(before ?? '');
  await expect(page.locator('#count-bits')).toHaveText('73.52 bits');
});

test('no page errors anywhere in the tour', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  for (const name of [
    /The Printed Data/,
    /From Print to Keys/,
    /The Handshake/,
    /How Many Guesses/,
    /One Recording/,
    /What Replaced It/,
  ]) {
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('tabpanel')).not.toBeEmpty();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
