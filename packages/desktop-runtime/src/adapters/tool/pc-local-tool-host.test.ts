import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileWorkspaceProjectStore } from '../workspace/file-workspace-project-store.js';
import { PcLocalToolHost } from './pc-local-tool-host.js';

describe('pc local tool host', () => {
  it('exposes the pc SWE tool contract and enforces begin-before-write sequencing', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const tools = await host.listTools(context);
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'plan_file_changes',
      'begin_file_change',
      'apply_patch',
      'write_file',
      'append_file',
      'delete_file',
      'edit',
      'read_file',
      'read_diff',
      'git_status',
      'run_shell_command',
    ]));
    expect(tools.map((tool) => tool.name)).not.toContain('workspace_write_file');
    await expect(host.approvalForTool('plan_file_changes', {
      files: [{ file_path: 'src/generated.txt', action: 'create' }],
    }, context)).resolves.toBeNull();

    await expect(host.runTool('write_file', { file_path: 'src/generated.txt', content: 'nope\n' }, context))
      .rejects.toThrow('Call begin_file_change');

    const plan = await host.runTool('plan_file_changes', {
      files: [{ file_path: 'src/generated.txt', action: 'create' }],
    }, context);
    expect(plan.content).toContain('src/generated.txt');
    await expect(host.toolChoice?.(context, { tools, messages: [] }))
      .resolves.toEqual({ type: 'tool', name: 'begin_file_change' });

    await expect(host.runTool('begin_file_change', { file_path: 'src/other.txt', action: 'create' }, context))
      .rejects.toThrow('next queued file');

    await host.runTool('begin_file_change', { file_path: 'src/generated.txt', action: 'create' }, context);
    await expect(host.toolChoice?.(context, { tools, messages: [] }))
      .resolves.toEqual({ type: 'tool', name: 'write_file' });
    const approval = await host.approvalForTool('write_file', { file_path: 'src/generated.txt', content: 'generated\n' }, context);
    expect(approval).toMatchObject({
      reason: expect.stringContaining('Review file change before applying write_file to src/generated.txt'),
      argumentsPreview: expect.stringContaining('src/generated.txt'),
    });
    const written = await host.runTool('write_file', { file_path: 'src/generated.txt', content: 'generated\n' }, context);
    await expect(host.toolChoice?.(context, { tools, messages: [] }))
      .resolves.toBeNull();

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

  it('uses pc shell risk classification for approval', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.approvalForTool('run_shell_command', { command: 'pnpm test', risk_level: 'low' }, context))
      .resolves.toBeNull();
    await expect(host.approvalForTool('run_shell_command', { command: 'rm -rf dist', risk_level: 'low' }, context))
      .resolves.toMatchObject({ reason: expect.stringContaining('删除') });
  });
  it('forwards shell stdout as tool output deltas', async () => {
    const { host } = await createHost();
    const deltas: Array<{ delta: string; stream?: string; processId?: string }> = [];

    const result = await host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "process.stdout.write('pc delta\\n')"`,
        risk_level: 'low',
        yield_time_ms: 0,
      },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        onToolOutputDelta: (delta) => deltas.push(delta),
      },
    );

    expect(result.content).toContain('pc delta');
    expect(deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ delta: expect.stringContaining('pc delta'), stream: 'stdout', processId: expect.any(String) }),
    ]));
  });
});

async function createHost(): Promise<{ host: PcLocalToolHost; projectDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-pc-toolhost-test-'));
  const projectDir = path.join(root, 'project');
  const dataDir = path.join(root, 'data');
  await mkdir(projectDir, { recursive: true });
  const store = new FileWorkspaceProjectStore(dataDir, systemClock);
  await store.addProject({ path: projectDir });
  return { host: new PcLocalToolHost(store), projectDir };
}

function nodeCommand(): string {
  return JSON.stringify(process.execPath);
}
