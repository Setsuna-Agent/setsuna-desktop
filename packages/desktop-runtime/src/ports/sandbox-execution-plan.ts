import type { RuntimePermissionProfile } from '@setsuna-desktop/contracts';

export type ShellSandboxProvider = 'bypass' | 'macos-seatbelt' | 'unavailable';

/**
 * Provider-neutral shell sandbox input. Toolchain discovery resolves capabilities before this
 * object is built; OS providers consume explicit roots instead of reverse-engineering PATH.
 */
export type SandboxExecutionPlan = {
  cwd: string;
  workspaceRoot: string;
  permissionProfile: RuntimePermissionProfile;
  provider: ShellSandboxProvider;
  readableRoots: string[];
  writableRoots: string[];
  deniedRoots: string[];
  deniedGlobRegExpSources: string[];
  protectedWritableRoots: string[];
  networkAccess: boolean;
  environment: Record<string, string>;
};
