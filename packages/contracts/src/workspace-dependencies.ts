export type RuntimeWorkspaceDependencySource = 'system' | 'managed' | 'bundled';

export type RuntimeWorkspaceDependencyToolStatus = {
  available: boolean;
  path?: string;
  source?: RuntimeWorkspaceDependencySource;
  version?: string;
};

export type RuntimeWorkspaceDependencyCheck = {
  id: 'node' | 'python' | 'uv' | 'sandbox';
  label: string;
  message: string;
  status: 'ok' | 'warning' | 'error';
};

export type RuntimeWorkspaceDependenciesStatus = {
  bundleVersion: string;
  checks: RuntimeWorkspaceDependencyCheck[];
  enabled: boolean;
  error?: string;
  installPath: string;
  node: RuntimeWorkspaceDependencyToolStatus;
  python: RuntimeWorkspaceDependencyToolStatus;
  state: 'disabled' | 'not-installed' | 'installing' | 'ready' | 'error';
  updatedAt?: string;
  uv: RuntimeWorkspaceDependencyToolStatus;
};

export type RuntimeWorkspaceDependenciesToggleInput = {
  enabled: boolean;
};
