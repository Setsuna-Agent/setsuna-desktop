import {
  WorkspaceAppGlyph,
  WorkspaceAppLauncher,
  readPreferredWorkspaceAppId,
  writePreferredWorkspaceAppId,
} from '@setsuna-desktop/feature-workspace-apps/renderer';
import type { ComponentProps } from 'react';
import { useI18n } from '../shared/i18n/I18nProvider.js';

type WorkspaceAppsFeatureLauncherProps = Omit<
  ComponentProps<typeof WorkspaceAppLauncher>,
  'translate'
>;

export function WorkspaceAppsFeatureLauncher(props: WorkspaceAppsFeatureLauncherProps) {
  const { t } = useI18n();
  return <WorkspaceAppLauncher {...props} translate={t} />;
}

export function WorkspaceAppsFeatureGlyph(props: ComponentProps<typeof WorkspaceAppGlyph>) {
  return <WorkspaceAppGlyph {...props} />;
}

export {
  readPreferredWorkspaceAppId,
  writePreferredWorkspaceAppId,
};
