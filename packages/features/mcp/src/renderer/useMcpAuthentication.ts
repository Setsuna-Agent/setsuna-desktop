import { useEffect, useRef, useState } from 'react';
import type { McpRendererService } from '../contracts/index.js';
import type { McpTranslate } from './messages.js';

/** Login remains an abortable operation; polling only projects its public challenge/status. */
export function useMcpAuthentication(service: McpRendererService, translate: McpTranslate) {
  const controllers = useRef(new Map<string, AbortController>());
  const [pendingActions, setPendingActions] = useState<ReadonlyMap<string, 'login' | 'logout'>>(new Map());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const active = controllers.current;
    return () => { for (const controller of active.values()) controller.abort(); };
  }, []);
  useEffect(() => {
    if (!pendingActions.size) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await service.refresh({ signal: controller.signal }).catch(() => undefined);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1_000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pendingActions.size, service]);

  const run = async (serverKey: string, mode: 'login' | 'logout') => {
    if (controllers.current.has(serverKey)) return;
    const controller = new AbortController();
    controllers.current.set(serverKey, controller);
    setPendingActions((current) => new Map(current).set(serverKey, mode));
    setErrors((current) => { const next = new Map(current); next.delete(serverKey); return next; });
    try {
      await service[mode](serverKey, { signal: controller.signal });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error && 'code' in error && error.code === 'MCP_TOOL_SYNC_FAILED'
          ? translate('feature.mcp.toolSyncFailed')
          : error instanceof Error ? error.message : 'Authentication failed.';
        setErrors((current) => new Map(current).set(serverKey, message));
      }
    } finally {
      // Login also saves the discovered inventory. Publish it before dismissing the progress view.
      await service.refresh().catch(() => undefined);
      controllers.current.delete(serverKey);
      setPendingActions((current) => { const next = new Map(current); next.delete(serverKey); return next; });
    }
  };
  return { pendingActions, errors, run, cancel: (serverKey: string) => controllers.current.get(serverKey)?.abort() };
}
