import { workspaceProjectRoots, workspaceTarget, type RuntimeApprovalDecision, type WorkspaceFileChange } from '@setsuna-desktop/contracts';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { PcLocalToolHost } from '../../../src/adapters/tool/pc-local/pc-local-tool-host.js';
import { FileWorkspaceProjectStore } from '../../../src/adapters/workspace/file-workspace-project-store.js';
import { FileProjectInstructionLoader } from '../../../src/adapters/workspace/file-project-instruction-loader.js';
import { GitWorkspaceFork } from '../../../src/adapters/workspace/git-workspace-fork.js';
import { WorkspaceRuntimeEnvironmentResolver } from '../../../src/adapters/workspace/workspace-runtime-environment-resolver.js';
import { ToolApprovalStore, ToolOrchestrator } from '../../../src/loop/tools/tool-orchestrator.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { RuntimeToolExecutionContext } from '../../../src/ports/tool-host.js';
import { expectRestrictedShellUnavailable, restrictedShellExecutionUnavailable } from '../adapters/tool/pc-local-tool-host.support.js';

let directory: string;
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(tmpdir(), 'setsuna-multi-root-'))); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const main = path.join(directory, 'main');
  const child = path.join(directory, 'agent');
  const outside = path.join(directory, 'outside');
  await Promise.all([main, child, outside].map((root) => mkdir(root)));
  const forks = new GitWorkspaceFork(path.join(directory, 'worktrees'));
  const store = new FileWorkspaceProjectStore(path.join(directory, 'data'), systemClock, { worktrees: forks });
  const project = await store.addProject({ name: 'Workspace', roots: [{ path: main }, { path: child }] });
  const environment = await new WorkspaceRuntimeEnvironmentResolver(store).resolve({ projectId: project.id, threadId: 'thread' });
  const host = new PcLocalToolHost(store);
  const context: RuntimeToolExecutionContext = {
    threadId: 'thread', turnId: 'turn', projectId: project.id, environment,
    permissionProfile: 'workspace-write', sandboxWorkspaceWrite: undefined, signal: new AbortController().signal,
  };
  return { main, child, outside, forks, store, project, environment, host, context };
}

it('routes identical file names, preserves root identities, and gives bound directories equal tool access', async () => {
  const { main, child, store, project, host, context } = await fixture();
  const roots = workspaceProjectRoots(project);
  await writeFile(path.join(main, 'same.txt'), 'main');
  await writeFile(path.join(child, 'same.txt'), 'child');
  await writeFile(path.join(main, 'AGENTS.md'), 'Main instructions');
  await writeFile(path.join(child, 'AGENTS.md'), 'Child instructions');
  const target = workspaceTarget(project.id, roots[1].id);
  const file = await store.readFile(target, 'same.txt');
  expect(file).toMatchObject({ rootId: roots[1].id, content: 'child' });
  await store.writeFile(target, 'same.txt', 'updated child');
  expect(await readFile(path.join(main, 'same.txt'), 'utf8')).toBe('main');
  expect((await host.runTool('read_file', { file_path: path.join(child, 'same.txt') }, context)).content).toContain('updated child');
  expect((await host.runTool('write_file', { file_path: path.join(child, 'new.txt'), content: 'new child' }, context)).data).toMatchObject({ ok: true });
  expect((await host.runTool('find_files', { path: child, query: 'new' }, context)).content).toContain('new.txt');
  expect((await host.runTool('search_text', { path: child, query: 'updated child' }, context)).content).toContain('same.txt');
  const shell = host.runTool('exec_command', { command: 'echo child-shell', directory: child, yield_time_ms: 0 },
    { ...context, permissionProfile: 'read-only' });
  if (restrictedShellExecutionUnavailable) await expectRestrictedShellUnavailable(shell);
  else expect((await shell).content).toContain('child-shell');
  const instructions = await new FileProjectInstructionLoader().load({ environment: context.environment });
  expect(instructions.map((item) => [item.directory, item.content])).toEqual([[main, 'Main instructions'], [child, 'Child instructions']]);
  const reordered = await store.updateProject(project.id, { roots: [...roots].reverse() });
  expect(reordered.path).toBe(child);
  expect(workspaceProjectRoots(reordered).map((root) => root.id)).toEqual(roots.map((root) => root.id).reverse());
  await store.updateProject(project.id, { roots: [roots[0]] });
  await expect(store.readFile(target, 'same.txt')).rejects.toThrow('no longer associated');
  await rename(main, `${main}-offline`);
  expect((await store.updateProject(project.id, { roots: [roots[0]], name: 'Offline binding' })).name).toBe('Offline binding');
});

it('grants only approved external targets, supports full access, and restores a cross-directory patch atomically', async () => {
  const { main, child, outside, host, context, store, project } = await fixture();
  let nextDecision: RuntimeApprovalDecision = 'reject';
  let counter = 0;
  const approvals: string[] = [];
  const gate = new InMemoryApprovalGate(systemClock, { id: (prefix) => `${prefix}_${++counter}` });
  const runner = new ToolOrchestrator({
    toolHost: host, approvalGate: gate, approvalStore: new ToolApprovalStore(), clock: systemClock,
    events: {
      publishToolStarted: async () => undefined, publishToolCompleted: async () => undefined,
      publishToolOutputDelta: async () => undefined, publishHookStarted: async () => undefined,
      publishHookCompleted: async () => undefined, publishApprovalResolved: async () => undefined,
      publishApprovalRequested: async (approval) => {
        approvals.push(approval.argumentsPreview);
        await gate.answerApproval(approval.id, { decision: nextDecision });
      },
    },
  });
  const run = (name: string, args: Record<string, unknown>, current = context) => runner.runToolCall(
    { id: `call_${++counter}`, name, arguments: JSON.stringify(args) }, args, current, 'on-request',
  );
  const externalFile = path.join(outside, 'approved.txt');
  expect((await run('write_file', { file_path: externalFile, content: 'approved' })).status).toBe('rejected');
  await expect(readFile(externalFile)).rejects.toMatchObject({ code: 'ENOENT' });
  nextDecision = 'approve_for_session';
  expect((await run('write_file', { file_path: externalFile, content: 'approved' })).status).toBe('success');
  const count = approvals.length;
  expect((await run('edit_file', { file_path: externalFile, old_string: 'approved', new_string: 'again' })).status).toBe('success');
  expect(approvals).toHaveLength(count);
  nextDecision = 'reject';
  expect((await run('write_file', { file_path: path.join(outside, 'unapproved.txt'), content: 'blocked' })).status).toBe('rejected');
  const countBeforeFull = approvals.length;
  expect((await run('write_file', { file_path: path.join(outside, 'full.txt'), content: 'full' },
    { ...context, permissionProfile: 'danger-full-access' })).status).toBe('success');
  expect(approvals).toHaveLength(countBeforeFull);

  const result = await host.runTool('apply_patch', { patch: [
    '*** Begin Patch', '*** Add File: same.txt', '+main',
    `*** Add File: ${path.join(child, 'same.txt')}`, '+child', '*** End Patch',
  ].join('\n') }, context);
  const data = result.data as { diff: { diffs: Array<{ path: string; absolutePath?: string; undo: WorkspaceFileChange['patch'] }> } };
  const changes = data.diff.diffs.map((file) => ({ path: file.path, absolutePath: file.absolutePath, patch: file.undo }));
  await store.applyFileChanges(project.id, changes, 'undo');
  await expect(readFile(path.join(main, 'same.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(child, 'same.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  await store.applyFileChanges(project.id, changes, 'redo');
  expect(await readFile(path.join(child, 'same.txt'), 'utf8')).toBe('child\n');
  await writeFile(path.join(child, 'same.txt'), 'user edit');
  await expect(store.applyFileChanges(project.id, changes, 'undo')).rejects.toThrow('No files were changed');
  expect(await readFile(path.join(main, 'same.txt'), 'utf8')).toBe('main\n');
});

it('does not turn a directory symlink into implicit external write authority', async () => {
  const { child, outside, host, context } = await fixture();
  await symlink(outside, path.join(child, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(host.runTool('write_file', { file_path: path.join(child, 'escape', 'new.txt'), content: 'blocked' }, context))
    .rejects.toThrow('writable_roots');
  await expect(readFile(path.join(outside, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('creates a worktree for the primary repo and keeps secondary bindings live', async () => {
  const { main, child, outside, store, project, forks } = await fixture();
  const git = promisify(execFile);
  await git('git', ['init', main]);
  await writeFile(path.join(main, 'tracked.txt'), 'original');
  await git('git', ['-C', main, 'add', 'tracked.txt']);
  await git('git', ['-C', main, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=', 'commit', '-m', 'initial']);
  await git('git', ['init', child]);
  await writeFile(path.join(child, 'child-only.txt'), 'child');
  const readonlyHost = new PcLocalToolHost(store, undefined, undefined, undefined, {
    shellSandboxCapability: () => ({ supported: false, provider: '', reason: 'test' }),
  });
  const inspection = await readonlyHost.runTool('git_inspect', { operation: 'status', path: child }, {
    projectId: project.id, threadId: 'inspection', turnId: 'turn', readOnly: true,
  });
  expect(inspection.content).toContain('child-only.txt');
  expect(inspection.content).not.toContain('tracked.txt');
  await readonlyHost.shutdown();
  const fork = await forks.createWorktree(main, project);
  const resolve = () => new WorkspaceRuntimeEnvironmentResolver(store).resolve({ projectId: project.id, workspaceId: fork.workspaceId, threadId: 'thread_worktree' });
  expect((await resolve()).workspaceRoots).toEqual([fork.path, child]);
  const legacyFork = await forks.createWorktree(main);
  expect((await new WorkspaceRuntimeEnvironmentResolver(store).resolve({
    projectId: project.id, workspaceId: legacyFork.workspaceId, threadId: 'thread_legacy',
  })).workspaceRoots).toEqual([legacyFork.path, child]);
  expect((await store.getStatus(workspaceTarget(legacyFork.workspaceId, workspaceProjectRoots(project)[1].id))).project?.path).toBe(child);
  const roots = workspaceProjectRoots(project);
  const updated = await store.updateProject(project.id, { roots: [...roots, { path: outside }] });
  expect((await resolve()).workspaceRoots).toEqual([fork.path, child, outside]);
  await store.createEntry(workspaceTarget(fork.workspaceId, roots[1].id), { type: 'file', name: 'child.txt', parentPath: '' });
  expect(await readFile(path.join(child, 'child.txt'), 'utf8')).toBe('');
  await store.updateProject(project.id, { roots: workspaceProjectRoots(updated).filter((root) => root.id !== roots[1].id) });
  expect((await resolve()).workspaceRoots).toEqual([fork.path, outside]);
});
