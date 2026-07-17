/**
 * 对单次 runtime 操作所选本地环境的可序列化描述。权限信息有意置于此值之外：
 * 该值描述执行发生的位置，而不是调用方可以访问的内容。
 */
export type RuntimeEnvironment = {
  id: string;
  /** Shell 命令的默认工作目录。 */
  cwd: string;
  /** 工作区相对路径文件工具使用的主要基准目录。 */
  workspaceRoot: string;
  /** 语义上的工作区根目录；主工作区根目录始终位于首位。 */
  workspaceRoots: string[];
  /** 已知时，记录本地命令运行器实际使用的 Shell 可执行文件。 */
  shell?: string;
  repository?: RuntimeGitRepositoryEnvironment;
};

export type RuntimeGitRepositoryEnvironment = {
  kind: 'git';
  /** Git 工作树的顶层目录，可能位于工作区之外。 */
  root: string;
  /** 从仓库根目录到 workspaceRoot 的 POSIX 风格路径；位于根目录时为 `.`。 */
  workspacePrefix: string;
};
