import { useCallback, useMemo, useState } from 'react';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import type { BrowserPanelDescriptor, BrowserPanelMetadataPatch } from '@setsuna-desktop/feature-browser/contracts';
import {
  BrowserWorkspaceFeatureBoundary,
  type BrowserNotify,
  type BrowserWorkspacePanelHost,
} from '../../composition/BrowserWorkspaceFeatureBoundary.js';
import { RendererOwnedKeyedSlot } from '../renderer-plugins/RendererKernelProvider.js';
import { useToast } from '../../app/providers/ToastProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SelectField } from '../../shared/ui/primitives.js';

export function PluginWebPageView({ id, title, url }: Readonly<{ id: string; title: string; url: string }>) {
  const { t } = useI18n();
  const toast = useToast();
  const [panel, setPanel] = useState<BrowserPanelDescriptor>(() => ({
    id, title, browser: { url, loading: true, faviconUrl: null },
  }));
  const updatePanel = useCallback((_id: string, patch: BrowserPanelMetadataPatch) => {
    setPanel(current => ({ ...current, ...patch }));
  }, []);
  const notify = useCallback<BrowserNotify>((tone, message) => { toast.show(message, { tone }); }, [toast]);
  const host = useMemo<BrowserWorkspacePanelHost>(() => ({
    bridge: window.setsunaDesktop?.browser ?? null,
    notify,
    openExternal: destination => { void window.setsunaDesktop?.links.openExternal(destination); },
    resolveBinding: surfaceId => surfaceId === id ? { panel, onPanelMetadataChange: updatePanel, windowOpenMode: 'current-tab' } : null,
    selectField: SelectField,
  }), [id, notify, panel, updatePanel]);
  return (
    <BrowserWorkspaceFeatureBoundary host={host}>
      <div className="plugin-webpage">
        <RendererOwnedKeyedSlot entryKey="browser" instanceKey={id} slot={workspacePanelSlot} props={{
          panelId: id, panelType: 'browser', placement: 'side', projectId: null, surfaceInstanceId: id,
          threadId: null, translate: t, visible: true, renderDefault: () => null,
        }} />
      </div>
    </BrowserWorkspaceFeatureBoundary>
  );
}
