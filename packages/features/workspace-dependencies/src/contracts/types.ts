import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';

export type RuntimeWorkspaceDependencySource = 'system' | 'managed' | 'bundled';

export type RuntimeWorkspaceDependencyToolStatus = Readonly<{
  available: boolean;
  path?: string;
  source?: RuntimeWorkspaceDependencySource;
  version?: string;
}>;

export type RuntimeWorkspaceDependencyCheck = Readonly<{
  id: 'node' | 'python' | 'uv' | 'sandbox';
  label: string;
  message: string;
  status: 'ok' | 'warning' | 'error';
}>;

export type RuntimeWorkspaceDependenciesStatus = Readonly<{
  bundleVersion: string;
  checks: readonly RuntimeWorkspaceDependencyCheck[];
  error?: string;
  installPath: string;
  node: RuntimeWorkspaceDependencyToolStatus;
  python: RuntimeWorkspaceDependencyToolStatus;
  state: 'not-installed' | 'installing' | 'ready' | 'error';
  updatedAt?: string;
  uv: RuntimeWorkspaceDependencyToolStatus;
}>;

export type ShellToolchainCommand = Readonly<{
  executablePath: string;
  installationRoot: string;
}>;

/** Explicit executable and filesystem grants consumed by the sandboxed shell host. */
export type ShellToolchain = Readonly<{
  environment: Readonly<Record<string, string>>;
  commands: Readonly<Record<string, ShellToolchainCommand>>;
  readableRoots: readonly string[];
  writableCacheRoots: readonly string[];
}>;

export type PrepareShellToolchainInput = Readonly<{
  command: string;
  environment: RuntimeEnvironment;
}>;

export type WorkspaceDependencyPromptContext = Readonly<{
  enabled: boolean;
}>;
