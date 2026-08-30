import { lazy, Suspense } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { AppRouteContentProps } from './AppRouteContent.js';

const SettingsPage = lazy(() => import('../../features/settings/SettingsRoute.js'));

type SettingsRouteAdapterProps = Pick<
  AppRouteContentProps,
  'runtime' | 'setActiveView' | 'settingsInitialSection'
>;

export function SettingsRouteAdapter({
  runtime,
  setActiveView,
  settingsInitialSection,
}: SettingsRouteAdapterProps) {
  const { t } = useI18n();

  return (
    <Suspense fallback={<RouteLoadingState label={t('common.loading')} />}>
      <SettingsPage
        archivedThreads={runtime.archivedThreads}
        config={runtime.config}
        initialSection={settingsInitialSection ?? undefined}
        onBack={() => setActiveView('chat')}
        onSaveRuntimePreferences={runtime.saveRuntimePreferences}
        onDeleteAllArchivedThreads={runtime.permanentlyDeleteArchivedThreads}
        onDeleteArchivedThread={runtime.permanentlyDeleteThread}
        onRestoreArchivedThread={runtime.restoreArchivedThread}
      />
    </Suspense>
  );
}

function RouteLoadingState({ label }: Readonly<{ label: string }>) {
  return <main className="app-route-loading" role="status">{label}</main>;
}
