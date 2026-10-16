import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { BrowserDebuggerTransport } from '../../../src/main/cdp/automation.js';
import { hasActiveMediaCapture } from '../../../src/main/cdp/media-capture.js';

it.each(['failure', 'cancelled'] as const)('releases inspection resources after a %s without turning it into a safe-to-sleep result', async (mode) => {
  const events = new EventEmitter();
  const failure = new Error('Media inspection interrupted');
  const sendCommand = vi.fn(async (method: string) => {
    if (method === 'Runtime.enable') {
      events.emit('message', {}, 'Runtime.executionContextCreated', {
        context: { id: 1, uniqueId: 'context-1', auxData: { frameId: 'frame-1' } },
      }, '');
    }
    if (method === 'Runtime.evaluate') return { result: { type: 'object', objectId: 'prototype-1' } };
    if (method === 'Runtime.queryObjects') {
      if (mode === 'failure') throw failure;
      return new Promise(() => undefined);
    }
    return {};
  });
  const transport = Object.assign(events, { sendCommand }) as unknown as BrowserDebuggerTransport;
  const controller = new AbortController();
  const result = hasActiveMediaCapture(transport, () => [undefined], controller.signal).catch(error => error);
  if (mode === 'cancelled') {
    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([method]) => method === 'Runtime.queryObjects')).toBe(true));
    controller.abort(failure);
  }
  expect(await result).toBe(failure);
  expect(events.listenerCount('message')).toBe(0);
  expect(sendCommand).toHaveBeenCalledWith('Runtime.releaseObjectGroup', { objectGroup: expect.stringContaining('setsuna-media-capture-') }, undefined);
  expect(sendCommand).toHaveBeenCalledWith('Runtime.disable', {}, undefined);
});
