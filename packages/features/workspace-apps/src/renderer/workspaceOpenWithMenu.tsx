import type { MenuItem } from '@setsuna-desktop/renderer-ui';
import { Code2 } from 'lucide-react';
import { workspaceAppSupportsTarget, type DesktopWorkspaceApp } from '../contracts/index.js';
import { WorkspaceAppGlyph } from './WorkspaceAppGlyph.js';

export function workspaceOpenWithMenu({ label, apps, filePath, onOpen }: {
  label: string;
  apps: readonly DesktopWorkspaceApp[];
  filePath?: string;
  onOpen: (appId: string) => void;
}): MenuItem {
  const available = apps.filter((app) => workspaceAppSupportsTarget(app, filePath));
  return {
    key: 'open-with', label, icon: <Code2 size={14} />,
    disabled: !available.length,
    children: available.map((app) => ({
      key: app.id, label: app.label, icon: <WorkspaceAppGlyph app={app} />,
      onClick: () => onOpen(app.id),
    })),
  };
}
