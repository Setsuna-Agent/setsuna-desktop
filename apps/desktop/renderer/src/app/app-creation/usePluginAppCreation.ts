import { APP_BUILDER_PLUGIN_ID, pluginAppMentionText, type RuntimePluginAppReference, type RuntimePluginReference } from '@setsuna-desktop/contracts';
import { useEffect, useRef, useState } from 'react';
import { usePluginManagementFeatureService } from '../../composition/PluginManagementFeatureBoundary.js';
import { useCapabilitiesRefreshCoordinator } from '../../composition/CapabilitiesRefreshBoundary.js';
import { useToast } from '../providers/ToastProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export type CreatePluginAppChat = (plugin: RuntimePluginReference, prompt: string) => Promise<boolean>;

export function usePluginAppCreation(onCreateApp: CreatePluginAppChat, onFocusComposer: () => void) {
  const service = usePluginManagementFeatureService();
  const capabilities = useCapabilitiesRefreshCoordinator();
  const toast = useToast();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const focusComposerOnClose = useRef(false);
  useEffect(() => () => requestRef.current?.abort(), []);

  const close = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setPending(false);
    setOpen(false);
  };
  const prepare = async (prompt: string, onCreated: () => void, onError: (message: string) => void) => {
    if (requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    setPending(true);
    setError(null);
    try {
      const installed = await service.refreshInstalled({ signal: request.signal });
      let plugin = installed.plugins.find((item) => item.id === APP_BUILDER_PLUGIN_ID);
      // Repair a missing built-in from an older installation before opening its chat.
      if (!plugin) {
        const result = await service.installMarketplace({ pluginId: APP_BUILDER_PLUGIN_ID }, { signal: request.signal });
        plugin = result.plugin;
        await capabilities.refresh(['skills']);
      }
      if (request.signal.aborted) return;
      if (await onCreateApp(plugin, prompt) && !request.signal.aborted) {
        onCreated();
      }
    } catch (cause) {
      if (!request.signal.aborted) onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setPending(false);
      }
    }
  };
  const create = (prompt: string) => prepare(prompt, () => {
    focusComposerOnClose.current = true;
    setOpen(false);
  }, setError);
  const modify = (app: RuntimePluginAppReference) => prepare(
    `${pluginAppMentionText(app)} ${t('pluginUi.modifyAppPrompt')}`, onFocusComposer, toast.error,
  );
  const onCloseAutoFocus = (event: Event) => {
    if (!focusComposerOnClose.current) return;
    focusComposerOnClose.current = false;
    // Hand off after the dialog releases focus, so its opener cannot steal Enter.
    event.preventDefault();
    onFocusComposer();
  };
  return { open, pending, error, close, create, modify, onCloseAutoFocus, show: () => { setError(null); setOpen(true); } };
}
