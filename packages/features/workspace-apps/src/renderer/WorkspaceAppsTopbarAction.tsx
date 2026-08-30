import type { ShellTopbarActionSlotProps } from '@setsuna-desktop/renderer-contracts/shell';
import { createContext, useContext, type ReactNode } from 'react';
import type { DesktopWorkspaceApp } from '../contracts/index.js';
import { WorkspaceAppLauncher } from './WorkspaceAppLauncher.js';

export type WorkspaceAppsTopbarHost = Readonly<{
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  workspaceAppMenuOpen: boolean;
  workspaceApps: DesktopWorkspaceApp[];
  openCurrentWorkspaceApp(): void;
  selectWorkspaceApp(app: DesktopWorkspaceApp): void;
  toggleWorkspaceAppMenu(): void;
}>;

const WorkspaceAppsTopbarHostContext = createContext<WorkspaceAppsTopbarHost | null>(null);

export function WorkspaceAppsTopbarHostProvider({
  children,
  host,
}: Readonly<{
  children: ReactNode;
  host: WorkspaceAppsTopbarHost | null;
}>) {
  return (
    <WorkspaceAppsTopbarHostContext.Provider value={host}>
      {children}
    </WorkspaceAppsTopbarHostContext.Provider>
  );
}

export function WorkspaceAppsTopbarAction({
  activeRouteId,
  translate,
}: ShellTopbarActionSlotProps) {
  const host = useContext(WorkspaceAppsTopbarHostContext);
  if (activeRouteId !== 'chat' || !host) return null;
  return (
    <WorkspaceAppLauncher
      selectedWorkspaceApp={host.selectedWorkspaceApp}
      translate={translate}
      workspaceAppMenuOpen={host.workspaceAppMenuOpen}
      workspaceApps={host.workspaceApps}
      onOpenCurrentWorkspaceApp={host.openCurrentWorkspaceApp}
      onSelectWorkspaceApp={host.selectWorkspaceApp}
      onToggleWorkspaceAppMenu={host.toggleWorkspaceAppMenu}
    />
  );
}
