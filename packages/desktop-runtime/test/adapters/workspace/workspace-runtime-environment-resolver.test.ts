import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileWorkspaceProjectStore } from '../../../src/adapters/workspace/file-workspace-project-store.js';
import {
  WorkspaceRuntimeEnvironmentResolver,
} from '../../../src/adapters/workspace/workspace-runtime-environment-resolver.js';
import { systemClock } from '../../../src/ports/clock.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('WorkspaceRuntimeEnvironmentResolver', () => {
  it('captures the selected workspace and its Git worktree relationship', async () => {
    const root = await temporaryDirectory();
    const worktreeRoot = path.join(root, 'repo');
    const workspaceRoot = path.join(worktreeRoot, 'front-end', 'agent');
    await mkdir(path.join(worktreeRoot, '.git'), { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock);
    const project = await store.addProject({ path: workspaceRoot });

    const environment = await new WorkspaceRuntimeEnvironmentResolver(store).resolve({
      projectId: project.id,
      threadId: 'thread_1',
    });

    expect(environment).toEqual({
      id: project.id,
      cwd: await realpath(workspaceRoot),
      workspaceRoot: await realpath(workspaceRoot),
      workspaceRoots: [await realpath(workspaceRoot)],
      shell: expect.any(String),
      repository: {
        kind: 'git',
        root: await realpath(worktreeRoot),
        workspacePrefix: 'front-end/agent',
      },
    });
  });

  it('uses dot for a workspace at the Git worktree root, including linked-worktree markers', async () => {
    const root = await temporaryDirectory();
    const workspaceRoot = path.join(root, 'worktree');
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(path.join(workspaceRoot, '.git'), 'gitdir: /tmp/example.git/worktrees/example\n');
    const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock);
    const project = await store.addProject({ path: workspaceRoot });

    const environment = await new WorkspaceRuntimeEnvironmentResolver(store).resolve({
      projectId: project.id,
      threadId: 'thread_1',
    });

    expect(environment.repository).toEqual({
      kind: 'git',
      root: await realpath(workspaceRoot),
      workspacePrefix: '.',
    });
  });

  it('resolves an unbound thread to its own date-grouped temporary workspace', async () => {
    const root = await temporaryDirectory();
    const dataDir = path.join(root, 'data');
    const store = new FileWorkspaceProjectStore(dataDir, systemClock);
    const createdAt = new Date(2026, 6, 18, 12, 0, 0).toISOString();

    const environment = await new WorkspaceRuntimeEnvironmentResolver(store).resolve({
      threadId: 'thread_global',
      threadCreatedAt: createdAt,
    });

    expect(environment.id).toBe('temporary_workspace.2026-07-18.thread_global');
    expect(environment.cwd).toBe(await realpath(path.join(
      dataDir,
      'temporary-workspace',
      '2026-07-18',
      'thread_global',
    )));
    expect(environment.workspaceRoot).toBe(environment.cwd);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-environment-'));
  temporaryDirectories.push(directory);
  return directory;
}
