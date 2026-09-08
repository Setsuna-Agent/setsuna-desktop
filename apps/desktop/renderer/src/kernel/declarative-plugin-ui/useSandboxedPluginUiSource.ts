import {
  parseSandboxedUiSource,
  type RuntimePluginUiDocumentContribution,
  type RuntimeSandboxedUiSource,
} from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { useEffect, useState } from 'react';

const EMPTY_SOURCE: RuntimeSandboxedUiSource = Object.freeze({ html: '', css: '', js: '' });

type SourceState = Readonly<{
  source: RuntimeSandboxedUiSource;
  status: 'loading' | 'ready' | 'error';
}>;

export function useSandboxedPluginUiSource({
  contribution,
  pluginId,
  revision,
  service,
}: Readonly<{
  contribution: RuntimePluginUiDocumentContribution;
  pluginId: string;
  revision: string;
  service: PluginManagementRendererService;
}>): SourceState {
  const [state, setState] = useState<SourceState>(() => ({ source: EMPTY_SOURCE, status: 'loading' }));

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ source: EMPTY_SOURCE, status: 'loading' });
    void service.readRendererUiDocument({
      pluginId,
      contributionId: contribution.id,
    }, { signal: controller.signal }).then((result) => {
      if (!current) return;
      setState({ source: parseSandboxedUiSource(result, 'Plugin page source'), status: 'ready' });
    }).catch(() => {
      if (current && !controller.signal.aborted) setState({ source: EMPTY_SOURCE, status: 'error' });
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [contribution.id, pluginId, revision, service]);

  return state;
}
