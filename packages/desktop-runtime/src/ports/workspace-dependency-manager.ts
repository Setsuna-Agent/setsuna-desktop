import type {
  RuntimeEnvironment,
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependenciesToggleInput,
} from '@setsuna-desktop/contracts';

export type ShellToolchainCommand = {
  executablePath: string;
  installationRoot: string;
};

/**
 * Shell 命令发现与沙箱能力的单一来源。PATH 只决定命令发现顺序；沙箱直接消费
 * commands/readableRoots，避免再从 PATH 猜测软链接或包装脚本背后的安装目录。
 */
export type ShellToolchain = {
  environment: Record<string, string>;
  commands: Record<string, ShellToolchainCommand>;
  readableRoots: string[];
  writableCacheRoots: string[];
};

export type PrepareShellToolchainInput = {
  command: string;
  environment: RuntimeEnvironment;
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
  prepareShellToolchain(input: PrepareShellToolchainInput): Promise<ShellToolchain>;
};
