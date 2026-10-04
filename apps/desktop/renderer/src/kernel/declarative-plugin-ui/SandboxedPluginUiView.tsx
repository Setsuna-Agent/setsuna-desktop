import { useConfirm } from '@setsuna-desktop/renderer-ui';
import type {
  RuntimeApiRequest,
  RuntimePluginUiActionInput,
  RuntimePluginUiData,
  RuntimePluginUiDocumentContribution,
  RuntimePluginUiManifest,
} from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { useCallback, useMemo } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SandboxedUiFrame } from '../sandboxed-plugin-ui/SandboxedUiFrame.js';
import { useDeclarativePluginUiData } from './useDeclarativePluginUiData.js';
import { useSandboxedPluginUiSource } from './useSandboxedPluginUiSource.js';

export function SandboxedPluginUiView({
  contribution,
  cwd,
  manifest,
  pluginId,
  projectId,
  revision,
  service,
  threadId,
  title,
}: Readonly<{
  contribution: RuntimePluginUiDocumentContribution;
  cwd?: string;
  manifest: RuntimePluginUiManifest;
  pluginId: string;
  projectId?: string;
  revision: string;
  service: PluginManagementRendererService;
  threadId?: string;
  title?: string;
}>) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const sourceState = useSandboxedPluginUiSource({ contribution, pluginId, revision, service });
  const dataState = useDeclarativePluginUiData({ contribution, pluginId, projectId, service, threadId });
  const actions = useMemo(() => new Map(manifest.actions.map((action) => [action.id, action])), [manifest]);
  const context = useMemo<RuntimePluginUiData>(() => Object.freeze({
    pluginId,
    contributionId: contribution.id,
    surface: contribution.slot,
    ...(cwd ? { cwd } : {}),
    ...(projectId ? { projectId } : {}),
    ...(threadId ? { threadId } : {}),
  }), [contribution.id, contribution.slot, cwd, pluginId, projectId, threadId]);

  const runAction = useCallback(async (actionId: string, payload: RuntimePluginUiData) => {
    const action = actions.get(actionId);
    if (!action || !contribution.document.actionIds.includes(actionId)) {
      throw new Error('Plugin page action is not declared.');
    }
    if (action.approval && !await confirm({
      title: action.approval.title ?? t('pluginUi.confirmAction'),
      description: action.approval.message,
    })) throw new Error('Plugin page action was cancelled.');
    const input: RuntimePluginUiActionInput = Object.freeze({
      pluginId,
      actionId,
      values: Object.freeze({}),
      payload,
      context: Object.freeze({
        contributionId: contribution.id,
        ...(cwd ? { cwd } : {}),
        surface: contribution.slot,
        ...(projectId ? { projectId } : {}),
        ...(threadId ? { threadId } : {}),
      }),
    });
    await service.runRendererUiAction(input);
  }, [actions, confirm, contribution, cwd, pluginId, projectId, service, t, threadId]);

  const requestRuntime = useCallback((request: RuntimeApiRequest, signal: AbortSignal) => (
    service.requestRuntimeApi({ pluginId, contributionId: contribution.id, request }, { signal })
  ), [contribution.id, pluginId, service]);

  if (sourceState.status !== 'ready') {
    return (
      <div
        className={`sandboxed-plugin-ui__status is-${sourceState.status}`}
        role={sourceState.status === 'error' ? 'alert' : 'status'}
      >
        {t(sourceState.status === 'error' ? 'pluginUi.documentUnavailable' : 'pluginUi.documentLoading')}
      </div>
    );
  }
  if (contribution.data && !dataState.hasSnapshot) {
    const failed = dataState.status === 'error';
    return (
      <div
        className={`sandboxed-plugin-ui__status is-${dataState.status}`}
        role={failed ? 'alert' : 'status'}
      >
        {t(failed ? 'pluginUi.dataUnavailable' : 'pluginUi.dataLoading')}
      </div>
    );
  }
  return (
    <SandboxedUiFrame
      allowedActionIds={contribution.document.actionIds}
      className="sandboxed-plugin-ui__frame"
      context={context}
      data={dataState.data}
      libraryScripts={sourceState.libraryScripts}
      onAction={runAction}
      onRuntimeRequest={contribution.slot === 'renderer.plugin.page' ? requestRuntime : undefined}
      size="fill"
      source={sourceState.source}
      title={title ?? contribution.navigation?.label ?? pluginId}
    />
  );
}
