import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserFaviconCoordinator,
  resolveBrowserFaviconUrls,
} from '../../src/renderer/browserFaviconCoordinator.js';

afterEach(() => vi.useRealTimers());

describe('resolveBrowserFaviconUrls', () => {
  it('keeps every supported candidate in page order and removes duplicates', () => {
    expect(resolveBrowserFaviconUrls([
      'javascript:alert(1)',
      'https://example.com/favicon.ico',
      'https://example.com/favicon.ico',
      'data:image/png;base64,aWNvbg==',
      'file:///tmp/favicon.ico',
    ])).toEqual([
      'https://example.com/favicon.ico',
      'data:image/png;base64,aWNvbg==',
    ]);
  });
});

describe('createBrowserFaviconCoordinator', () => {
  it('keeps the previous icon during navigation and uses the fallback after loading stops', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const resolve = vi.fn(async () => 'data:image/png;base64,ZmFsbGJhY2s=');
    const coordinator = createBrowserFaviconCoordinator({ onChange, resolve });

    coordinator.navigationStarted();
    expect(onChange).not.toHaveBeenCalled();
    coordinator.loadingStopped();
    await vi.advanceTimersByTimeAsync(250);
    expect(resolve).toHaveBeenCalledWith([]);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('data:image/png;base64,ZmFsbGJhY2s='));
    coordinator.dispose();
  });

  it('cancels the delayed fallback when page candidates arrive', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const resolve = vi.fn(async (candidates: readonly string[]) => candidates[0] ?? null);
    const coordinator = createBrowserFaviconCoordinator({ onChange, resolve });

    coordinator.navigationStarted();
    coordinator.loadingStopped();
    coordinator.faviconUpdated(['https://example.com/icon.png']);
    await vi.advanceTimersByTimeAsync(250);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(['https://example.com/icon.png']);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('https://example.com/icon.png'));
    coordinator.dispose();
  });

  it('ignores a favicon request that finishes after the next navigation starts', async () => {
    let finishRequest: (value: string | null) => void = () => undefined;
    const pendingRequest = new Promise<string | null>((resolve) => { finishRequest = resolve; });
    const onChange = vi.fn();
    const resolve = vi.fn()
      .mockReturnValueOnce(pendingRequest)
      .mockResolvedValueOnce('https://new.example/icon.png');
    const coordinator = createBrowserFaviconCoordinator({
      onChange,
      resolve,
    });

    coordinator.faviconUpdated(['https://old.example/icon.png']);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    coordinator.navigationStarted();
    finishRequest('data:image/png;base64,b2xk');
    coordinator.faviconUpdated(['https://new.example/icon.png']);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('https://new.example/icon.png'));
    coordinator.dispose();
  });
});
