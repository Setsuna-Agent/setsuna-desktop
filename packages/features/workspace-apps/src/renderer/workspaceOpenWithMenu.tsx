import type { MenuItem } from '@setsuna-desktop/renderer-ui';
import { Code2 } from 'lucide-react';
import type { DesktopWorkspaceApp } from '../contracts/index.js';
import { WorkspaceAppGlyph } from './WorkspaceAppGlyph.js';

export function workspaceOpenWithMenu({ label, apps, onOpen }: {
  label: string;
  apps: readonly DesktopWorkspaceApp[];
  onOpen: (appId: string) => void;
}): MenuItem {
  return {
    key: 'open-with', label, icon: <Code2 size={14} />,
    disabled: !apps.length,
    children: apps.map((app) => ({
      key: app.id, label: app.label, icon: <WorkspaceAppGlyph app={app} />,
      onClick: () => onOpen(app.id),
    })),
  };
}
