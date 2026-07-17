import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileWorkspaceProjectStore } from '../workspace/file-workspace-project-store.js';
import { WorkspaceToolHost } from './workspace-tool-host.js';

describe('workspace tool host', () => {
  it('runs read-only workspace tools against the first registered project', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-toolhost-test-'));
    const projectDir = path.join(root, 'project');
    const dataDir = path.join(root, 'data');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'README.md'), 'tool host needle\n');

    const store = new FileWorkspaceProjectStore(dataDir, systemClock, { temporaryWorkspacePath: projectDir });
    await store.addProject({ path: projectDir });
    const host = new WorkspaceToolHost(store);

    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const tools = await host.listTools(context);
    const list = await host.runTool('workspace_list_directory', {}, context);
    const read = await host.runTool('workspace_read_file', { path: 'README.md' }, context);
    const search = await host.runTool('workspace_search_text', { query: 'needle' }, context);
    const approval = await host.approvalForTool('workspace_write_file', { path: 'src/generated.txt', content: 'generated\n' }, context);
    const written = await host.runTool('workspace_write_file', { path: 'src/generated.txt', content: 'generated\n' }, context);

    expect(tools.map((tool) => tool.name)).toEqual(['workspace_list_directory', 'workspace_read_file', 'workspace_search_text', 'workspace_write_file']);
    expect(list.content).toContain('file README.md');
    expect(read.content).toContain('tool host needle');
    expect(search.content).toContain('README.md:1');
    expect(approval).toBeNull();
    expect(written.content).toContain('Created src/generated.txt');
    expect(JSON.parse(written.preview ?? '{}')).toMatchObject({
      diff: {
        path: 'src/generated.txt',
        action: 'Created',
        additions: 1,
        deletions: 0,
      },
    });
    await expect(readFile(path.join(projectDir, 'src', 'generated.txt'), 'utf8')).resolves.toBe('generated\n');
  });

  it('defaults workspace tools to the project from the execution context', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-toolhost-project-test-'));
    const firstProjectDir = path.join(root, 'first-project');
    const secondProjectDir = path.join(root, 'second-project');
    const dataDir = path.join(root, 'data');
    await mkdir(firstProjectDir, { recursive: true });
    await mkdir(secondProjectDir, { recursive: true });
    await writeFile(path.join(firstProjectDir, 'README.md'), 'first project\n');
    await writeFile(path.join(secondProjectDir, 'README.md'), 'second project\n');

    const store = new FileWorkspaceProjectStore(dataDir, systemClock);
    await store.addProject({ path: firstProjectDir });
    const second = await store.addProject({ path: secondProjectDir });
    const host = new WorkspaceToolHost(store);

    const read = await host.runTool('workspace_read_file', { path: 'README.md' }, { threadId: 'thread_1', projectId: second.id });

    expect(read.content).toContain('second project');
  });

  it('rejects another conversation workspace id while preserving explicit registered project access', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-toolhost-isolation-test-'));
    const dataDir = path.join(root, 'data');
    const projectDir = path.join(root, 'registered-project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'README.md'), 'registered project\n');
    const store = new FileWorkspaceProjectStore(dataDir, systemClock);
    const activeWorkspace = await store.ensureTemporaryWorkspace({
      threadId: 'thread_active',
      createdAt: new Date(2026, 6, 18, 12, 0, 0).toISOString(),
    });
    const otherWorkspace = await store.ensureTemporaryWorkspace({
      threadId: 'thread_other',
      createdAt: new Date(2026, 6, 18, 12, 0, 0).toISOString(),
    });
    await writeFile(path.join(otherWorkspace.path, 'secret.txt'), 'other conversation\n');
    const registeredProject = await store.addProject({ path: projectDir });
    const host = new WorkspaceToolHost(store);
    const context = {
      threadId: 'thread_active',
      environment: {
        id: activeWorkspace.id,
        cwd: activeWorkspace.path,
        workspaceRoot: activeWorkspace.path,
        workspaceRoots: [activeWorkspace.path],
      },
    };

    await expect(host.runTool('workspace_read_file', {
      projectId: otherWorkspace.id,
      path: 'secret.txt',
    }, context)).rejects.toThrow('active thread');

    await expect(host.runTool('workspace_read_file', {
      projectId: 'temporary_workspace',
      path: '2026-07-18/thread_other/secret.txt',
    }, context)).rejects.toThrow('active thread');

    await expect(host.runTool('workspace_read_file', {
      projectId: registeredProject.id,
      path: 'README.md',
    }, context)).resolves.toMatchObject({ content: 'registered project\n' });
  });
});
