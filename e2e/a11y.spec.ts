import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, where
 * exhibit 1 has rendered the ICAO specimen and the other five tabpanels are
 * hidden and UNRENDERED; the shared skip link focused; a month-13 date and an
 * over-long document number each refused behind an `aria-invalid` boundary
 * with a named message; a randomly generated fictional document; the key
 * derivation with its parity table and its Appendix D agreement; the handshake
 * on the standard's worked example, on a live run, and on two tampered runs
 * where the chip refuses and NO session keys render; the counting exhibit at
 * three different sets of assumptions; a real offline search — not found in a
 * space that excludes the true dates, then in flight with the progress meter
 * partly filled, then on the alarm verdict that is this lab's negative-claim
 * fixture; evidence retired across panels when the printed data changes; the
 * PACE panel; every disclosure opened through its own summary; three hover
 * states and three focus rings. Every one of those states is scanned, at
 * desktop and phone width.
 *
 * See `gate.ts` for why nothing is injected into the page (the old gate's
 * `addStyleTag` motion kill bypassed the stylesheet's own reduced-motion
 * block, so the rendering reduced-motion readers get was never the one
 * scanned), why no panel is revealed from script (the old gate stripped every
 * `[hidden]` and opened every `<details>` by JS before its only scan), why the
 * lab's defaults are asserted rather than assumed, and why `violations` is not
 * the whole oracle.
 */
for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
