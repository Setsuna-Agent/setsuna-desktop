import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { DesignWorkspaceSurface, type DesignWorkspaceLocation } from '@setsuna-desktop/feature-design/renderer';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { FeatureRecoveryShell } from '../FeatureRecoveryShell.js';
import { useDesignChat } from './DesignChatHost.js';
import { useDesignClient } from './DesignFeatureBoundary.js';
import { watchDesignDirectories } from './design-assets.js';

export function DesignWorkspaceRoute({ projects, location, onLocationChange, onAddProject }: Readonly<{
  projects: readonly WorkspaceProject[];
  location: DesignWorkspaceLocation | null;
  onLocationChange(location: DesignWorkspaceLocation | null): void;
  onAddProject(): void;
}>) {
  const client = useDesignClient();
  const renderDesignChat = useDesignChat(location?.projectId);
  const { t } = useI18n();
  return <section className="app-design-route" aria-label={client ? t('feature.design.workspace') : undefined}>
    {client ? <DesignWorkspaceSurface client={client} projects={projects}
      renderChat={renderDesignChat}
      location={location} onLocationChange={onLocationChange} watchDirectories={watchDesignDirectories}
      onAddProject={onAddProject} translate={t} />
      : <FeatureRecoveryShell candidateFeatureIds={['design']} reason="view-missing" />}
  </section>;
}
