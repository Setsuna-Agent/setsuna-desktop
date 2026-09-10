import { Button } from '@setsuna-desktop/renderer-ui';
import { shellPluginPageSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { RendererOwnedKeyedSlot } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function PluginRouteAdapter({
  activeProjectId,
  activeProjectPath,
  activeThreadId,
  selectedViewKey,
  onBack,
}: Readonly<{
  activeProjectId?: string;
  activeProjectPath?: string;
  activeThreadId?: string;
  selectedViewKey: string | null;
  onBack(): void;
}>) {
  const { t } = useI18n();
  const unavailable = () => (
    <main className="declarative-plugin-page declarative-plugin-page--unavailable">
      <p>{t('pluginUi.pageUnavailable')}</p>
      <Button variant="ghost" className="declarative-plugin-ui__button" onClick={onBack} type="button">
        {t('common.back')}
      </Button>
    </main>
  );

  if (!selectedViewKey) return unavailable();
  return (
    <RendererOwnedKeyedSlot
      entryKey={selectedViewKey}
      slot={shellPluginPageSlot}
      props={{
        ...(activeProjectPath ? { cwd: activeProjectPath } : {}),
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
        ...(activeThreadId ? { threadId: activeThreadId } : {}),
        renderUnavailable: unavailable,
      }}
    />
  );
}
