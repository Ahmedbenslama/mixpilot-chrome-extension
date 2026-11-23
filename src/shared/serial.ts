/**
 * Runs async tasks strictly one after another, so start/stop requests from a popup
 * double-click, a reopened popup, or tab events cannot interleave.
 * A failing task does not block later tasks.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
