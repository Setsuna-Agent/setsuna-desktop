import { Button } from '@setsuna-desktop/renderer-ui';
import { shellPluginPageSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { RendererOwnedKeyedSlot, useRendererOwnedKeyedEntries } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { usePluginPageSessions } from './usePluginPageSessions.js';

export type PluginRouteAdapterProps = Readonly<{
  active?: boolean;
  activeProjectId?: string;
  activeProjectPath?: string;
  activeThreadId?: string;
  refreshRequests?: Readonly<Record<string, number>>;
  selectedViewKey: string | null;
  onBack(): void;
}>;

export function PluginRouteAdapter({
  active = true,
  activeProjectId,
  activeProjectPath,
  activeThreadId,
  selectedViewKey,
  refreshRequests,
  onBack,
}: PluginRouteAdapterProps) {
  const { t } = useI18n();
  const availableViewKeys = useRendererOwnedKeyedEntries(shellPluginPageSlot).map(entry => entry.key);
  const sessions = usePluginPageSessions(availableViewKeys, active ? selectedViewKey : null, {
    cwd: activeProjectPath, projectId: activeProjectId, threadId: activeThreadId,
  });
  const unavailable = () => (
    <main className="declarative-plugin-page declarative-plugin-page--unavailable">
      <p>{t('pluginUi.pageUnavailable')}</p>
      <Button variant="ghost" className="declarative-plugin-ui__button" onClick={onBack} type="button">
        {t('common.back')}
      </Button>
    </main>
  );

  return <>
    {active && (!selectedViewKey || !availableViewKeys.includes(selectedViewKey)) ? unavailable() : null}
    {sessions.map(session => <div key={session.viewKey} className="plugin-page-session" hidden={!active || session.viewKey !== selectedViewKey}>
      <RendererOwnedKeyedSlot
        entryKey={session.viewKey}
        instanceKey={session.viewKey}
        slot={shellPluginPageSlot}
        props={{
          cwd: session.cwd,
          projectId: session.projectId,
          threadId: session.threadId,
          visible: active && session.viewKey === selectedViewKey,
          reloadRequest: refreshRequests?.[session.viewKey] ?? 0,
          renderUnavailable: unavailable,
        }}
      />
    </div>)}
  </>;
}
