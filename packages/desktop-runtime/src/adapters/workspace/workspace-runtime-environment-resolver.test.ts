import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileWorkspaceProjectStore } from './file-workspace-project-store.js';
import { WorkspaceRuntimeEnvironmentResolver } from './workspace-runtime-environment-resolver.js';

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
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-environment-'));
  temporaryDirectories.push(directory);
  return directory;
}
