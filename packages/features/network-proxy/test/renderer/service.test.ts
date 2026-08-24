import type { DesktopNetworkProxyState } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { NetworkProxyDesktopBridge } from '../../src/contracts/index.js';
import { NetworkProxyRendererStateService } from '../../src/renderer/service.js';

describe('NetworkProxyRendererStateService', () => {
  it('keeps a pushed state when initial loading completes late and ignores pushes after disposal', async () => {
    const initial = deferred<DesktopNetworkProxyState>();
    let pushState: ((state: DesktopNetworkProxyState) => void) | null = null;
    const unsubscribe = vi.fn();
    const bridge = {
      deleteServer: vi.fn(),
      getState: vi.fn(() => initial.promise),
      onStateChange: vi.fn((listener: (state: DesktopNetworkProxyState) => void) => {
        pushState = listener;
        return unsubscribe;
      }),
      setRouting: vi.fn(),
      upsertServer: vi.fn(),
    } as NetworkProxyDesktopBridge;
    const service = new NetworkProxyRendererStateService(bridge);
    service.start();

    const pushed = proxyState('pushed');
    pushState?.(pushed);
    initial.resolve(proxyState('initial'));
    await initial.promise;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(service.snapshot()).toMatchObject({ loading: false, state: pushed });

    service.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    pushState?.(proxyState('late'));
    expect(service.snapshot().state).toBe(pushed);
  });
});

function proxyState(name: string): DesktopNetworkProxyState {
  return {
    configPath: '/tmp/network-proxy.json',
    servers: [{
      id: name,
      name,
      passwordSet: false,
      url: 'http://127.0.0.1:7890',
    }],
    routing: {
      global: { mode: 'system' },
      scopes: {
        browser: { mode: 'inherit' },
        runtime: { mode: 'inherit' },
        sync: { mode: 'inherit' },
        terminal: { mode: 'inherit' },
        updater: { mode: 'inherit' },
      },
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
