/**
 * The search worker.
 *
 * The search is a tight synchronous loop over millions of candidates, so it
 * cannot run on the main thread: it would freeze the page, and a frozen page
 * cannot show a progress count or offer a Cancel button — the two things that
 * make the exhibit honest about how long this takes.
 *
 * The worker imports `search.ts` directly rather than carrying its own copy of
 * the derivation. That is deliberate: if the worker had its own SHA-1 or its
 * own retail MAC, the exhibit could pass while the page and the searcher
 * disagreed about what Basic Access Control is. One implementation, used by
 * both, means a mutation to the derivation breaks the displayed keys and the
 * search together.
 *
 * ## The message protocol
 *
 * In:  `{ type: 'search', task }` — a `SearchTask` and nothing else.
 *      `{ type: 'cancel' }`
 * Out: `{ type: 'progress', progress }`
 *      `{ type: 'outcome', outcome }`
 *      `{ type: 'error', message }`
 *
 * `assertNoSecrets` runs on the received task before the search starts, so
 * invariant 3 is enforced at the boundary a type cannot cross.
 */
import { assertNoSecrets, search, type SearchProgress, type SearchOutcome, type SearchTask } from './search';

export type SearchWorkerRequest =
  | { readonly type: 'search'; readonly task: SearchTask }
  | { readonly type: 'cancel' };

export type SearchWorkerResponse =
  | { readonly type: 'progress'; readonly progress: SearchProgress }
  | { readonly type: 'outcome'; readonly outcome: SearchOutcome }
  | { readonly type: 'error'; readonly message: string };

/**
 * Cancellation, across a thread that is busy.
 *
 * A worker running a synchronous loop never reaches its message queue, so a
 * `{ type: 'cancel' }` posted mid-search would sit unread until the search
 * finished — by which time cancelling is meaningless. The loop therefore
 * yields to the queue every chunk: `search`'s `onProgress` hook returns false
 * once this flag is set, and the flag is set by a message handler that only
 * runs because the chunk boundary let the event loop turn.
 *
 * `chunkSize` is the trade. Too large and Cancel feels dead; too small and the
 * event-loop turns cost more than the cryptography. 8,192 candidates is about
 * a tenth of a second at the measured rate.
 */
let cancelled = false;

const CHUNK = 8192;

function post(message: SearchWorkerResponse): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<SearchWorkerRequest>): void => {
  const request = event.data;

  if (request.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (request.type !== 'search') return;

  cancelled = false;
  try {
    assertNoSecrets(request.task);
    const outcome = search(request.task, {
      chunkSize: CHUNK,
      onProgress: (progress) => {
        post({ type: 'progress', progress });
        // A cancel can only have arrived if this chunk boundary let the event
        // loop run, which is the whole reason the loop reports at all.
        return !cancelled;
      },
    });
    post({ type: 'outcome', outcome });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
