import { defineConfig, configDefaults } from 'vitest/config';

// base must match the GitHub Pages project subpath:
// https://systemslibrarian.github.io/crypto-lab-passport-key/
export default defineConfig({
  base: '/crypto-lab-passport-key/',
  worker: {
    // The offline search runs in a module worker, bundled as an ES module so it
    // can `import` the real src/bac/ modules. The worker therefore searches
    // with the SAME key derivation and the SAME retail MAC the page displays,
    // rather than a second copy of them that could drift.
    format: 'es',
  },
  test: {
    // Colocated unit tests only; keep Playwright specs in e2e/ out of the Vitest run.
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    /**
     * 30 seconds, and the figure is a measurement rather than a shrug.
     *
     * Several tests in `src/bac/search.test.ts` run a FULL exhaustive pass
     * over a declared space — 133,225 candidates, each costing two SHA-1
     * compressions and seven DES block operations. Measured on the
     * development machine at 71,285 guesses/sec, one pass is about 1.9
     * seconds, and the mutation-12 test runs two of them back to back, at
     * about 3.8. Vitest's 5-second default clears that unloaded and does not
     * clear it on a loaded runner — where it reports a timeout rather than a
     * cryptographic result, which is the least useful failure a gate can give.
     *
     * So the budget moved and the work did not. 30s is roughly eight times the
     * slowest measured test, which still bounds a genuine hang — the point
     * being that it is a real bound and not `Infinity`. The one test that
     * needs longer (twenty trials, about 19 seconds of searching) carries its
     * own 120s budget with its own measurement, in the file, next to the work
     * it describes.
     */
    testTimeout: 30_000,
  },
});
