import type { RuntimePermissionProfile } from '@setsuna-desktop/contracts';

export type ShellSandboxProvider = 'bypass' | 'macos-seatbelt' | 'windows-native' | 'unavailable';

/**
 * Provider-neutral shell sandbox input. Toolchain discovery resolves capabilities before this
 * object is built; OS providers consume explicit roots instead of reverse-engineering PATH.
 */
export type SandboxExecutionPlan = {
  cwd: string;
  workspaceRoot: string;
  permissionProfile: RuntimePermissionProfile;
  provider: ShellSandboxProvider;
  /** Absolute sidecar path for providers that execute through a bundled helper. */
  providerExecutable?: string;
  readableRoots: string[];
  writableRoots: string[];
  /** Per-execution roots that must not create persistent provider capabilities. */
  ephemeralWritableRoots?: string[];
  deniedRoots: string[];
  deniedGlobRegExpSources: string[];
  protectedWritableRoots: string[];
  networkAccess: boolean;
  environment: Record<string, string>;
};
