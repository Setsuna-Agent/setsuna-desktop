import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopTerminalEvent, TerminalDesktopBridge } from '../../src/contracts/index.js';
import { subscribeTerminalEvents } from '../../src/renderer/terminalEventSubscription.js';
import { clearTerminalRestoreBuffer, terminalLastEventSeq } from '../../src/renderer/terminalRestoreBuffer.js';

const sessionId = 'terminal-subscription-test';
const history: DesktopTerminalEvent[] = [
  { seq: 1, event: 'ready', data: {} },
  { seq: 2, event: 'output', data: { text: 'user@host project % ' } },
];

afterEach(() => clearTerminalRestoreBuffer(sessionId));

describe('terminal event subscription', () => {
  it('restores the prompt before newer live output and delivers overlapping events only once', async () => {
    const snapshot = deferred<DesktopTerminalEvent[]>();
    const { bridge, emit } = createBridge();
    bridge.read.mockReturnValue(snapshot.promise);
    const received: DesktopTerminalEvent[] = [];
    const unsubscribe = subscribeTerminalEvents(bridge, sessionId, (event) => received.push(event));
    const live: DesktopTerminalEvent = { seq: 3, event: 'output', data: { text: '\u001b[?2004h' } };

    emit(live);
    expect(received).toEqual([]);
    snapshot.resolve([...history, live]);
    await snapshot.promise;

    expect(received).toEqual([...history, live]);
    const exit: DesktopTerminalEvent = { seq: 4, event: 'exit', data: { exitCode: 0 } };
    emit(exit);
    expect(received).toEqual([...history, live, exit]);
    expect(terminalLastEventSeq(sessionId)).toBe(4);
    unsubscribe();
  });

  it.each(['old-first', 'new-first'] as const)(
    'ignores a disposed panel read while its replacement restores history (%s)',
    async (responseOrder) => {
      const oldSnapshot = deferred<DesktopTerminalEvent[]>();
      const newSnapshot = deferred<DesktopTerminalEvent[]>();
      const { bridge, emit, listeners } = createBridge();
      bridge.read.mockReturnValueOnce(oldSnapshot.promise).mockReturnValueOnce(newSnapshot.promise);
      const oldReceived = vi.fn();
      const stopOld = subscribeTerminalEvents(bridge, sessionId, oldReceived);
      stopOld();
      const received: DesktopTerminalEvent[] = [];
      const stopNew = subscribeTerminalEvents(bridge, sessionId, (event) => received.push(event));
      emit({ seq: 3, event: 'output', data: { text: 'next' } });

      if (responseOrder === 'old-first') {
        oldSnapshot.resolve(history);
        await oldSnapshot.promise;
        expect(terminalLastEventSeq(sessionId)).toBe(0);
      }
      newSnapshot.resolve(history);
      await newSnapshot.promise;
      if (responseOrder === 'new-first') {
        oldSnapshot.resolve(history);
        await oldSnapshot.promise;
      }

      expect(oldReceived).not.toHaveBeenCalled();
      expect(received.map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(terminalLastEventSeq(sessionId)).toBe(3);
      stopNew();
      expect(listeners.size).toBe(0);
    },
  );

  it('skips already restored history when reattaching to a session', async () => {
    const { bridge } = createBridge();
    bridge.read.mockResolvedValue(history);
    const received = vi.fn();
    const stopFirst = subscribeTerminalEvents(bridge, sessionId, received);
    await Promise.resolve();
    stopFirst();

    const stopSecond = subscribeTerminalEvents(bridge, sessionId, received);
    await Promise.resolve();

    expect(received.mock.calls.map(([event]) => event.seq)).toEqual([1, 2]);
    stopSecond();
  });

  it('continues delivering live output if the history read fails', async () => {
    const snapshot = deferred<DesktopTerminalEvent[]>();
    const { bridge, emit } = createBridge();
    bridge.read.mockReturnValue(snapshot.promise);
    const received: DesktopTerminalEvent[] = [];
    const unsubscribe = subscribeTerminalEvents(bridge, sessionId, (event) => received.push(event));
    emit(history[0]);

    snapshot.reject(new Error('read unavailable'));
    await snapshot.promise.catch(() => undefined);
    emit(history[1]);

    expect(received).toEqual(history);
    unsubscribe();
  });
});

function createBridge() {
  const listeners = new Set<(event: DesktopTerminalEvent) => void>();
  const bridge = {
    read: vi.fn<TerminalDesktopBridge['read']>(),
    onEvent: (_sessionId: string, listener: (event: DesktopTerminalEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return { bridge, listeners, emit: (event: DesktopTerminalEvent) => listeners.forEach((listener) => listener(event)) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
