import type {
  RuntimePluginUiContribution,
  RuntimePluginUiData,
  RuntimePluginUiTextSource,
} from '@setsuna-desktop/contracts';
import { runtimePluginUiSecretFields } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

const EMPTY_DATA: RuntimePluginUiData = Object.freeze({});
const EMPTY_SECRETS: readonly string[] = Object.freeze([]);

export type DeclarativePluginUiDataState = Readonly<{
  data: RuntimePluginUiData;
  configuredSecrets: readonly string[];
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
  // Global data must not discard a cached page's draft when the chat context changes.
  const scope = contribution.data?.scope;
  const readsData = Boolean(contribution.data || runtimePluginUiSecretFields(contribution.tree).length);
  const scopeId = scope === 'project' ? projectId : scope === 'thread' ? threadId : undefined;
  const identity = `${pluginId}\u0000${contribution.id}\u0000${scope ?? 'global'}\u0000${scopeId ?? ''}`;
  const [state, setState] = useState<InternalDataState>(() => Object.freeze({
    data: EMPTY_DATA,
    configuredSecrets: EMPTY_SECRETS,
    hasSnapshot: false,
    identity,
    status: readsData ? 'loading' : 'idle',
  }));
  const requestSequence = useRef(0);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  const refresh = useCallback(async () => {
    if (identity !== currentIdentity.current) return;
    const dataDeclaration = contribution.data;
    const sequence = ++requestSequence.current;
    if (!readsData) {
      setState(Object.freeze({ data: EMPTY_DATA, configuredSecrets: EMPTY_SECRETS, hasSnapshot: false, identity, status: 'idle' }));
      return;
    }
    if (
      (dataDeclaration?.scope === 'project' && !projectId)
      || (dataDeclaration?.scope === 'thread' && !threadId)
    ) {
      setState(Object.freeze({ data: EMPTY_DATA, configuredSecrets: EMPTY_SECRETS, hasSnapshot: false, identity, status: 'error' }));
      return;
    }
    setState((current) => Object.freeze({
      data: current.identity === identity ? current.data : EMPTY_DATA,
      configuredSecrets: current.identity === identity ? current.configuredSecrets : EMPTY_SECRETS,
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
      setState(Object.freeze({ data: result.data, configuredSecrets: result.configuredSecrets ?? EMPTY_SECRETS, hasSnapshot: true, identity, status: 'ready' }));
    } catch {
      if (sequence !== requestSequence.current || identity !== currentIdentity.current) return;
      setState((current) => Object.freeze({
        data: current.identity === identity && current.hasSnapshot ? current.data : EMPTY_DATA,
        configuredSecrets: current.identity === identity ? current.configuredSecrets : EMPTY_SECRETS,
        hasSnapshot: current.identity === identity && current.hasSnapshot,
        identity,
        status: 'error',
      }));
    }
  }, [contribution, identity, pluginId, projectId, readsData, service, threadId]);

  useEffect(() => {
    void refresh();
    const unsubscribeSnapshot = readsData
      ? service.subscribe(() => void refresh())
      : () => undefined;
    const unsubscribeData = readsData
      ? service.subscribeRendererUiData(pluginId, () => void refresh())
      : () => undefined;
    return () => {
      requestSequence.current += 1;
      unsubscribeData();
      unsubscribeSnapshot();
    };
  }, [readsData, pluginId, refresh, service]);

  const visibleState = state.identity === identity
    ? state
    : Object.freeze({
      data: EMPTY_DATA,
      configuredSecrets: EMPTY_SECRETS,
      hasSnapshot: false,
      status: readsData ? 'loading' as const : 'idle' as const,
    });
  return Object.freeze({
    data: visibleState.data,
    configuredSecrets: visibleState.configuredSecrets,
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
