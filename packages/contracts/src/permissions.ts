export type RuntimePermissionProfile = 'read-only' | 'workspace-write' | 'danger-full-access';

export type RuntimeSandboxWorkspaceWrite = {
  readableRoots?: string[];
  writableRoots?: string[];
  deniedRoots?: string[];
  deniedGlobPatterns?: string[];
  globScanMaxDepth?: number;
  networkAccess?: boolean;
  excludeTmpdirEnvVar?: boolean;
  excludeSlashTmp?: boolean;
};
