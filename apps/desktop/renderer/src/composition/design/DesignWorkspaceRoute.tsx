import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { DesignWorkspaceSurface, type DesignWorkspaceLocation } from '@setsuna-desktop/feature-design/renderer';
import { WorkspaceEntryDialog } from '../../features/workspace/WorkspaceEntryDialog.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { FeatureRecoveryShell } from '../FeatureRecoveryShell.js';
import { useDesignClient } from './DesignFeatureBoundary.js';
import { watchDesignDirectories } from './design-assets.js';

export function DesignWorkspaceRoute({ projects, preferredProjectId, location, onLocationChange, onAddProject }: Readonly<{
  projects: readonly WorkspaceProject[];
  preferredProjectId?: string | null;
  location: DesignWorkspaceLocation | null;
  onLocationChange(location: DesignWorkspaceLocation): void;
  onAddProject(): void;
}>) {
  const client = useDesignClient();
  const { t } = useI18n();
  return <section className="app-design-route" aria-label={client ? t('feature.design.workspace') : undefined}>
    {client ? <DesignWorkspaceSurface client={client} projects={projects} preferredProjectId={preferredProjectId}
      location={location} onLocationChange={onLocationChange} watchDirectories={watchDesignDirectories}
      onAddProject={onAddProject} translate={t}
      renderCreateDialog={(onClose, onSubmit) => <WorkspaceEntryDialog request={{ mode: 'create', type: 'design', parentPath: '.' }}
        onClose={onClose} onSubmit={onSubmit} />} />
      : <FeatureRecoveryShell candidateFeatureIds={['design']} reason="view-missing" />}
  </section>;
}
