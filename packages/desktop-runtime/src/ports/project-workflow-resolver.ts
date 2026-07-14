import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';

export type ProjectPackageManagerName = 'bun' | 'npm' | 'pnpm' | 'yarn';

export type ProjectPackageManager = {
  name: ProjectPackageManagerName;
  version?: string;
  evidence: string[];
};

export type ProjectWorkflowManifest = {
  kind: 'node-package';
  path: string;
  directory: string;
};

export type ProjectWorkflowScript = {
  name: string;
  definition: string;
  invocation?: string;
  cwd: string;
  sourcePath: string;
  truncated: boolean;
};

export type ProjectWorkflow = {
  root: string;
  cwd: string;
  manifests: ProjectWorkflowManifest[];
  packageManager?: ProjectPackageManager;
  scripts: ProjectWorkflowScript[];
  warnings: string[];
};

export type ProjectWorkflowResolver = {
  resolve(input: { environment: RuntimeEnvironment }): Promise<ProjectWorkflow | null>;
};
