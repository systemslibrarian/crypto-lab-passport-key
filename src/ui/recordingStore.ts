/**
 * The recording exhibit 3 takes and exhibit 5 searches.
 *
 * Two things are stored, and they are kept deliberately separate:
 *
 *  - the **recording** — E_IFD and M_IFD, the bytes that crossed the air. This
 *    is what the search worker receives.
 *  - the **truth** — the printed data that produced it. This is what the page
 *    checks the search's answer against AFTERWARDS, and it never goes near the
 *    worker.
 *
 * Keeping them in one module with two accessors is what makes the boundary
 * visible: `recordingForSearch()` returns only the bytes, and
 * `truthForChecking()` is called by the panel after a result comes back.
 * Invariant 3 is then a property of which function the worker's task is built
 * from, and `claims.spec.ts` checks that the search really did run on the
 * bytes alone by confirming it can also FAIL — a declared space that excludes
 * the true dates reports not-found, which a worker holding the answer could
 * not do.
 */
import type { Recording } from '../bac/bac';
import type { PrintedData } from '../bac/mrz';

interface Stored {
  readonly recording: Recording;
  readonly truth: PrintedData;
  readonly takenAt: number;
}

let stored: Stored | null = null;
const listeners = new Set<() => void>();

export function setRecording(recording: Recording | null, truth: PrintedData): void {
  stored = recording === null ? null : { recording, truth, takenAt: Date.now() };
  for (const listener of listeners) listener();
}

export function hasRecording(): boolean {
  return stored !== null;
}

/** The bytes, and only the bytes. This is what the worker's task is built from. */
export function recordingForSearch(): Recording | null {
  if (stored === null) return null;
  return { eIfd: stored.recording.eIfd, mIfd: stored.recording.mIfd };
}

/**
 * The true printed data, for checking an answer after the fact.
 *
 * Never passed to the search. The panel calls this only once the worker has
 * reported, to decide whether what it found is actually right.
 */
export function truthForChecking(): PrintedData | null {
  return stored === null ? null : stored.truth;
}

export function onRecordingChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
