/**
 * The search worker.
 *
 * The search is a tight loop over millions of candidates, so it cannot run on
 * the main thread: it would freeze the page, and a frozen page cannot show a
 * progress count or offer a Cancel button — the two things that make the
 * exhibit honest about how long this takes.
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
 *
 * ## Cancelling a worker that is busy — and why a callback was not enough
 *
 * A worker handler runs to completion before the worker reads another message.
 * The first version of this file ran a fully synchronous `search()` inside
 * `onmessage` and claimed in a comment that reporting progress let the queue
 * turn. IT DID NOT: calling a callback is not yielding, so a `cancel` posted
 * mid-search sat unread until the search finished, and the Cancel button was
 * decorative. The claims suite caught it — the cancelled verdict never
 * appeared.
 *
 * So the search is a GENERATOR, and this loop awaits a real macrotask between
 * chunks. `setTimeout` and not `queueMicrotask`: a posted message is a
 * macrotask, and microtasks all drain before the next one is delivered, so a
 * microtask yield would read the queue exactly as never as before.
 *
 * `CHUNK` is the trade. Too large and Cancel feels dead; too small and the
 * event-loop turns cost more than the cryptography. At the rate this measures
 * in a browser, 16,384 candidates is on the order of 50ms.
 */
import {
  assertNoSecrets,
  cancelledAt,
  searchSteps,
  type SearchOutcome,
  type SearchProgress,
  type SearchTask,
} from './search';

export type SearchWorkerRequest =
  | { readonly type: 'search'; readonly task: SearchTask }
  | { readonly type: 'cancel' };

export type SearchWorkerResponse =
  | { readonly type: 'progress'; readonly progress: SearchProgress }
  | { readonly type: 'outcome'; readonly outcome: SearchOutcome }
  | { readonly type: 'error'; readonly message: string };

const CHUNK = 16_384;

let cancelled = false;

function post(message: SearchWorkerResponse): void {
  self.postMessage(message);
}

/** Hand the event loop a real turn, so a queued `cancel` can be delivered. */
function yieldToQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

self.onmessage = async (event: MessageEvent<SearchWorkerRequest>): Promise<void> => {
  const request = event.data;

  if (request.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (request.type !== 'search') return;

  cancelled = false;
  try {
    assertNoSecrets(request.task);
    const steps = searchSteps(request.task, CHUNK);
    let step = steps.next();
    while (!step.done) {
      post({ type: 'progress', progress: step.value });
      // The yield is what makes cancellation possible at all. After it, this
      // worker's `onmessage` has had a chance to run and set the flag.
      await yieldToQueue();
      if (cancelled) {
        post({ type: 'outcome', outcome: cancelledAt(step.value) });
        return;
      }
      step = steps.next();
    }
    post({ type: 'outcome', outcome: step.value });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
