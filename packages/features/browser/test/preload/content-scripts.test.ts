import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { USER_SCRIPTS_CHANNELS as channels, type ContentScriptExecution } from '../../src/contracts/user-scripts.js';

const electron = vi.hoisted(() => ({
  ipc: new Map<string, (...args: unknown[]) => void>(), send: vi.fn(), isolated: vi.fn(), main: vi.fn(), info: vi.fn(),
}));
vi.mock('electron', () => ({ ipcRenderer: {
  on: (channel: string, listener: (...args: unknown[]) => void) => electron.ipc.set(channel, listener), send: electron.send,
}, webFrame: { setIsolatedWorldInfo: electron.info, executeJavaScriptInIsolatedWorld: electron.isolated, executeJavaScript: electron.main } }));
import { initializeContentScripts } from '../../src/preload/content-scripts.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); electron.ipc.clear(); vi.clearAllMocks(); });

function harness() {
  vi.useFakeTimers();
  const document = Object.assign(new EventEmitter(), { readyState: 'loading' });
  const window = new EventEmitter();
  for (const target of [document, window]) {
    Object.assign(target, { addEventListener: (name: string, listener: () => void, options?: { once?: boolean }) =>
      options?.once ? target.once(name, listener) : target.on(name, listener), removeEventListener: target.off.bind(target) });
  }
  vi.stubGlobal('document', document); vi.stubGlobal('window', window);
  electron.main.mockResolvedValue(42); electron.isolated.mockResolvedValue(42);
  initializeContentScripts(() => 'document');
  const inject = (extensionId: string, token: number, immediate = false) => {
    const execution: ContentScriptExecution = { extensionId, token, documentId: 'document', world: 'ISOLATED', code: ['42'], injectImmediately: immediate };
    electron.ipc.get(channels.scripting)!({}, execution);
  };
  return { inject, document, finish() { document.readyState = 'complete'; document.emit('DOMContentLoaded'); window.emit('load'); } };
}

it('executes immediate requests during loading and waits for idle by default', async () => {
  const runner = harness();
  runner.inject('one', 1); runner.inject('one', 2, true);
  await vi.runAllTimersAsync();
  expect(electron.send).toHaveBeenCalledExactlyOnceWith(channels.answer, { token: 2, result: 42 });
  runner.finish(); await vi.runAllTimersAsync();
  expect(electron.send).toHaveBeenLastCalledWith(channels.answer, { token: 1, result: 42 });
  expect(electron.info).toHaveBeenCalledTimes(1);
});

it('cancels unloaded extensions queued before idle while retaining unrelated work and allowing new requests', async () => {
  const runner = harness(); runner.inject('one', 1); runner.inject('two', 2);
  electron.ipc.get(channels.invalidate)!({}, { extensionId: 'one' });
  runner.finish(); await vi.runAllTimersAsync();
  expect(electron.send).toHaveBeenCalledWith(channels.answer, { token: 1, error: 'Script execution cancelled.' });
  expect(electron.send).toHaveBeenCalledWith(channels.answer, { token: 2, result: 42 });
  expect(electron.isolated).toHaveBeenCalledTimes(1);
  runner.inject('one', 3); await vi.runAllTimersAsync();
  expect(electron.send).toHaveBeenLastCalledWith(channels.answer, { token: 3, result: 42 });
  expect(electron.isolated).toHaveBeenCalledTimes(2);
});
