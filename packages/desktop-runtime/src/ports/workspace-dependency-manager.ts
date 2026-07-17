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
 * 管理暴露给工作区 Shell 调用的可选 Node 和 Python 工具链。
 * 实现可以复用可用的主机工具，也可以配置隔离的回退工具。
 */
export type WorkspaceDependencyManager = {
  getStatus(): Promise<RuntimeWorkspaceDependenciesStatus>;
  getPromptContext(): Promise<WorkspaceDependencyPromptContext>;
  setEnabled(input: RuntimeWorkspaceDependenciesToggleInput): Promise<RuntimeWorkspaceDependenciesStatus>;
  diagnose(): Promise<RuntimeWorkspaceDependenciesStatus>;
  reinstall(): Promise<RuntimeWorkspaceDependenciesStatus>;
  prepareShellEnvironment(command: string): Promise<WorkspaceDependencyShellEnvironment | null>;
};
