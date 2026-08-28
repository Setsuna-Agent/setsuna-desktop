// @vitest-environment happy-dom

import type { RuntimeHookListResponse } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useRuntimeCapabilityState,
  type RuntimeCapabilityClient,
} from '../../../../src/services/runtime-client/useRuntimeCapabilityState.js';

afterEach(cleanup);

describe('useRuntimeCapabilityState', () => {
  it('does not let an older project Hook refresh replace the current project state', async () => {
    const first = deferred<RuntimeHookListResponse>();
    const second = deferred<RuntimeHookListResponse>();
    const listHooks = vi.fn((cwds?: string[]) => (
      cwds?.[0] === '/workspace/one' ? first.promise : second.promise
    ));
    const client = {
      listHooks,
    } as unknown as RuntimeCapabilityClient;
    const { result, rerender } = renderHook(
      ({ activeProjectPath }) => useRuntimeCapabilityState({
        activeProjectPath,
        client,
        config: null,
        enabled: false,
        onConfigChange: vi.fn(),
      }),
      { initialProps: { activeProjectPath: '/workspace/one' } },
    );

    const staleRefresh = result.current.refreshCapabilities();
    rerender({ activeProjectPath: '/workspace/two' });
    const currentRefresh = result.current.refreshCapabilities();
    second.resolve(hookList('/workspace/two'));
    await act(async () => currentRefresh);
    first.resolve(hookList('/workspace/one'));
    await act(async () => staleRefresh);

    expect(result.current.hookState?.data[0]?.cwd).toBe('/workspace/two');
  });

  it('refreshes Hook config and discovery as one Plugin dependency update', async () => {
    const config = { providers: [] } as never;
    const onConfigChange = vi.fn();
    const client = {
      getConfig: vi.fn(async () => config),
      listHooks: vi.fn(async () => hookList('/workspace/current')),
    } as unknown as RuntimeCapabilityClient;
    const { result } = renderHook(() => useRuntimeCapabilityState({
      activeProjectPath: '/workspace/current',
      client,
      config: null,
      enabled: false,
      onConfigChange,
    }));

    await act(async () => result.current.refreshCapabilityDependencies());

    expect(client.listHooks).toHaveBeenCalledWith(['/workspace/current']);
    expect(onConfigChange).toHaveBeenCalledWith(config);
    expect(result.current.hookState?.data[0]?.cwd).toBe('/workspace/current');
  });
});

function hookList(cwd: string): RuntimeHookListResponse {
  return { data: [{ cwd, errors: [], hooks: [], warnings: [] }] };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
