// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComputerBridge, ComputerSettings } from '../../src/contracts/index.js';
import { useComputerSettings } from '../../src/renderer/useComputerSettings.js';

afterEach(cleanup);
function fixture() {
  let settings: ComputerSettings = { enabled: false, permissions: { screen: 'denied', accessibility: 'denied' } };
  const bridge: ComputerBridge = {
    status: vi.fn(async () => ({ active: false })),
    preview: vi.fn(async () => ({ active: false, frame: null })),
    stop: vi.fn(async () => undefined),
    settings: vi.fn(async () => settings),
    setEnabled: vi.fn(async () => settings),
    requestPermission: vi.fn(async () => undefined),
  };
  const hook = renderHook(() => useComputerSettings(bridge));
  return { bridge, ...hook, authorizeScreen: () => { settings = { ...settings, permissions: { ...settings.permissions, screen: 'granted' } }; } };
}

describe('computer permission settings interaction', () => {
  it('deduplicates clicks and refreshes OS permissions on return without enabling computer control', async () => {
    const f = fixture();
    await waitFor(() => expect(f.result.current.settings).not.toBeNull());
    let finish!: () => void;
    vi.mocked(f.bridge.requestPermission).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => {
      pending = f.result.current.requestPermission('screen');
      void f.result.current.requestPermission('screen');
    });
    expect(f.bridge.requestPermission).toHaveBeenCalledExactlyOnceWith('screen');
    f.authorizeScreen();
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(f.result.current.settings?.permissions.screen).toBe('granted'));
    await act(async () => { finish(); await pending; });
    expect(f.result.current.requesting).toBeNull();
    expect(f.result.current.settings?.enabled).toBe(false);
    expect(f.bridge.setEnabled).not.toHaveBeenCalled();
  });

  it('surfaces a failed system-settings launch and allows retrying', async () => {
    const f = fixture();
    await waitFor(() => expect(f.result.current.settings).not.toBeNull());
    vi.mocked(f.bridge.requestPermission).mockRejectedValueOnce(new Error('Could not open System Settings'));
    await act(async () => { await f.result.current.requestPermission('screen'); });
    expect(f.result.current.error).toContain('Could not open System Settings');
    expect(f.result.current.requesting).toBeNull();
    await act(async () => { await f.result.current.requestPermission('screen'); });
    expect(f.result.current.error).toBeNull();
    expect(f.bridge.requestPermission).toHaveBeenCalledTimes(2);
  });
});
