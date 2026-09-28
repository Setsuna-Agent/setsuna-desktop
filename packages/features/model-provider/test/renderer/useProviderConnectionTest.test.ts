// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProviderConnectionTest, type ProviderConnectionTester } from '../../src/renderer/useProviderConnectionTest.js';

afterEach(cleanup);

describe('useProviderConnectionTest', () => {
  it('uses the current API key draft and prevents duplicate concurrent requests', async () => {
    const pending = deferred();
    const test = vi.fn<ProviderConnectionTester>(() => pending.promise);
    const { result } = renderHook(() => useProviderConnectionTest(provider, ' draft-secret ', test));
    let request!: Promise<void>;
    act(() => {
      request = result.current.runTest();
      void result.current.runTest();
    });
    expect(test).toHaveBeenCalledOnce();
    expect(test.mock.calls[0]?.[0]).toMatchObject({ apiKey: 'draft-secret', baseUrl: provider.baseUrl });
    await act(async () => { pending.resolve(); await request; });
    expect(result.current.result).toEqual({ ok: true });
    expect(result.current.testing).toBe(false);
  });

  it.each(['success', 'failure'])('cancels obsolete tests and suppresses late %s results', async (outcome) => {
    const old = deferred();
    const current = deferred();
    const test = vi.fn<ProviderConnectionTester>()
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => current.promise);
    const { result, rerender, unmount } = renderHook(
      (connection) => useProviderConnectionTest(connection, '', test),
      { initialProps: provider },
    );
    let oldRequest!: Promise<void>;
    act(() => { oldRequest = result.current.runTest(); });
    rerender({ ...provider, baseUrl: 'https://edited.example/v1' });
    expect(test.mock.calls[0]?.[1].aborted).toBe(true);
    let currentRequest!: Promise<void>;
    act(() => { currentRequest = result.current.runTest(); });
    await act(async () => {
      if (outcome === 'success') old.resolve();
      else old.reject(new Error('Obsolete failure'));
      await oldRequest;
    });
    expect(result.current.result).toBeNull();
    expect(result.current.testing).toBe(true);
    unmount();
    expect(test.mock.calls[1]?.[1].aborted).toBe(true);
    await act(async () => { current.resolve(); await currentRequest; });
  });
});

const provider: ProviderConfigState = {
  id: 'provider-test', name: 'Test', provider: 'openai-compatible',
  baseUrl: 'https://models.example/v1', enabled: true,
  apiKeySet: true, apiKeyPreview: 'saved-key', models: [],
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
