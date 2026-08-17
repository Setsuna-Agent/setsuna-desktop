// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchSecondaryRoutes } from '../../../../src/app/layout/secondaryRoutePrefetch.js';
import { useSecondaryRoutePrefetch } from '../../../../src/app/layout/useSecondaryRoutePrefetch.js';

vi.mock('../../../../src/app/layout/secondaryRoutePrefetch.js', () => ({
  prefetchSecondaryRoutes: vi.fn(),
}));

function PrefetchProbe() {
  useSecondaryRoutePrefetch();
  return null;
}

describe('useSecondaryRoutePrefetch', () => {
  beforeEach(() => {
    vi.mocked(prefetchSecondaryRoutes).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('主界面稳定后登记空闲回调预热路由模块', () => {
    vi.useFakeTimers();
    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
      idleCallbacks.push(callback);
      return 7;
    });
    vi.stubGlobal('cancelIdleCallback', () => {
      idleCallbacks.length = 0;
    });

    render(<PrefetchProbe />);
    vi.advanceTimersByTime(1_500);

    // 延迟到期后只登记空闲回调，不立即预热。
    expect(idleCallbacks).toHaveLength(1);
    expect(prefetchSecondaryRoutes).not.toHaveBeenCalled();

    idleCallbacks[0]?.();

    expect(prefetchSecondaryRoutes).toHaveBeenCalledTimes(1);
  });

  it('无 requestIdleCallback 时延迟后直接预热', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.stubGlobal('cancelIdleCallback', undefined);

    render(<PrefetchProbe />);
    vi.advanceTimersByTime(1_499);
    expect(prefetchSecondaryRoutes).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(prefetchSecondaryRoutes).toHaveBeenCalledTimes(1);
  });

  it('空闲回调执行前卸载时取消预热', () => {
    vi.useFakeTimers();
    const cancelIdleCallback = vi.fn(() => undefined);
    let idleCallback: (() => void) | null = null;
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
      idleCallback = callback;
      return 7;
    });
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

    const view = render(<PrefetchProbe />);
    vi.advanceTimersByTime(1_500);
    expect(idleCallback).not.toBeNull();

    view.unmount();
    vi.advanceTimersByTime(5_000);

    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(prefetchSecondaryRoutes).not.toHaveBeenCalled();
  });
});
