export type DesktopWorkspaceApp = Readonly<{
  icon: string;
  id: string;
  label: string;
}>;

export const WORKSPACE_APPS_IPC_CHANNELS = Object.freeze({
  list: 'workspace-apps:list',
  open: 'workspace-apps:open',
} as const);

export interface WorkspaceAppsDesktopBridge {
  list(workspaceRoot: string): Promise<DesktopWorkspaceApp[]>;
  open(
    workspaceRoot: string,
    appId: string,
    filePath?: string | null,
    line?: number | null,
  ): Promise<boolean>;
}

export type WorkspaceAppsPreloadBridgeContribution = Readonly<{
  workspaceApps: WorkspaceAppsDesktopBridge;
}>;
