import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditControlNames, formatControlNameFailures } from './control-names';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';
import { assertThisLab } from './identity';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the one rendering a reduced-motion reader actually gets — `.panel` and
 *     `.reveal` with their animations cancelled by the stylesheet's own rule —
 *     was never once the rendering that got scanned. This gate sets the
 *     preference through `emulateMedia`, asserts from inside the page that it
 *     took effect (`test.use({ reducedMotion })` silently does nothing on
 *     Playwright 1.61.1), and injects nothing.
 *
 *  2. IT FORCED EVERY PANEL VISIBLE FROM SCRIPT. The old drive stripped every
 *     `[hidden]` attribute and set every `<details>.open` by JS before its only
 *     scan. Stripping `hidden` puts all six tabpanels on screen AT ONCE — a
 *     rendering no reader can reach and axe then scans instead of the real one
 *     — and script-opening the disclosures means the SHUT state, which is what
 *     every reader arrives at, was never scanned at all. This gate switches
 *     tabs by clicking them and opens each disclosure through its `<summary>`,
 *     which is the route a reader has, and scans before and after.
 *
 *  3. IT DROVE BLIND AND THEN THREW THE STATES AWAY. The old drive clicked
 *     every button whose label matched a regex, swallowed every failure with
 *     `.catch(() => {})`, waited a fixed 120ms per tab, and scanned ONCE at the
 *     end — so the invalid-date rendering, the refused-handshake branch, the
 *     not-found search and the retired-evidence notices were all overwritten
 *     before anything measured them, and a click that silently did nothing
 *     looked identical to one that worked. This drive names every control it
 *     touches, asserts a real completion signal after each, and scans after
 *     every step, at 1280px and at 380px.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning — all four `.verdict-*` tones, the `.callout-caveat`
 *     and `.callout-source` boxes, the `.mrz-hashed` highlight marking which
 *     printed characters get hashed, and the shared top bar's ink — are all
 *     `color-mix()` fills axe files under `incomplete` rather than judging.
 *     So is an `aria-label` on a role-less element.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. The old
 *     spec hand-rolled one luminance check over two input selectors, reading
 *     the DECLARED `border-top-color` and `background-color` — blind to
 *     `color-mix()`, to composited backdrops, to every button, `select`,
 *     `.tab-btn` and the search progress `.meter`, and to all states past
 *     first paint.
 *     `nontext.ts` replaces it with a measured oracle over every control at
 *     every driven state, and `expectNoHorizontalOverflow` adds the 1.4.10
 *     check axe has no rule for.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css`'s reduced-motion
 * block cancels `.panel` / `.reveal` animations and every transition, so
 * `getAnimations()` is normally empty and this returns on the sixth frame. It
 * stays because the shared top bar's `.cl-btn` transitions are declared
 * OUTSIDE the lab's `@media` block — `* { transition: none !important }` wins
 * today, but that is a property of the current stylesheet, not of the page.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * has EXACTLY that shape in miniature: `@keyframes fade` and `@keyframes
 * reveal` both start `from { opacity: 0 }`, and every tab panel and every
 * stepper line rides one of them. The reduced-motion block cancels both with
 * `animation: none`, which restores the static `opacity: 1` — correct today,
 * and this assertion is what makes that a measurement rather than a reading.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is decorative
 * verdict/pill glyphs beside their own words — see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. Every panel here renders synchronously at first activation, so a
 * renderer that throws leaves that tabpanel EMPTY — and an empty region is
 * exactly what a scan reports as perfectly accessible. Attach before `boot`,
 * assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's own
 * hero is a `<div class="cl-hero">`, not a `<header>`, so nothing here implies
 * a second banner today — but the shared bar's `dedupeBanner()` exists because
 * other labs in this fleet DID ship one, and the hero markup is the part of
 * this page most likely to be re-templated from a lab that uses `<header>`.
 * Asserting the OUTCOME rather than the markup is what catches that edit.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * This lab's one list is exhibit 6's set of links to the labs that actually
 * build a password-authenticated key exchange, and `replacement.ts` gives it
 * an explicit `role="list"` with `role="listitem"` on each child — the
 * documented compensation for a `list-style: none` that makes Safari and
 * VoiceOver drop the implicit role. So here an explicit role on a list is the
 * fix rather than the defect. What is asserted is therefore the SHAPE of that
 * fix: any explicit role on a `ul`/`ol` must be `list` (any other value
 * orphans every `<li>` under it), and a `role="list"` must never sit on an
 * empty element, because axe applies `aria-required-children` to the explicit
 * role and fails it the day the list renders with no children. Roles are
 * assigned through an element-creation helper, so ask the DOM rather than
 * grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}

/**
 * Shared setup. Runs before EVERY test that imports it, so an assertion here
 * fails all of them at once, under whatever name those tests carry.
 *
 * SO THIS FUNCTION ASSERTS STRUCTURE AND NEVER PRODUCT COPY. On 2026-09-26
 * crypto-lab-mceliece-gate changed one textarea's default string; its gate.ts
 * still asserted the old sentence, boot() threw, both axe runs failed, the
 * build job failed, the deploy was skipped, and deploy-sync reported the lab
 * stale. The step that went red was called "Accessibility gate", and four of
 * its six a11y tests had passed. For three days the live site served security
 * claims that main had already corrected, and the one red thing in sight named
 * the wrong subject.
 *
 * Structure: the control exists, the arrival panel is the one that ships,
 * counts, [hidden]/toBeEmpty on lazily-rendered panels, a default matching a
 * SHAPE. Copy — what a string SAYS, including every sentence this lab quotes
 * from ICAO Doc 9303 and every verdict wording — belongs in
 * `e2e/claims.spec.ts`, where a failure names copy as the subject.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.6x, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. Both animations in this lab's stylesheet
 * start from `opacity: 0`, so the reduced-motion block is the only thing
 * standing between a scan and a mid-flight opacity.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  /* Not page.goto: a suite that navigates and starts asserting cannot
   * tell this lab's server from anyone else's. See e2e/identity.ts. */
  await assertThisLab(page, '.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);

  // Dark is the only theme, pinned with a literal before first paint. The
  // argument exists so a future second theme has somewhere to go; today the
  // only value it can take is 'dark', and asserting that keeps a stray
  // `boot(page, 'light')` from silently scanning dark twice and reporting two
  // passes.
  expect(theme, 'this lab ships one theme').toBe('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('.tab-btn')).toHaveCount(6);
  await expect(page.locator('h1')).toHaveCount(1);

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // Dark is the only theme, so the page must carry no theme control at all —
  // not the shared bar's, which was removed, and not a lab-local one. The
  // shared CSS hides any lab toggle with `display:none !important`, which
  // would leave a dead-but-known element; asserting the count at zero catches
  // the day one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
  ).toHaveCount(0);
  await expect(page.locator('#cl-theme-toggle')).toHaveCount(0);

  // ── The arrival state: exhibit 1 rendered, five panels unrendered ───────
  // `main.ts` renders exhibit 1 at mount so first paint carries real content,
  // and leaves the other five hidden AND EMPTY until their tab is first
  // activated — asserted, because "empty" is this lab's tell that a renderer
  // threw, and an empty region is exactly what a scan reports as perfectly
  // accessible.
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(page.locator('#tab-printed')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-printed')).toBeVisible();
  await expect(page.locator('#panel-printed')).not.toBeEmpty();
  for (const id of ['keys', 'handshake', 'counting', 'search', 'pace']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).toBeEmpty();
  }

  // ── The shipped defaults, as SHAPES ─────────────────────────────────────
  // A 24-character MRZ_information string and three well-formed MRZ fields are
  // structural; WHICH document is loaded, and every sentence about it, are
  // claims that claims.spec.ts owns.
  await expect(page.locator('#mrz-information')).toHaveText(/^[0-9A-Z<]{24}$/);
  await expect(page.locator('#doc-number')).toHaveValue(/^[0-9A-Z<]{1,9}$/);
  await expect(page.locator('#doc-birth')).toHaveValue(/^[0-9]{6}$/);
  await expect(page.locator('#doc-expiry')).toHaveValue(/^[0-9]{6}$/);

  // Both printed MRZ lines render at their TD3 width.
  await expect(page.locator('#mrz-upper')).toHaveText(/^.{44}$/);
  await expect(page.locator('#mrz-lower')).toHaveText(/^.{44}$/);
  // The characters the derivation consumes are marked. A COUNT, not a
  // sentence: 24 of the lower line's 44 characters are hashed, and the
  // claims suite is what checks they are the right 24.
  await expect(page.locator('#mrz-lower .mrz-hashed')).toHaveCount(24);

  // No field may report an error on arrival.
  await expect(page.locator('#panel-printed [aria-invalid="true"]')).toHaveCount(0);

  // ── Disclosures ship shut ───────────────────────────────────────────────
  await expect(page.locator('#panel-printed details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}
/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is
 * unusually exposed to it: a 32-byte cryptogram is a 64-character hex run, the
 * printed MRZ is two unbroken 44-character lines, and exhibit 3 puts three
 * columns of hex side by side. The MRZ lines and every table are inside their
 * own `overflow-x: auto` region — the only things on the page permitted to be
 * wider than the viewport — and every other value relies on `overflow-wrap:
 * anywhere`. So the shapes at risk are a new unwrapped `<code>` run outside a
 * scroller, or a grid item whose automatic minimum size is the min-content of
 * a 64-character line. At 380px that is precisely what this check catches.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab currently avoids scrollers on purpose — long hex wraps via
 * `overflow-wrap: anywhere` — so the assertion is usually vacuous here. It
 * runs at every state anyway, because the requirement MATERIALISES the moment
 * someone reaches for `overflow-x: auto` on a wide value or table (the
 * stylesheet already carries an unused `.table-wrap` rule inviting exactly
 * that), and a scroller born without a keyboard route is invisible to axe.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * `hidden` tabpanels here take the `display: none` route, which is why five
 * panels' worth of buttons are legitimately absent from the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because the surfaces carrying
 *    this lab's meaning are `color-mix()` fills axe cannot resolve: all four
 *    verdict tones, the caveat and source callouts, the `.mrz-hashed`
 *    highlight, the hero aside and the shared bar's ink. Everything else in
 *    that bucket is a real result axe simply could not finish — including
 *    `aria-prohibited-attr`, which is where an `aria-label` on a role-less
 *    element hides. This page leans on getting that right: the handshake-run
 *    button group, the counting-assumption group and the declared-knowledge
 *    group all pair an `aria-label` with `role="group"`, and every
 *    `overflow-x: auto` table and the printed MRZ block pair one with
 *    `role="region"`. Drop any of those roles and the label is silently
 *    discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding an `<aside class="cl-hero-why">`, two `<nav>`s
  // (the shared actions and the tablist wrapper), one `<main>` and a footer.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // axe's `label` rule accepts a bare `placeholder` as an accessible name, so a
  // deleted label can leave this gate green. See `control-names.ts`.
  const unnamed = formatControlNameFailures(await auditControlNames(page));
  softExpect(unnamed, `form controls named only by placeholder/title in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}


// ── The drive ───────────────────────────────────────────────────────────────

/** Switch to an exhibit by clicking its tab, and prove the switch happened. */
async function openTab(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

/**
 * Drive the lab through every state it renders, scanning each.
 *
 * Six things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: exhibit
 *    1 rendered with the ICAO specimen, five panels hidden and unrendered,
 *    every disclosure shut.
 *
 *  - EVERY PANEL IS RENDERED LAZILY, so a tab never clicked is a panel never
 *    even in the DOM. Each of the six is activated through its real tab button
 *    and scanned in its own driven states.
 *
 *  - EVERY REFUSAL AND ERROR STATE. A month-13 date and a ten-character
 *    document number each paint `aria-invalid` and a named message; a flipped
 *    cryptogram byte and a flipped checksum byte each take the chip's refusal
 *    branch, where NO session keys render at all; a declared space that
 *    excludes the true dates takes the search's not-found branch; and changing
 *    the document under a finished handshake takes the evidence-retired
 *    branch. None of these is reachable without doing something wrong on
 *    purpose, and none would otherwise be scanned.
 *
 *  - THE SEARCH REALLY RUNS. Exhibit 5 is scanned mid-search, with the
 *    progress meter partly filled, and again on the alarm verdict afterwards.
 *    The in-flight state is the only one where `.meter-fill` has a width, and
 *    the finished one is the lab's negative-claim fixture.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, and both
 *    `.tab-btn:hover` and `.cl-btn:hover` repaint their fill. Scanned
 *    explicitly.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM completion signal: a
 *    verdict appearing, a count changing, `aria-selected`, a worker's result.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await scanAt('arrival: exhibit 1 with the ICAO specimen, five panels unrendered');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── Exhibit 1: The Printed Data ─────────────────────────────────────────
  await page.locator('#panel-printed details > summary').first().click();
  await expect(page.locator('#panel-printed details[open]')).toHaveCount(1);
  await scanAt('Printed: the letter-values disclosure open');

  // A month that does not exist. The message names the month and the field.
  await page.fill('#doc-birth', '901301');
  await page.getByRole('button', { name: 'Use this document' }).click();
  await expect(page.locator('#doc-birth')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#doc-birth-error')).toBeVisible();
  await scanAt('Printed: month 13 refused — aria-invalid boundary and a named message');

  // A document number longer than the field. Refused, not truncated.
  await page.fill('#doc-birth', '690806');
  await page.fill('#doc-number', 'ABCDEFGHIJ');
  await page.getByRole('button', { name: 'Use this document' }).click();
  await expect(page.locator('#doc-number')).toHaveAttribute('aria-invalid', 'true');
  await scanAt('Printed: a ten-character document number refused');

  // A fictional document, which exercises the whole page on non-specimen data.
  await page.getByRole('button', { name: 'Generate a fictional document' }).click();
  await expect(page.locator('#doc-number')).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('#mrz-information')).toHaveText(/^[0-9A-Z<]{24}$/);
  await scanAt('Printed: a randomly generated fictional document');

  await page.getByRole('button', { name: 'Reset to the ICAO specimen' }).click();
  await expect(page.locator('#mrz-information')).toHaveText(/^[0-9A-Z<]{24}$/);

  // ── Exhibit 2: From Print to Keys ───────────────────────────────────────
  await openTab(page, /From Print to Keys/, '#panel-keys');
  await expect(page.locator('#panel-keys .parity-verdict')).toBeVisible();
  await expect(page.locator('#specimen-agreement .specimen-verdict')).toBeVisible();
  await scanAt('Keys: the specimen derivation, parity table and Appendix D agreement');

  await page.locator('#panel-keys details > summary').first().click();
  await expect(page.locator('#panel-keys details[open]')).toHaveCount(1);
  await scanAt('Keys: the "what this derivation does not have" disclosure open');

  // ── Exhibit 3: The Handshake ────────────────────────────────────────────
  await openTab(page, /The Handshake/, '#panel-handshake');
  await expect(page.locator('#panel-handshake .chip-verdict')).toBeVisible();
  await expect(page.locator('#handshake-columns')).toBeVisible();
  await scanAt('Handshake: the arrival run, three columns, both sides accepting');

  await page.getByRole('button', { name: 'Run the standard’s example' }).click();
  await expect(page.locator('#appendix-comparison .appendix-verdict')).toBeVisible();
  await scanAt('Handshake: Appendix D.3 reproduced, eight values compared');

  await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
  await expect(page.locator('#panel-handshake .chip-verdict')).toBeVisible();
  await expect(page.locator('#session-card')).toBeVisible();
  await scanAt('Handshake: a live run with fresh nonces, session keys agreed');

  // The refusal branch: no session keys render at all in this state.
  await page.getByRole('button', { name: 'Flip a byte of E_IFD' }).click();
  await expect(page.locator('#panel-handshake .verdict-fail')).toBeVisible();
  await expect(page.locator('#session-card')).toHaveCount(0);
  await scanAt('Handshake: a flipped cryptogram byte — the chip refuses, no session keys');

  await page.getByRole('button', { name: 'Flip a byte of M_IFD' }).click();
  await expect(page.locator('#panel-handshake .verdict-fail')).toBeVisible();
  await scanAt('Handshake: a flipped checksum byte — refused');

  await page.locator('#panel-handshake details > summary').first().click();
  await expect(page.locator('#panel-handshake details[open]')).toHaveCount(1);
  await scanAt('Handshake: the protocol-quotations disclosure open');

  // Back to a good live run, so a recording exists for exhibit 5.
  await page.getByRole('button', { name: 'Run live with fresh nonces' }).click();
  await expect(page.locator('#session-card')).toBeVisible();

  // ── Exhibit 4: How Many Guesses? ────────────────────────────────────────
  await openTab(page, /How Many Guesses/, '#panel-counting');
  await expect(page.locator('#count-total')).not.toBeEmpty();
  await expect(page.locator('#named-spaces')).toBeVisible();
  await scanAt('Counting: the default assumptions, five reference rows');

  // Each control changes the count. The `known` branch renders a different
  // closing sentence, so both halves of that conditional get scanned.
  await page.selectOption('#count-number', 'alphanumeric');
  await expect(page.locator('#count-bits')).toHaveText(/73\.52/);
  await scanAt('Counting: an alphanumeric document number — the 73.52-bit row');

  await page.selectOption('#count-number', 'known');
  await page.selectOption('#count-birth', 'one-leap-year');
  await page.selectOption('#count-expiry', 'one-year');
  await expect(page.locator('#count-bits')).toHaveText(/17\.03/);
  await scanAt('Counting: number and both years known — the 17.03-bit row');

  await page.locator('#panel-counting details > summary').first().click();
  await expect(page.locator('#panel-counting details[open]')).toHaveCount(1);
  await scanAt('Counting: the BigInt disclosure open');

  // ── Exhibit 5: One Recording, Searched Offline ──────────────────────────
  await openTab(page, /One Recording/, '#panel-search');
  await expect(page.locator('#recording-card')).toBeVisible();
  await expect(page.locator('#search-controls')).toBeVisible();
  await scanAt('Search: a recording loaded, nothing searched yet');

  // The NOT-FOUND branch first: a birth year the holder was not born in. It
  // is the bite fixture for the negative claim, and the state in which the
  // "opened offline" clause must NOT appear.
  const trueBirthYear = await page.locator('#search-birth-year').inputValue();
  const wrongBirthYear = trueBirthYear === '71' ? '72' : '71';
  await page.selectOption('#search-birth-year', wrongBirthYear);
  await page.getByRole('button', { name: /^Search / }).click();
  await expect(page.locator('#not-found-card')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#panel-search .search-verdict')).toBeVisible();
  await scanAt('Search: the declared space excludes the true dates — not found');

  // Now the real thing. Scanned mid-flight, with the meter partly filled.
  await page.selectOption('#search-birth-year', trueBirthYear);
  await page.getByRole('button', { name: /^Search / }).click();
  await expect(page.locator('#search-progress')).toBeVisible();
  // Wait on a real signal — a non-zero tried count — not on a timeout.
  await expect(page.locator('#search-tried')).not.toHaveText('0');
  await scanAt('Search: in flight, the progress meter partly filled');

  // The negative-claim evidence fixture.
  await expect(page.locator('#hit-card')).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#panel-search .verdict-alarm')).toBeVisible();
  await expect(page.locator('#projections-card')).toBeVisible();
  await scanAt('Search: the recording opened — the alarm verdict and the projections');

  await page.locator('#panel-search details > summary').first().click();
  await expect(page.locator('#panel-search details[open]')).toHaveCount(1);
  await scanAt('Search: the offline-versus-online disclosure open');

  // The wide window, which is the only state where the declared space runs to
  // millions — and the state a learner reaches to reproduce exhibit 4's
  // 22.35-bit row for real. Scanned without running it: the point here is the
  // rendered count, and a multi-minute search in an a11y drive would be a
  // timeout waiting to happen.
  await page.selectOption('#search-birth-window', 'forty-years');
  await expect(page.locator('#declared-space-size')).toHaveText('5,332,650');
  await scanAt('Search: a forty-year window declared, 5,332,650 candidates');
  await page.selectOption('#search-birth-window', 'one-year');

  // Retirement across panels: changing the document invalidates the recording.
  await page.getByRole('tab', { name: /The Printed Data/ }).click();
  await page.getByRole('button', { name: 'Generate a fictional document' }).click();
  await page.getByRole('tab', { name: /The Handshake/ }).click();
  await expect(page.locator('#panel-handshake .evidence-retired')).toBeVisible();
  await scanAt('Handshake: evidence retired after the printed data changed');

  // ── Exhibit 6: What Replaced It ─────────────────────────────────────────
  await openTab(page, /What Replaced It/, '#panel-pace');
  await expect(page.locator('#panel-pace ul[role="list"]')).toBeVisible();
  await scanAt('Replacement: the PACE panel and its list of PAKE labs');

  // ── Hover, which persists after a click ─────────────────────────────────
  await page.getByRole('tab', { name: /How Many Guesses/ }).hover();
  await scanAt('an inactive tab hovered — its surface-2 fill repainted');

  await page.getByRole('tab', { name: /What Replaced It/ }).hover();
  await scanAt('the active tab hovered');

  await page.locator('.cl-topbar .cl-btn').first().hover();
  await scanAt('a shared top bar control hovered');

  // ── Focus rings on the controls that take them ──────────────────────────
  await page.getByRole('tab', { name: /The Printed Data/ }).click();
  await page.locator('#doc-number').focus();
  await expect(page.locator('#doc-number')).toBeFocused();
  await scanAt('a text input focused, showing its focus-visible outline');

  await page.getByRole('button', { name: 'Use this document' }).focus();
  await scanAt('a primary button focused');

  await page.getByRole('tab', { name: /The Printed Data/ }).focus();
  await scanAt('the active tab focused');
}
