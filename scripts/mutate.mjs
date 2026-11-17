#!/usr/bin/env node
/**
 * The mutation runner — §4.1c, from a script rather than from a checklist.
 *
 * `npm run mutate` applies each patch in `mutations.mjs`, runs the owning
 * test, and reports KILLED, SURVIVED or DOES NOT BUILD. A single mutation can
 * be run with `npm run mutate -- 7`.
 *
 * ## Why a script and not a person with a list
 *
 * The five manual steps are a person's checklist, and a person performing them
 * writes the result down afterwards. That is where they fail: a sentence
 * describing a mutation cannot be replayed, and a paragraph describing a run
 * is the author's side of the claim rather than the run's.
 *
 * Worse, **a mutation that fails to apply and a mutation nothing catches are
 * the same green run.** No test report can tell you which you have. The only
 * things that separate them are outside the report: a non-empty source diff,
 * and a bundle hash that moved. This runner checks both, every time.
 *
 * ## What counts as a kill
 *
 * All four of:
 *   1. **the baseline passed** — the owning test is run UNMUTATED first, in
 *      the same invocation. A test that was already failing cannot kill
 *      anything, and a red run would otherwise be scored as a kill.
 *   2. **the patch changed the file** — byte-compared before and after.
 *   3. **the run served the mutated code** — the `tsc --noEmit` typecheck must
 *      still pass (so the mutation compiles), and for a Playwright mutation
 *      the built bundle hash must MOVE, proving the change reached the
 *      browser. A red run whose output matches a build error, a server that
 *      never started, or a refused connection is classified as INCONCLUSIVE
 *      rather than counted.
 *   4. **it does not have to compile to be reported** — a patch that breaks
 *      `tsc` is DOES NOT BUILD and is never a kill, because the suite would
 *      then run against the last good bundle and pass having checked nothing.
 *
 * The file is restored after every mutation, and the hash is confirmed to
 * return to its pre-mutation value.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MUTATIONS } from './mutations.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** Run a command, capturing output and exit status without throwing. */
function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env ?? {}) },
      timeout: options.timeout ?? 900_000,
    });
    return { ok: true, output: stdout };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    return { ok: false, output };
  }
}

/** A hash over the built bundle, so "did it reach the browser" is measurable. */
function bundleHash() {
  const dir = join(ROOT, 'dist', 'assets');
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const hash = createHash('sha256');
  for (const file of files) hash.update(readFileSync(join(dir, file)));
  return hash.digest('hex').slice(0, 16);
}

/**
 * A red run that is not evidence.
 *
 * `crypto-lab-hidden-bit`'s discipline: refuse any failure whose output looks
 * like infrastructure rather than an assertion. Without this, a preview server
 * that died mid-run reads as twelve kills.
 */
const INCONCLUSIVE = [
  /ERR_CONNECTION_REFUSED/,
  /was not able to start/i,
  /Port \d+ is already in use/,
  /Cannot find module/,
  /error TS\d+/,
  /ENOENT/,
];

function classify(output) {
  for (const pattern of INCONCLUSIVE) {
    if (pattern.test(output)) return `INCONCLUSIVE (${pattern})`;
  }
  return null;
}

function applyPatch(mutation) {
  const path = join(ROOT, mutation.file);
  const before = readFileSync(path, 'utf8');
  const occurrences = before.split(mutation.anchor).length - 1;
  if (occurrences !== 1) {
    return { error: `anchor occurs ${occurrences} times, must be exactly 1` };
  }
  const after = before.replace(mutation.anchor, mutation.replacement);
  if (after === before) return { error: 'patch produced no change' };
  writeFileSync(path, after);
  return { before, path };
}

function testFor(mutation) {
  if (mutation.suite === 'vitest') {
    return run('npx', ['vitest', 'run', '-t', mutation.grep, '--reporter=dot']);
  }
  return run('npx', [
    'playwright',
    'test',
    '--project=claims',
    '--retries=0',
    '--reporter=line',
    '-g',
    mutation.grep,
  ], { env: { CI: '1' } });
}

const only = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const selected = only.length ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;

console.log(`\nMutation run — ${selected.length} of ${MUTATIONS.length} mutations\n`);

// Step 0: the whole suite must be green BEFORE anything is mutated. A run that
// starts red cannot distinguish a kill from a pre-existing failure.
console.log('baseline: building and running the full suite unmutated...');
const baselineBuild = run('npm', ['run', 'build']);
if (!baselineBuild.ok) {
  console.error('BASELINE BUILD FAILED — nothing below would mean anything.');
  console.error(baselineBuild.output.slice(-3000));
  process.exit(1);
}
const baselineHash = bundleHash();
const baselineTests = run('npx', ['vitest', 'run', '--reporter=dot']);
if (!baselineTests.ok) {
  console.error('BASELINE TESTS FAILED — nothing below would mean anything.');
  console.error(baselineTests.output.slice(-3000));
  process.exit(1);
}
console.log(`baseline: green, bundle ${baselineHash}\n`);

const results = [];

for (const mutation of selected) {
  process.stdout.write(`[${mutation.id}] ${mutation.name}\n`);

  // Rule 1: the owning test passes unmutated, in THIS run.
  const owning = testFor(mutation);
  if (!owning.ok) {
    results.push({ mutation, verdict: 'NO BASELINE', detail: 'the owning test fails unmutated' });
    console.log('    NO BASELINE — the owning test fails before mutation\n');
    continue;
  }

  const applied = applyPatch(mutation);
  if (applied.error) {
    results.push({ mutation, verdict: 'NOT APPLIED', detail: applied.error });
    console.log(`    NOT APPLIED — ${applied.error}\n`);
    continue;
  }

  try {
    // Rule 4: a patch that does not compile is never a kill.
    const typecheck = run('npx', ['tsc', '--noEmit']);
    if (!typecheck.ok) {
      results.push({ mutation, verdict: 'DOES NOT BUILD', detail: 'tsc rejected the mutation' });
      console.log('    DOES NOT BUILD — tsc rejected it; not a kill\n');
      continue;
    }

    // Rule 3: for a browser mutation, prove the bundle moved.
    let hashNote = 'n/a (vitest runs the source)';
    if (mutation.suite === 'playwright') {
      const build = run('npm', ['run', 'build']);
      if (!build.ok) {
        results.push({ mutation, verdict: 'DOES NOT BUILD', detail: 'vite build failed' });
        console.log('    DOES NOT BUILD — the bundle would be stale; not a kill\n');
        continue;
      }
      const mutatedHash = bundleHash();
      if (mutatedHash === baselineHash) {
        results.push({
          mutation,
          verdict: 'NOT SERVED',
          detail: `bundle hash did not move (${mutatedHash})`,
        });
        console.log(`    NOT SERVED — bundle hash unchanged (${mutatedHash})\n`);
        continue;
      }
      hashNote = `${baselineHash} -> ${mutatedHash}`;
    }

    const mutated = testFor(mutation);
    if (mutated.ok) {
      results.push({ mutation, verdict: 'SURVIVED', detail: `bundle ${hashNote}` });
      console.log(`    SURVIVED — the owning test still passes. ${hashNote}\n`);
    } else {
      const inconclusive = classify(mutated.output);
      if (inconclusive) {
        results.push({ mutation, verdict: 'INCONCLUSIVE', detail: inconclusive });
        console.log(`    ${inconclusive} — red, but not because of an assertion\n`);
      } else {
        results.push({ mutation, verdict: 'KILLED', detail: `bundle ${hashNote}` });
        console.log(`    KILLED — the owning test went red. ${hashNote}\n`);
      }
    }
  } finally {
    writeFileSync(applied.path, applied.before);
  }
}

// The file is restored; confirm the bundle returns to its pre-mutation hash.
const restoreBuild = run('npm', ['run', 'build']);
const restoredHash = bundleHash();
console.log('─'.repeat(72));
if (!restoreBuild.ok || restoredHash !== baselineHash) {
  console.error(
    `RESTORE CHECK FAILED — bundle is ${restoredHash}, baseline was ${baselineHash}. ` +
      'A mutation may still be in the tree; check `git status` before trusting anything.'
  );
  process.exitCode = 1;
} else {
  console.log(`restore check: bundle back to ${restoredHash}`);
}

const killed = results.filter((r) => r.verdict === 'KILLED').length;
console.log(`\n${killed} of ${results.length} killed\n`);
for (const r of results) {
  console.log(`  ${String(r.mutation.id).padStart(2)}  ${r.verdict.padEnd(15)} ${r.mutation.name}`);
  if (r.verdict !== 'KILLED') console.log(`      ${r.detail}`);
}
console.log();

// A surviving mutation is reported, not explained away.
if (killed !== results.length) process.exitCode = 1;
