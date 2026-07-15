import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DesktopTerminalStore, type DesktopTerminalEvent } from './terminal-sessions.js';

describe('desktop terminal store', () => {
  it('opens a shell session and reads command output', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-test-'));
    const events: DesktopTerminalEvent[] = [];
    const store = new DesktopTerminalStore((event) => events.push(event));
    const session = await store.open({ workspaceRoot, cols: 80, rows: 24 });

    expect(session.workspaceRoot).toBe(await realpath(workspaceRoot));

    store.write(session.sessionId, terminalSmokeCommand());
    await waitFor(() => events.some((event) => event.event === 'output' && String(event.data.text ?? '').includes('setsuna-terminal-smoke')));

    const queuedEvents = store.read(session.sessionId);
    expect(queuedEvents.some((event) => event.event === 'output' && String(event.data.text ?? '').includes('setsuna-terminal-smoke'))).toBe(true);
    expect(queuedEvents.every((event) => Number.isInteger(event.seq) && event.seq > 0)).toBe(true);
    expect(queuedEvents.map((event) => event.seq)).toEqual([...queuedEvents].sort((left, right) => left.seq - right.seq).map((event) => event.seq));
    expect(store.close(session.sessionId)).toBe(true);
  });

  it('retains an exited session and can restart it in place', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-restart-test-'));
    const events: DesktopTerminalEvent[] = [];
    const store = new DesktopTerminalStore((event) => events.push(event));
    const session = await store.open({ workspaceRoot, cols: 80, rows: 24 });

    store.write(session.sessionId, terminalExitCommand());
    await waitFor(() => events.some((event) => event.event === 'exit'));

    expect(store.read(session.sessionId).some((event) => event.event === 'exit')).toBe(true);
    expect(() => store.write(session.sessionId, terminalSmokeCommand())).toThrow('重新启动');
    expect(store.restart(session.sessionId, 90, 30)).toBe(true);
    store.write(session.sessionId, terminalSmokeCommand());
    await waitFor(() => events.some((event) => event.event === 'output' && String(event.data.text ?? '').includes('setsuna-terminal-smoke')));

    expect(store.close(session.sessionId)).toBe(true);
  });
});

function terminalSmokeCommand(): string {
  if (process.platform === 'win32') return 'echo setsuna-terminal-smoke\r\n';
  return "printf 'setsuna-terminal-smoke\\n'\n";
}

function terminalExitCommand(): string {
  return process.platform === 'win32' ? 'exit\r\n' : 'exit\n';
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error('Timed out waiting for terminal output.');
}
