import {
  parseSandboxedUiSource,
  type RuntimePluginUiDocumentContribution,
  type RuntimeSandboxedUiSource,
} from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { useEffect, useState } from 'react';
import { loadSandboxedUiLibraries } from '../sandboxed-plugin-ui/sandbox-libraries.js';

const EMPTY_SOURCE: RuntimeSandboxedUiSource = Object.freeze({ html: '', css: '', js: '' });

type SourceState = Readonly<{
  source: RuntimeSandboxedUiSource;
  libraryScripts?: readonly string[];
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
    void Promise.all([
      service.readRendererUiDocument({
        pluginId,
        contributionId: contribution.id,
      }, { signal: controller.signal }),
      loadSandboxedUiLibraries(contribution.document.libraries),
    ]).then(([result, libraryScripts]) => {
      if (!current) return;
      setState({ source: parseSandboxedUiSource(result, 'Plugin page source'), libraryScripts, status: 'ready' });
    }).catch(() => {
      if (current && !controller.signal.aborted) setState({ source: EMPTY_SOURCE, status: 'error' });
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [contribution.id, contribution.document.libraries, pluginId, revision, service]);

  return state;
}
