import { RUNTIME_PROCESS_SHUTDOWN_MESSAGE } from '@setsuna-desktop/contracts';
import type { ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import type { Readable, Writable } from 'node:stream';

export type RuntimeChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;
// Allow the runtime to drain turns, HTTP handlers, native resources and SQLite.
const RUNTIME_SHUTDOWN_TIMEOUT_MS = 15_000;
const RUNTIME_FORCE_EXIT_TIMEOUT_MS = 1_000;

/**
 * Ask the runtime to release durable resources before terminating it. Windows does not
 * deliver POSIX signals to Node child processes, so child.kill('SIGTERM') is only a fallback.
 */
export async function stopRuntimeChild(
  child: RuntimeChildProcess,
  gracefulTimeoutMs = RUNTIME_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    assertCleanRuntimeExit(child);
    return;
  }

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  const ignoreStdinError = () => undefined;
  child.stdin.once('error', ignoreStdinError);
  try {
    try {
      child.stdin.end(RUNTIME_PROCESS_SHUTDOWN_MESSAGE);
    } catch {
      // A process that already closed stdin is handled by the forced-stop fallback below.
    }
    if (await settlesWithin(exited, Math.max(0, gracefulTimeoutMs))) {
      assertCleanRuntimeExit(child);
      return;
    }

    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (await settlesWithin(exited, RUNTIME_FORCE_EXIT_TIMEOUT_MS)) {
      throw new Error('Runtime required forced termination after graceful shutdown timed out.');
    }

    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (!await settlesWithin(exited, RUNTIME_FORCE_EXIT_TIMEOUT_MS)) {
      throw new Error('Runtime process did not exit after forced termination.');
    }
    throw new Error('Runtime required forced termination after graceful shutdown timed out.');
  } finally {
    child.stdin.off('error', ignoreStdinError);
  }
}

function assertCleanRuntimeExit(child: RuntimeChildProcess): void {
  if (child.exitCode === 0 && child.signalCode === null) return;
  throw new Error(
    `Runtime reported an unsuccessful graceful shutdown (code=${child.exitCode ?? 'null'}, signal=${child.signalCode ?? 'null'}).`,
  );
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([promise.then(() => true as const), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function findAvailablePort(): Promise<number> {
  // 让系统分配空闲端口，再关闭探测 server，交给 runtime 子进程监听。
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === 'string') throw new Error('Unable to allocate runtime port.');
  return address.port;
}

export function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, delayMs);
    timer.unref();
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}
