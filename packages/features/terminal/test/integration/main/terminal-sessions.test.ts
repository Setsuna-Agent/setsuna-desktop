import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DesktopTerminalEventPayload } from '../../../src/contracts/index.js';
import { terminalProcessOptions } from '../../../src/main/process-options.js';
import { DesktopTerminalStore } from '../../../src/main/sessions.js';

describe('desktop terminal store', () => {
  it('opens a shell session and reads command output', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-test-'));
    const events: DesktopTerminalEventPayload[] = [];
    const store = new DesktopTerminalStore((event) => events.push(event));
    const session = await store.open({ workspaceRoot, cols: 80, rows: 24 });

    expect(session.workspaceRoot).toBe(await realpath(workspaceRoot));

    store.write(session.sessionId, terminalSmokeCommand());
    await waitFor(() => events.some((event) => (
      event.event === 'output' && String(event.data.text ?? '').includes('setsuna-terminal-smoke')
    )));

    const queuedEvents = store.read(session.sessionId);
    expect(queuedEvents.some((event) => (
      event.event === 'output' && String(event.data.text ?? '').includes('setsuna-terminal-smoke')
    ))).toBe(true);
    expect(queuedEvents.every((event) => Number.isInteger(event.seq) && event.seq > 0)).toBe(true);
    expect(queuedEvents.map((event) => event.seq)).toEqual(
      [...queuedEvents].sort((left, right) => left.seq - right.seq).map((event) => event.seq),
    );
    expect(store.close(session.sessionId)).toBe(true);
  });

  it('retains an exited session and can restart it in place', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-restart-test-'));
    const events: DesktopTerminalEventPayload[] = [];
    const store = new DesktopTerminalStore((event) => events.push(event));
    const session = await store.open({ workspaceRoot, cols: 80, rows: 24 });

    store.write(session.sessionId, terminalExitCommand());
    await waitFor(() => events.some((event) => event.event === 'exit'));

    expect(store.read(session.sessionId).some((event) => event.event === 'exit')).toBe(true);
    expect(() => store.write(session.sessionId, terminalSmokeCommand())).toThrow('重新启动');
    await expect(store.restart(session.sessionId, 90, 30)).resolves.toBe(true);
    store.write(session.sessionId, terminalSmokeCommand());
    await waitFor(() => events.some((event) => (
      event.event === 'output' && String(event.data.text ?? '').includes('setsuna-terminal-smoke')
    )));

    expect(store.close(session.sessionId)).toBe(true);
  });

  it('coalesces concurrent restarts while environment resolution is pending', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-concurrent-restart-test-'));
    const events: DesktopTerminalEventPayload[] = [];
    let environmentResolutionCount = 0;
    let releaseRestartEnvironment: (() => void) | undefined;
    const restartEnvironment = new Promise<void>((resolve) => {
      releaseRestartEnvironment = resolve;
    });
    const store = new DesktopTerminalStore(
      (event) => events.push(event),
      async () => {
        environmentResolutionCount += 1;
        if (environmentResolutionCount > 1) await restartEnvironment;
        return {};
      },
    );
    const session = await store.open({ workspaceRoot, cols: 80, rows: 24 });
    store.write(session.sessionId, terminalExitCommand());
    await waitFor(() => events.some((event) => event.event === 'exit'));

    const firstRestart = store.restart(session.sessionId, 90, 30);
    const secondRestart = store.restart(session.sessionId, 100, 40);
    await waitFor(() => environmentResolutionCount === 2);
    releaseRestartEnvironment?.();

    await expect(Promise.all([firstRestart, secondRestart])).resolves.toEqual([true, true]);
    expect(environmentResolutionCount).toBe(2);
    expect(events.filter((event) => event.event === 'ready')).toHaveLength(2);
    expect(store.close(session.sessionId)).toBe(true);
  });

  it('does not spawn a PTY when an opening operation is aborted during environment resolution', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-abort-test-'));
    const events: DesktopTerminalEventPayload[] = [];
    let markEnvironmentStarted!: () => void;
    let releaseEnvironment!: () => void;
    const environmentStarted = new Promise<void>((resolve) => {
      markEnvironmentStarted = resolve;
    });
    const environmentPending = new Promise<void>((resolve) => {
      releaseEnvironment = resolve;
    });
    const store = new DesktopTerminalStore(
      (event) => events.push(event),
      async () => {
        markEnvironmentStarted();
        await environmentPending;
        return {};
      },
    );
    const controller = new AbortController();
    const opening = store.open({ workspaceRoot }, controller.signal);
    await environmentStarted;

    controller.abort(new Error('Terminal Feature is draining.'));
    releaseEnvironment();

    await expect(opening).rejects.toThrow('Terminal Feature is draining.');
    expect(events).toEqual([]);
    store.closeAll();
  });

  it('applies the host environment when starting a session', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-proxy-test-'));
    const events: DesktopTerminalEventPayload[] = [];
    const store = new DesktopTerminalStore(
      (event) => events.push(event),
      async () => ({ HTTP_PROXY: 'http://relay:secret@127.0.0.1:3128' }),
    );
    const session = await store.open({ workspaceRoot });

    store.write(session.sessionId, terminalProxyCommand());
    await waitFor(() => events.some((event) => (
      event.event === 'output'
      && String(event.data.text ?? '').includes('relay:secret@127.0.0.1:3128')
    )));

    expect(store.close(session.sessionId)).toBe(true);
  });

  it('treats renderer operations that arrive after close as stale', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-close-race-test-'));
    const store = new DesktopTerminalStore(() => undefined);
    const session = await store.open({ workspaceRoot });

    expect(store.close(session.sessionId)).toBe(true);
    expect(store.read(session.sessionId)).toEqual([]);
    expect(store.resize(session.sessionId, 90, 30)).toBe(false);
    expect(store.write(session.sessionId, 'echo stale')).toBe(false);
    await expect(store.restart(session.sessionId)).resolves.toBe(false);
  });

  it('uses Windows string output without the slow bundled ConPTY implementation', () => {
    const options = terminalProcessOptions({
      cols: 80,
      cwd: 'C:\\workspace',
      env: {},
      rows: 24,
    }, 'win32');

    expect(options).toMatchObject({ useConpty: true });
    expect('useConptyDll' in options).toBe(false);
    expect('encoding' in options).toBe(false);
  });
});

function terminalSmokeCommand(): string {
  if (process.platform === 'win32') return 'echo setsuna-terminal-smoke\r\n';
  return "printf 'setsuna-terminal-smoke\\n'\n";
}

function terminalExitCommand(): string {
  return process.platform === 'win32' ? 'exit\r\n' : 'exit\n';
}

function terminalProxyCommand(): string {
  return process.platform === 'win32' ? 'echo %HTTP_PROXY%\r\n' : "printf '%s\\n' \"$HTTP_PROXY\"\n";
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error('Timed out waiting for terminal output.');
}
