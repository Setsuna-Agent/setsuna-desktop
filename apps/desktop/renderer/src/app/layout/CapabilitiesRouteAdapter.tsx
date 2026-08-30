import { lazy, Suspense } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { AppRouteContentProps } from './AppRouteContent.js';

const CapabilitiesShell = lazy(() => import('../../features/capabilities/CapabilitiesRoute.js'));

type CapabilitiesRouteAdapterProps = Pick<
  AppRouteContentProps,
  | 'activeProject'
  | 'onSelectSkillForChat'
  | 'onSelectedCapabilitiesPluginIdChange'
  | 'selectedCapabilitiesPluginId'
>;

export function CapabilitiesRouteAdapter({
  activeProject,
  onSelectSkillForChat,
  onSelectedCapabilitiesPluginIdChange,
  selectedCapabilitiesPluginId,
}: CapabilitiesRouteAdapterProps) {
  const { t } = useI18n();

  return (
    <Suspense fallback={<RouteLoadingState label={t('common.loading')} />}>
      <CapabilitiesShell
        activeProjectPath={activeProject?.path}
        selectedPluginId={selectedCapabilitiesPluginId}
        onCreateInConversation={onSelectSkillForChat}
        onSelectedPluginIdChange={onSelectedCapabilitiesPluginIdChange}
      />
    </Suspense>
  );
}

function RouteLoadingState({ label }: Readonly<{ label: string }>) {
  return <main className="app-route-loading" role="status">{label}</main>;
}
