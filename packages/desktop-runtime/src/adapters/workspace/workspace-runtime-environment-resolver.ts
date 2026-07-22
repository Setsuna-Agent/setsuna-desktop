import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeEnvironmentResolver } from '../../ports/runtime-environment-resolver.js';
import type { WorkspaceProjectStore } from '../../ports/workspace-project-store.js';

/** 根据所选工作区解析一个规范化环境描述。 */
export class WorkspaceRuntimeEnvironmentResolver implements RuntimeEnvironmentResolver {
  constructor(private readonly projects: Pick<WorkspaceProjectStore, 'ensureTemporaryWorkspace' | 'getStatus'>) {}

  async resolve({ projectId, threadCreatedAt, threadId }: Parameters<RuntimeEnvironmentResolver['resolve']>[0]): Promise<RuntimeEnvironment> {
    const resolvedProjectId = projectId
      ?? (await this.projects.ensureTemporaryWorkspace({ threadId, createdAt: threadCreatedAt })).id;
    const status = await this.projects.getStatus(resolvedProjectId);
    if (!status.project || !status.exists || !status.readable) {
      throw new Error(projectId ? `Workspace is unavailable: ${projectId}` : 'Temporary workspace is unavailable.');
    }

    const project = status.project;
    const gitRoot = status.gitRoot;
    const workspaceRoot = await realpath(project.path).catch(() => path.resolve(project.path));
    const worktreeRoot = gitRoot
      ? await realpath(gitRoot).catch(() => path.resolve(gitRoot))
      : null;
    const workspacePrefix = worktreeRoot ? relativePathWithin(worktreeRoot, workspaceRoot) : null;

    return {
      id: status.project.id,
      cwd: workspaceRoot,
      workspaceRoot,
      workspaceRoots: [workspaceRoot],
      shell: runtimeShellPath(),
      ...(worktreeRoot && workspacePrefix !== null
        ? {
            repository: {
              kind: 'git' as const,
              root: worktreeRoot,
              workspacePrefix,
            },
          }
        : {}),
    };
  }
}

function relativePathWithin(root: string, target: string): string | null {
  const relative = path.relative(root, target);
  if (relative === '') return '.';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

function runtimeShellPath(): string {
  if (process.platform === 'win32') return process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
  return '/bin/sh';
}
