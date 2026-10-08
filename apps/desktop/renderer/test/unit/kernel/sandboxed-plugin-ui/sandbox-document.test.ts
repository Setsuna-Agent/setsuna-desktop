// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createSandboxedUiDocument,
  SANDBOXED_UI_CHANNEL,
} from '../../../../src/kernel/sandboxed-plugin-ui/sandbox-document.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each([true, false])('keeps invoke pending during a long confirmation and delivers the host result (ok: %s)', async (ok) => {
  const { api, post, reply } = bootstrapBridge();
  const resolve = vi.fn();
  const reject = vi.fn();
  const settled = api.invoke('table.save', { rows: [] }).then(resolve, reject);
  const request = post.mock.lastCall?.[0];
  expect(request).toMatchObject({ type: 'invoke', actionId: 'table.save', payload: { rows: [] } });

  await vi.advanceTimersByTimeAsync(300_000);
  expect(resolve).not.toHaveBeenCalled();
  expect(reject).not.toHaveBeenCalled();

  reply({ type: 'action-result', requestId: request?.requestId, ok, error: 'Host action failed.' });
  await settled;
  if (ok) {
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ status: 'completed' });
    expect(reject).not.toHaveBeenCalled();
  } else {
    expect(reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Host action failed.' }));
    expect(resolve).not.toHaveBeenCalled();
  }
});

it('retains the runtime API transport timeout', async () => {
  const { api } = bootstrapBridge();
  const reject = vi.fn();
  const settled = api.runtime.request({ path: '/v1/projects' }).catch(reject);
  await vi.advanceTimersByTimeAsync(130_001);
  await settled;
  expect(reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Host request timed out.' }));
});

function bootstrapBridge() {
  const post = vi.fn<(message: Record<string, unknown>) => void>();
  const parent = { postMessage: vi.fn() };
  const port = { postMessage: post, onmessage: null as ((event: { data: unknown }) => void) | null,
    start: vi.fn(), close: vi.fn() };
  const window = {
    addEventListener: vi.fn(),
  } as unknown as {
    setsunaUI: {
      invoke(actionId: string, payload: unknown): Promise<unknown>;
      runtime: { request(input: unknown): Promise<unknown> };
    };
  };
  // Execute the generated iframe bridge, rather than checking source strings.
  const source = createSandboxedUiDocument({ html: '', css: '', js: '' });
  const bootstrap = new DOMParser().parseFromString(source, 'text/html').querySelector('script')?.textContent;
  if (!bootstrap) throw new Error('Sandbox bootstrap is missing.');
  new Function('window', 'parent', 'document', 'setTimeout', 'clearTimeout', 'MessageChannel', bootstrap)(
    window, parent, { readyState: 'loading', addEventListener: vi.fn() }, setTimeout, clearTimeout,
    class { port1 = port; port2 = {}; },
  );
  return {
    api: window.setsunaUI,
    post,
    reply: (data: Record<string, unknown>) => port.onmessage?.({ data: { channel: SANDBOXED_UI_CHANNEL, ...data } }),
  };
}
