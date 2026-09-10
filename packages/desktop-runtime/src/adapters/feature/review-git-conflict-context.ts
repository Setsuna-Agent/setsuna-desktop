import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { GitConflictContext } from '@setsuna-desktop/feature-review/contracts';
import type { RuntimeEnvironmentResolver } from '../../ports/runtime-environment-resolver.js';
import type { ThreadStore } from '../../ports/thread-store.js';

const execFileAsync = promisify(execFile);

/** Bind a UI-triggered repair to the conversation's actual workspace before inspecting Git. */
export async function readReviewGitConflictContext(
  threads: Pick<ThreadStore, 'getThread'>,
  environments: RuntimeEnvironmentResolver,
  threadId: string,
  workspaceRoot: string,
): Promise<GitConflictContext> {
  const { environment } = await resolveReviewWorkspace(threads, environments, threadId, workspaceRoot);
  const repositoryRoot = environment.repository?.root;
  if (!repositoryRoot) return { repositoryRoot: environment.workspaceRoot, files: [] };
  const result = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U', '-z', '--'], {
    cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024, timeout: 10_000, windowsHide: true,
  });
  return { repositoryRoot, files: result.stdout.split('\0').filter(Boolean).slice(0, 200) };
}

export async function resolveReviewWorkspace(
  threads: Pick<ThreadStore, 'getThread'>,
  environments: RuntimeEnvironmentResolver,
  threadId: string,
  workspaceRoot: string,
) {
  const thread = await threads.getThread(threadId);
  if (!thread) throw new FeatureOperationFailure({ code: 'THREAD_NOT_FOUND', message: 'Thread not found.', retryable: false });
  const environment = await environments.resolve({ projectId: thread.projectId, threadId, threadCreatedAt: thread.createdAt });
  const [requested, actual] = await Promise.all([realpath(workspaceRoot), realpath(environment.workspaceRoot)]);
  if (path.relative(requested, actual) !== '') {
    throw new FeatureOperationFailure({ code: 'WORKSPACE_MISMATCH', message: 'The conversation and Git panel must use the same workspace.', retryable: false });
  }
  return { thread, environment };
}
