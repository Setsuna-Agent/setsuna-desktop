import type {
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependenciesToggleInput,
} from '@setsuna-desktop/contracts';

export type WorkspaceDependencyShellEnvironment = {
  environment: Record<string, string>;
  writableRoots: string[];
};

export type WorkspaceDependencyPromptContext = {
  enabled: boolean;
  packageIndexConfigured: boolean;
};

/**
 * Manages the optional Node/Python toolchain exposed to workspace shell calls.
 * Implementations may reuse healthy host tools or provision isolated fallbacks.
 */
export type WorkspaceDependencyManager = {
  getStatus(): Promise<RuntimeWorkspaceDependenciesStatus>;
  getPromptContext(): Promise<WorkspaceDependencyPromptContext>;
  setEnabled(input: RuntimeWorkspaceDependenciesToggleInput): Promise<RuntimeWorkspaceDependenciesStatus>;
  diagnose(): Promise<RuntimeWorkspaceDependenciesStatus>;
  reinstall(): Promise<RuntimeWorkspaceDependenciesStatus>;
  prepareShellEnvironment(command: string): Promise<WorkspaceDependencyShellEnvironment | null>;
};
