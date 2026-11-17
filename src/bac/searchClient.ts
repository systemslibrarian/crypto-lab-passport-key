/**
 * The main-thread side of the search worker.
 *
 * Wraps the `postMessage` protocol in a promise with progress callbacks and a
 * cancel method, so the UI never touches a raw `MessageEvent`.
 *
 * Cancellation has a subtlety worth naming: a worker in a synchronous loop
 * cannot read its own message queue, so `cancel()` is only observed at the
 * next chunk boundary. That is normally within a tenth of a second, but it is
 * not instant, and the UI reflects that by disabling the button and waiting
 * for the worker's own `cancelled` outcome rather than declaring the search
 * stopped on its own authority.
 */
import type { SearchOutcome, SearchProgress, SearchTask } from './search';
import { assertNoSecrets } from './search';
import type { SearchWorkerRequest, SearchWorkerResponse } from './search.worker';

export interface RunningSearch {
  readonly done: Promise<SearchOutcome>;
  /** Ask the worker to stop. Observed at its next chunk boundary. */
  cancel(): void;
  /** Tear the worker down. Safe to call twice. */
  dispose(): void;
}

/**
 * Start a search in a fresh worker.
 *
 * A new worker per search rather than a long-lived one: a search is a
 * one-shot, a terminated worker cannot leak a half-finished loop into the next
 * run, and the cost of starting one is invisible beside a million guesses.
 */
export function startSearch(
  task: SearchTask,
  onProgress: (progress: SearchProgress) => void
): RunningSearch {
  // The same check the worker runs, done here too so a bad task fails in the
  // caller's stack rather than as an error message from another thread.
  assertNoSecrets(task);

  const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;

  const done = new Promise<SearchOutcome>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress(message.progress);
        return;
      }
      settled = true;
      if (message.type === 'outcome') resolve(message.outcome);
      else reject(new Error(message.message));
      worker.terminate();
    };
    worker.onerror = (event) => {
      settled = true;
      reject(new Error(event.message || 'the search worker failed to start'));
      worker.terminate();
    };
  });

  const request: SearchWorkerRequest = { type: 'search', task };
  worker.postMessage(request);

  return {
    done,
    cancel: () => {
      if (settled) return;
      const cancel: SearchWorkerRequest = { type: 'cancel' };
      worker.postMessage(cancel);
    },
    dispose: () => worker.terminate(),
  };
}
