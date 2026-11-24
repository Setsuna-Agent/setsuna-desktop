import { useContext } from 'react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { DesignWorkspaceSurface, type DesignWorkspaceLocation } from '@setsuna-desktop/feature-design/renderer';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { useResolvedThemeMode } from '../../shared/preferences/useThemeTransition.js';
import { FeatureRecoveryShell } from '../FeatureRecoveryShell.js';
import { DesignRouteBusyContext, useDesignChat } from './DesignChatHost.js';
import { useDesignClient } from './DesignFeatureBoundary.js';
import { watchDesignDirectories } from './design-assets.js';

export function DesignWorkspaceRoute({ projects, visible, location, onLocationChange }: Readonly<{
  projects: readonly WorkspaceProject[];
  visible: boolean;
  location: DesignWorkspaceLocation | null;
  onLocationChange(location: DesignWorkspaceLocation | null): void;
}>) {
  const client = useDesignClient();
  const renderDesignChat = useDesignChat(location?.projectId);
  const onBusyChange = useContext(DesignRouteBusyContext);
  const { locale, t } = useI18n();
  const colorScheme = useResolvedThemeMode();
  return <section className="app-design-route" aria-label={client ? t('feature.design.workspace') : undefined}>
    {client ? <DesignWorkspaceSurface client={client} projects={projects} visible={visible}
      renderChat={renderDesignChat} onBusyChange={onBusyChange}
      location={location} onLocationChange={onLocationChange} watchDirectories={watchDesignDirectories}
      locale={locale} colorScheme={colorScheme} translate={t} />
      : <FeatureRecoveryShell candidateFeatureIds={['design']} reason="view-missing" />}
  </section>;
}
