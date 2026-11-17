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
  },
});
