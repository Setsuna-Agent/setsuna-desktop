import type { CollaborationRuntimeHost, CollaborationToolExecutionContext } from '../contracts/index.js';

/** A follow-up waits outside the child mutation lock until the previous run releases resources. */
export async function waitForTaskSettlement(done: Promise<unknown>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  try {
    await Promise.race([
      done.then(() => undefined, () => undefined),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally { signal.removeEventListener('abort', abort); }
}

/** Abort the losing subscriptions as well as the timer; repeated waits retain no listeners. */
export async function waitForCollaborationActivity(
  host: CollaborationRuntimeHost,
  context: CollaborationToolExecutionContext,
  completions: readonly Promise<unknown>[],
  timeoutMs?: number,
  watch?: (signal: AbortSignal) => Promise<void>,
): Promise<'completion' | 'input' | 'timeout'> {
  context.signal.throwIfAborted();
  const subscription = new AbortController();
  const abort = () => subscription.abort(context.signal.reason);
  context.signal.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const races: Promise<'completion' | 'input' | 'timeout'>[] = completions.map((done) => done.then(() => 'completion' as const, () => 'completion' as const));
    races.push(host.waitForInput(context.threadId, context.turnId, subscription.signal).then(() => 'input' as const));
    if (watch) races.push(watch(subscription.signal).then(() => 'completion' as const));
    const timeout = new Promise<'timeout'>((resolve) => {
      if (timeoutMs === undefined) return;
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      timer.unref();
    });
    const aborted = new Promise<never>((_, reject) => {
      subscription.signal.addEventListener('abort', () => reject(subscription.signal.reason), { once: true });
    });
    return await Promise.race([...races, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    context.signal.removeEventListener('abort', abort);
    subscription.abort(new Error('Collaboration wait finished.'));
  }
}
