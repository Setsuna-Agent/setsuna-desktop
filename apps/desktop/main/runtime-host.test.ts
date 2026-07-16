import path from 'node:path';
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeHost,
  resolveBuiltinPluginsDir,
  resolveBuiltinSkillsDir,
  resolvePackagedRuntimeEntry,
  resolveRuntimeSpawnCwd,
} from './runtime-host.js';

describe('runtime host packaging paths', () => {
  it('uses a real directory for the runtime child process cwd when packaged in asar', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolveRuntimeSpawnCwd(appRoot)).toBe(path.join('/Applications/Setsuna Desktop.app/Contents/Resources'));
  });

  it('keeps the source app root as cwd during local development', () => {
    const appRoot = '/Users/zy/Documents/setsuna-desktop';

    expect(resolveRuntimeSpawnCwd(appRoot)).toBe(appRoot);
  });

  it('points packaged runtime startup at the CommonJS bundle', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolvePackagedRuntimeEntry(appRoot)).toBe(
      path.join('/Applications/Setsuna Desktop.app/Contents/Resources/app.asar/dist/runtime/cli.cjs'),
    );
  });

  it('points packaged built-in skills at the asar app root', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolveBuiltinSkillsDir(appRoot)).toBe(
      path.join('/Applications/Setsuna Desktop.app/Contents/Resources/app.asar/skills'),
    );
  });

  it('points local built-in skills at the source app root', () => {
    const appRoot = '/Users/zy/Documents/setsuna-desktop';

    expect(resolveBuiltinSkillsDir(appRoot)).toBe(path.join('/Users/zy/Documents/setsuna-desktop', 'skills'));
  });

  it('points the default plugin marketplace at the app-managed catalog', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolveBuiltinPluginsDir(appRoot)).toBe(
      path.join('/Applications/Setsuna Desktop.app/Contents/Resources/app.asar/plugins'),
    );
  });

  it('reconnects a dropped SSE stream from the last delivered sequence', async () => {
    const firstEvent = runtimeEvent(1);
    const secondEvent = runtimeEvent(2);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(firstEvent))
      .mockResolvedValueOnce(sseResponse(secondEvent));
    vi.stubGlobal('fetch', fetchMock);
    const send = vi.fn();
    const listeners = new Map<string, () => void>();
    const webContents = {
      isDestroyed: () => false,
      once: (event: string, listener: () => void) => {
        listeners.set(event, listener);
      },
      removeListener: (event: string) => {
        listeners.delete(event);
      },
      send,
    } as unknown as WebContents;
    const host = new RuntimeHost({
      appRoot: '/tmp/setsuna',
      dataDir: '/tmp/setsuna-data',
      sseRetryBaseDelayMs: 1,
    });

    const subscriptionId = host.subscribeEvents(webContents, { threadId: 'thread_1' });
    await waitFor(() => send.mock.calls.some(([, payload]) => payload.event?.seq === 2));
    host.unsubscribe(subscriptionId);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('sinceSeq=1');
    expect(send.mock.calls.filter(([, payload]) => payload.event).map(([, payload]) => payload.event.seq)).toEqual([1, 2]);
    vi.unstubAllGlobals();
  });
});

function runtimeEvent(seq: number) {
  return {
    id: `event_${seq}`,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'turn.started',
    createdAt: '2026-07-15T00:00:00.000Z',
    payload: { input: 'test', taskKind: 'regular' },
  } as const;
}

function sseResponse(event: ReturnType<typeof runtimeEvent>): Response {
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for SSE reconnect.');
}
