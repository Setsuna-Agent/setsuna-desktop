import type {
  RuntimePluginUiContribution,
  RuntimePluginUiData,
  RuntimePluginUiTextSource,
} from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

const EMPTY_DATA: RuntimePluginUiData = Object.freeze({});

export type DeclarativePluginUiDataState = Readonly<{
  data: RuntimePluginUiData;
  hasSnapshot: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
}>;

type InternalDataState = DeclarativePluginUiDataState & Readonly<{ identity: string }>;

export function useDeclarativePluginUiData({
  contribution,
  pluginId,
  projectId,
  service,
  threadId,
}: Readonly<{
  contribution: RuntimePluginUiContribution;
  pluginId: string;
  projectId?: string;
  service: PluginManagementRendererService;
  threadId?: string;
}>): DeclarativePluginUiDataState {
  const identity = `${pluginId}\u0000${contribution.id}\u0000${projectId ?? ''}\u0000${threadId ?? ''}`;
  const [state, setState] = useState<InternalDataState>(() => Object.freeze({
    data: EMPTY_DATA,
    hasSnapshot: false,
    identity,
    status: contribution.data ? 'loading' : 'idle',
  }));
  const requestSequence = useRef(0);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  const refresh = useCallback(async () => {
    if (identity !== currentIdentity.current) return;
    const dataDeclaration = contribution.data;
    const sequence = ++requestSequence.current;
    if (!dataDeclaration) {
      setState(Object.freeze({ data: EMPTY_DATA, hasSnapshot: false, identity, status: 'idle' }));
      return;
    }
    if (
      (dataDeclaration.scope === 'project' && !projectId)
      || (dataDeclaration.scope === 'thread' && !threadId)
    ) {
      setState(Object.freeze({ data: EMPTY_DATA, hasSnapshot: false, identity, status: 'error' }));
      return;
    }
    setState((current) => Object.freeze({
      data: current.identity === identity ? current.data : EMPTY_DATA,
      hasSnapshot: current.identity === identity && current.hasSnapshot,
      identity,
      status: 'loading',
    }));
    try {
      const result = await service.readRendererUiData({
        pluginId,
        context: {
          contributionId: contribution.id,
          surface: contribution.slot,
          ...(projectId ? { projectId } : {}),
          ...(threadId ? { threadId } : {}),
        },
      });
      if (sequence !== requestSequence.current || identity !== currentIdentity.current) return;
      setState(Object.freeze({ data: result.data, hasSnapshot: true, identity, status: 'ready' }));
    } catch {
      if (sequence !== requestSequence.current || identity !== currentIdentity.current) return;
      setState((current) => Object.freeze({
        data: current.identity === identity && current.hasSnapshot ? current.data : EMPTY_DATA,
        hasSnapshot: current.identity === identity && current.hasSnapshot,
        identity,
        status: 'error',
      }));
    }
  }, [contribution, identity, pluginId, projectId, service, threadId]);

  useEffect(() => {
    void refresh();
    const unsubscribeSnapshot = contribution.data
      ? service.subscribe(() => void refresh())
      : () => undefined;
    const unsubscribeData = contribution.data
      ? service.subscribeRendererUiData(pluginId, () => void refresh())
      : () => undefined;
    return () => {
      requestSequence.current += 1;
      unsubscribeData();
      unsubscribeSnapshot();
    };
  }, [contribution.data, pluginId, refresh, service]);

  const visibleState = state.identity === identity
    ? state
    : Object.freeze({
      data: EMPTY_DATA,
      hasSnapshot: false,
      status: contribution.data ? 'loading' as const : 'idle' as const,
    });
  return Object.freeze({
    data: visibleState.data,
    hasSnapshot: visibleState.hasSnapshot,
    status: visibleState.status,
  });
}

export function resolveRuntimePluginUiText(
  source: RuntimePluginUiTextSource | undefined,
  data: RuntimePluginUiData,
): string {
  if (source === undefined) return '';
  if (typeof source === 'string') return source;
  let current: unknown = data;
  for (const segment of source.path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, segment)) {
      return source.fallback ?? '';
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
    return String(current);
  }
  return source.fallback ?? '';
}
