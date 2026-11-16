import { Button, Dropdown, IconButton } from '@setsuna-desktop/renderer-ui';
import { ChevronDown } from 'lucide-react';
import { resolveWorkspaceApp } from '@setsuna-desktop/feature-workspace-apps/contracts';
import { WorkspaceAppGlyph, workspaceOpenWithMenu } from '../../composition/workspace-apps-feature-adapter.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { DesktopWorkspaceApp } from './model.js';

export function WorkspaceFileOpenWith({ filePath, selectedApp: preferredApp, apps, onOpen }: {
  filePath: string;
  selectedApp: DesktopWorkspaceApp | null;
  apps: DesktopWorkspaceApp[];
  onOpen: (appId: string, filePath: string) => void;
}) {
  const { t } = useI18n();
  const selectedApp = resolveWorkspaceApp(apps, preferredApp, filePath);
  const label = t('workspace.fileMenu.openWith');
  const openLabel = selectedApp ? t('workspace.fileMenu.openInApp', { app: selectedApp.label }) : t('workspace.fileMenu.noApp');
  const openWith = workspaceOpenWithMenu({ label, apps, filePath, onOpen: (appId) => onOpen(appId, filePath) });

  return (
    <span className="desktop-file-open-with sd-panel-toolbar__surface">
      <Button variant="ghost" size="small" className="desktop-file-open-with__open sd-panel-toolbar__text-button"
        aria-label={openLabel} title={openLabel} disabled={!selectedApp}
        icon={<WorkspaceAppGlyph app={selectedApp} />}
        onClick={() => { if (selectedApp) onOpen(selectedApp.id, filePath); }}>
        {t('common.open')}
      </Button>
      <span className="desktop-file-open-with__divider" aria-hidden="true" />
      <Dropdown placement="bottomRight" disabled={openWith.disabled}
        menu={{ items: openWith.children, selectedKeys: selectedApp ? [selectedApp.id] : [] }}>
        <IconButton size="small" className="desktop-file-open-with__menu" label={label} disabled={openWith.disabled}>
          <ChevronDown size={12} aria-hidden="true" />
        </IconButton>
      </Dropdown>
    </span>
  );
}
