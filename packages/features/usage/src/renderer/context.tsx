import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  createNoopUsageRendererStateService,
  type UsageRendererStateController,
  type UsageRendererStateService,
  type UsageRendererStateSnapshot,
} from '../contracts/index.js';
import type { UsageRendererHost } from './capabilities.js';

type UsageRendererContextValue = Readonly<{
  host: UsageRendererHost;
  service: UsageRendererStateService;
  translate: RendererTranslate;
}>;

const EMPTY_SERVICE = createNoopUsageRendererStateService();
const UsageRendererContext = createContext<UsageRendererContextValue | null>(null);

export function UsageRendererProvider({
  children,
  host,
  service,
  translate,
}: Readonly<{
  children: ReactNode;
  host: UsageRendererHost;
  service: UsageRendererStateService;
  translate: RendererTranslate;
}>) {
  const value = useMemo(() => ({ host, service, translate }), [host, service, translate]);
  return <UsageRendererContext.Provider value={value}>{children}</UsageRendererContext.Provider>;
}

export function useUsageRendererContext(): UsageRendererContextValue {
  const value = useContext(UsageRendererContext);
  if (!value) throw new Error('UsageRendererProvider is missing.');
  return value;
}

export function useUsageRendererService(): UsageRendererStateService {
  return useUsageRendererContext().service;
}

export function useUsageThreadState(
  threadId: string | null | undefined,
): UsageRendererStateSnapshot {
  const { service } = useUsageRendererContext();
  const controller = useMemo<UsageRendererStateController>(
    () => threadId ? service.controller(threadId) : EMPTY_SERVICE.controller(''),
    [service, threadId],
  );
  const subscribe = useCallback(
    (listener: (snapshot: UsageRendererStateSnapshot) => void) => controller.subscribe(listener),
    [controller],
  );
  const snapshot = useCallback(() => controller.snapshot(), [controller]);
  return useSyncExternalStore(
    subscribe,
    snapshot,
    snapshot,
  );
}
