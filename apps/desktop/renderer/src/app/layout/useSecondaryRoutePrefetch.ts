import { useEffect } from 'react';
import { prefetchSecondaryRoutes } from './secondaryRoutePrefetch.js';

const PREFETCH_DELAY_MS = 1_500;
const PREFETCH_IDLE_TIMEOUT_MS = 5_000;

// 主界面渲染稳定后，利用浏览器空闲时段预热设置页/能力页路由模块，
// 避免首次进入时停留在“加载中…”的 Suspense 兜底屏。
export function useSecondaryRoutePrefetch() {
  useEffect(() => {
    let idleCallbackId: number | undefined;
    const timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(prefetchSecondaryRoutes, {
          timeout: PREFETCH_IDLE_TIMEOUT_MS,
        });
      } else {
        prefetchSecondaryRoutes();
      }
    }, PREFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (idleCallbackId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, []);
}
