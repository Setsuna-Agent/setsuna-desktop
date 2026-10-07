import { afterEach, expect, it, vi } from 'vitest';
import { installExtensionScripting } from '../../src/preload/extension-scripting.js';

afterEach(() => vi.unstubAllGlobals());

function harness(native: (...args: unknown[]) => unknown, handled = true) {
  const runtime = {} as { lastError?: { message: string } };
  const scripting = { executeScript: native };
  vi.stubGlobal('chrome', { scripting, runtime });
  const call = vi.fn(async () => ({ ok: true as const, result: { handled, result: [{ frameId: 0, result: 42 }] } }));
  installExtensionScripting({ call });
  return { scripting, runtime, call };
}

it('preserves native success and native errors when no activeTab fallback handled the request', async () => {
  const input = { target: { tabId: 1 }, func: () => 42 };
  const success = harness(vi.fn(async () => ['native']));
  expect(await success.scripting.executeScript(input)).toEqual(['native']);
  expect(success.call).not.toHaveBeenCalled();
  const nativeError = new Error('Cannot access contents of the page');
  const refused = harness(() => Promise.reject(nativeError), false);
  await expect(refused.scripting.executeScript(input)).rejects.toBe(nativeError);
  const executionError = new Error('Script execution failed');
  const failed = harness(() => Promise.reject(executionError));
  await expect(failed.scripting.executeScript(input)).rejects.toBe(executionError);
  expect(failed.call).not.toHaveBeenCalled();
});

it('snapshots function and arguments before the native Promise settles', async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise((_resolve, fail) => { reject = fail; });
  const { scripting, call } = harness(() => pending);
  const input = { target: { tabId: 1 }, func: (value: number) => value, args: [{ value: 42 }] };
  const result = scripting.executeScript(input);
  input.target.tabId = 2; input.args[0].value = 0;
  reject(new Error('Cannot access contents of the page.'));
  expect(await result).toEqual([{ frameId: 0, result: 42 }]);
  expect(call).toHaveBeenCalledExactlyOnceWith('scripting.executeScript', [{
    target: { tabId: 1 }, func: Function.prototype.toString.call(input.func), args: [{ value: 42 }],
  }]);
});

it('provides callback results and scopes lastError to failed callbacks without hiding synchronous validation', async () => {
  const input = { target: { tabId: 1 }, func: () => 42 };
  const success = harness(() => Promise.reject(new Error('Cannot access contents of the page.')));
  const callback = vi.fn();
  expect(success.scripting.executeScript(input, callback)).toBeUndefined();
  await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith([{ frameId: 0, result: 42 }]));
  const refused = harness(() => Promise.reject(new Error('Cannot access contents of the page.')), false);
  const error = await new Promise<string | undefined>(resolve => refused.scripting.executeScript(input, () => resolve(refused.runtime.lastError?.message)));
  expect(error).toBe('Cannot access contents of the page.'); expect(refused.runtime.lastError).toBeUndefined();
  const invalid = harness(() => { throw new TypeError('Invalid injection'); });
  expect(() => invalid.scripting.executeScript(input)).toThrow('Invalid injection');
  expect(invalid.call).not.toHaveBeenCalled();
});
