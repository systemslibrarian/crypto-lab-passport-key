import { defineConfig, devices } from '@playwright/test';

/**
 * The browser suites run against the PRODUCTION BUILD served by `vite
 * preview`, so what passes here is what ships.
 *
 * Three projects, deliberately separated:
 *   - a11y   — the axe WCAG A/AA gate, Chromium only, so the gate is
 *              deterministic.
 *   - claims — what the page SAYS, asserted against computed values. Kept
 *              apart from the gate so a copy change fails a test named
 *              "claims" rather than one named "Accessibility gate".
 *   - flows  — functional scenarios, across engines and a phone viewport.
 *
 * ## The port is 4247, and it was chosen by measurement
 *
 * Never the Vite default 4173 (36 labs share it fleet-wide). 4247 is absent
 * from the catalog's `tools/playwright-ports.json`, absent from every sibling
 * lab's config, and nothing was listening on it when this was written — all
 * three checked, because the first two are not enough: port 4245 passed both
 * registry and config checks here and turned out to be serving another lab
 * from a concurrent session. `reuseExistingServer` would then have pointed
 * this whole suite at that lab, and a mutation check could have "passed"
 * against a checkout that was never mutated.
 *
 * `--strictPort` is the other half: without it Playwright silently takes the
 * next free port, the collision stops being visible, and the config stops
 * describing what actually ran.
 */
const PORT = 4247;
const BASE = `http://localhost:${PORT}/crypto-lab-passport-key/`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // The a11y drive walks every exhibit, opens every disclosure and runs a real
  // offline search before scanning, in two viewports.
  timeout: 300_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE,
    // Dark is the only theme this lab ships.
    colorScheme: 'dark',
  },
  projects: [
    { name: 'a11y', testMatch: /a11y\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'claims', testMatch: /claims\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'flows-chromium', testMatch: /flows\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'flows-mobile', testMatch: /flows\.spec\.ts/, use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    // Build before serving. `vite preview` serves whatever is already in
    // dist/, so without the build in front a run tests a stale bundle — and a
    // build that FAILS leaves the previous good bundle in place, so the whole
    // suite passes green against source that no longer compiles. That silently
    // invalidates mutation checking, which is the only way a test is shown to
    // have teeth.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
