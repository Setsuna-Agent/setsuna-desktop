import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeExecPolicyAmendment, RuntimeNetworkPolicyAmendment } from '@setsuna-desktop/contracts';
import { systemClock } from '../../ports/clock.js';
import type { PolicyAmendmentStore, RuntimePolicyAmendments } from '../../ports/policy-amendment-store.js';
import { ToolExecutionError } from '../../ports/tool-host.js';
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
      'request_permissions',
      'exec_command',
      'write_stdin',
    ]));
    expect(tools.map((tool) => tool.name)).not.toContain('workspace_write_file');
    expect(tools.map((tool) => tool.name)).not.toContain('remember_memory');
    expect(tools.map((tool) => tool.name)).not.toContain('configure_mcp_server');
    const execTool = tools.find((tool) => tool.name === 'exec_command');
    expect((execTool?.inputSchema?.properties as Record<string, unknown>)?.sandbox_permissions).toMatchObject({
      enum: expect.arrayContaining(['with_additional_permissions', 'require_escalated']),
    });
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
    await expect(host.approvalForTool('write_file', { file_path: 'src/generated.txt', content: 'generated\n' }, context))
      .resolves.toBeNull();
    await expect(host.approvalForTool('delete_file', { file_path: 'src/generated.txt' }, context))
      .resolves.toBeNull();
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

  it('hides request_permissions when the feature is disabled', async () => {
    const { host } = await createHost();

    const enabledTools = await host.listTools({
      threadId: 'thread_1',
      turnId: 'turn_1',
      features: { request_permissions_tool: true },
    });
    const disabledTools = await host.listTools({
      threadId: 'thread_1',
      turnId: 'turn_1',
      features: { request_permissions_tool: false },
    });

    expect(enabledTools.map((tool) => tool.name)).toContain('request_permissions');
    expect(disabledTools.map((tool) => tool.name)).not.toContain('request_permissions');
    expect(disabledTools.map((tool) => tool.name)).toContain('exec_command');
  });

  it('uses pc shell risk classification for approval', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.approvalForTool('run_shell_command', { command: 'pnpm test', risk_level: 'low' }, context))
      .resolves.toBeNull();
    await expect(host.approvalForTool('run_shell_command', { command: 'rm -rf dist', risk_level: 'low' }, context))
      .resolves.toMatchObject({ reason: expect.stringContaining('删除') });
    await expect(host.approvalForTool('run_shell_command', { command: shellApplyPatchCommand('src/generated.txt'), risk_level: 'low' }, context))
      .resolves.toMatchObject({ reason: expect.stringContaining('apply_patch') });
  });

  it('blocks shell apply_patch commands that were not intercepted by the runtime orchestrator', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('run_shell_command', {
      command: shellApplyPatchCommand('src/generated.txt'),
      risk_level: 'low',
    }, context)).rejects.toThrow('Shell apply_patch commands must be routed');
  });

  it('blocks shell applypatch alias commands that were not intercepted by the runtime orchestrator', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('run_shell_command', {
      command: shellApplyPatchCommand('src/generated.txt').replace('apply_patch', 'applypatch'),
      risk_level: 'low',
    }, context)).rejects.toThrow('Shell apply_patch commands must be routed');
  });

  it('accepts EOF-heredoc wrapped apply_patch arguments', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await host.runTool('apply_patch', {
      patch: [
        "<<'EOF'",
        '*** Begin Patch',
        '*** Add File: src/heredoc-arg.txt',
        '+ok',
        '*** End Patch',
        'EOF',
      ].join('\n'),
    }, context);

    await expect(readFile(path.join(projectDir, 'src', 'heredoc-arg.txt'), 'utf8')).resolves.toBe('ok\n');
  });

  it('rejects non-EOF heredoc wrappers for direct apply_patch arguments', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('apply_patch', {
      patch: [
        "<<'PATCH'",
        '*** Begin Patch',
        '*** Add File: src/heredoc-arg.txt',
        '+nope',
        '*** End Patch',
        'PATCH',
      ].join('\n'),
    }, context)).rejects.toThrow('apply_patch 补丁必须以');
  });

  it('accepts apply_patch environment preambles for the active local environment', async () => {
    const { host, projectDir, projectId } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1', projectId };

    await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        `*** Environment ID: ${projectId}`,
        '*** Add File: src/env-patch.txt',
        '+ok',
        '*** End Patch',
      ].join('\n'),
    }, context);

    await expect(readFile(path.join(projectDir, 'src', 'env-patch.txt'), 'utf8')).resolves.toBe('ok\n');
  });

  it('rejects apply_patch environment preambles for non-active environments', async () => {
    const { host, projectId } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1', projectId };

    await expect(host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Environment ID: remote',
        '*** Add File: src/env-patch.txt',
        '+nope',
        '*** End Patch',
      ].join('\n'),
    }, context)).rejects.toThrow('does not match active environment');
  });

  it('checks protected metadata paths through apply_patch workdir', async () => {
    const { host, projectId } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1', projectId };

    await expect(host.runTool('apply_patch', {
      workdir: '.git',
      patch: [
        '*** Begin Patch',
        '*** Add File: config',
        '+unsafe',
        '*** End Patch',
      ].join('\n'),
    }, context)).rejects.toThrow('受保护的工作区元数据');
  });

  it('blocks direct file mutations against protected workspace metadata', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Add File: .git/config',
        '+unsafe',
        '*** End Patch',
      ].join('\n'),
    }, context)).rejects.toThrow('受保护的工作区元数据');
  });

  it('blocks shell mutations against protected workspace metadata', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('run_shell_command', {
      command: 'rm .git/config',
      risk_level: 'low',
      yield_time_ms: 0,
    }, context)).rejects.toThrow('受保护的工作区元数据');
  });

  it('allows shell writes under configured workspace-write writable roots', async () => {
    const { host } = await createHost();
    const writableRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-extra-writable-root-'));
    const target = path.join(writableRoot, 'allowed.txt');
    const command = `printf ok > ${JSON.stringify(target)}`;

    await expect(host.runTool('run_shell_command', {
      command,
      risk_level: 'low',
      yield_time_ms: 0,
    }, { threadId: 'thread_1', turnId: 'turn_1' })).rejects.toThrow('未授权路径');

    const result = await host.runTool('run_shell_command', {
      command,
      directory: writableRoot,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { writableRoots: [writableRoot] },
    });

    expect(result.content).toContain('Exit Code: 0');
    await expect(readFile(target, 'utf8')).resolves.toBe('ok');
  });

  it('allows reads under configured readable roots', async () => {
    const { host } = await createHost();
    const readableRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-readable-root-'));
    const target = path.join(readableRoot, 'allowed.txt');
    await writeFile(target, 'outside but approved\n', 'utf8');

    await expect(host.runTool('read_file', { file_path: target }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: {},
    })).rejects.toThrow('readable_roots');

    const result = await host.runTool('read_file', { file_path: target }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { readableRoots: [readableRoot] },
    });

    expect(result.content).toContain('outside but approved');
  });

  it('denies file tool access under configured denied roots', async () => {
    const { host, projectDir } = await createHost();
    const deniedRoot = path.join(projectDir, 'blocked');
    await mkdir(deniedRoot, { recursive: true });
    await writeFile(path.join(deniedRoot, 'secret.txt'), 'blocked\n', 'utf8');
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { deniedRoots: [deniedRoot] },
    };

    await expect(host.runTool('read_file', { file_path: 'blocked/secret.txt' }, context))
      .rejects.toThrow('deny');
    await expect(host.runTool('list_directory', { path: 'blocked' }, context))
      .rejects.toThrow('deny');

    await host.runTool('plan_file_changes', {
      files: [{ file_path: 'blocked/generated.txt', action: 'create' }],
    }, context);
    await host.runTool('begin_file_change', { file_path: 'blocked/generated.txt', action: 'create' }, context);
    await expect(host.runTool('write_file', { file_path: 'blocked/generated.txt', content: 'nope\n' }, context))
      .rejects.toThrow('deny');
  });

  it('denies file reads and searches matching configured denied glob patterns', async () => {
    const { host, projectDir } = await createHost();
    await mkdir(path.join(projectDir, 'app'), { recursive: true });
    await writeFile(path.join(projectDir, '.env'), 'ROOT_SECRET=1\n', 'utf8');
    await writeFile(path.join(projectDir, 'app', '.env'), 'APP_SECRET=1\n', 'utf8');
    await writeFile(path.join(projectDir, 'app', 'notes.txt'), 'visible\n', 'utf8');
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { deniedGlobPatterns: [path.join(projectDir, '**/*.env')] },
    };

    await expect(host.runTool('read_file', { file_path: '.env' }, context))
      .rejects.toThrow('deny');

    const search = await host.runTool('search_text', { query: 'SECRET' }, context);
    expect(search.content).not.toContain('ROOT_SECRET');
    expect(search.content).not.toContain('APP_SECRET');
  });

  it('denies shell writes under configured denied roots', async () => {
    const { host, projectDir } = await createHost();
    const deniedRoot = path.join(projectDir, 'blocked');
    await mkdir(deniedRoot, { recursive: true });

    await expect(host.runTool('run_shell_command', {
      command: 'printf nope > blocked/generated.txt',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { deniedRoots: [deniedRoot] },
    })).rejects.toThrow('deny');
  });

  it('denies shell reads matching configured denied glob patterns', async () => {
    const { host, projectDir } = await createHost();
    await writeFile(path.join(projectDir, '.env'), 'SECRET=1\n', 'utf8');

    await expect(host.runTool('run_shell_command', {
      command: 'cat .env',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { deniedGlobPatterns: [path.join(projectDir, '**/*.env')] },
    })).rejects.toThrow('deny');
  });

  it('uses persisted exec policy amendments as local shell allow rules', async () => {
    const { host } = await createHost({
      policyAmendmentStore: new StaticPolicyAmendmentStore({
        execPolicyAmendments: [['git', 'status']],
        networkPolicyAmendments: [],
      }),
    });

    await expect(host.approvalForTool('exec_command', {
      cmd: 'git status --short',
      sandbox_permissions: 'require_escalated',
      justification: 'normally high risk',
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toBeNull();
  });

  it('uses persisted network deny amendments during shell preflight', async () => {
    const { host } = await createHost({
      policyAmendmentStore: new StaticPolicyAmendmentStore({
        execPolicyAmendments: [],
        networkPolicyAmendments: [{ host: 'example.com', action: 'deny' }],
      }),
    });

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://example.com',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toThrow('network policy');
  });

  it('allows read-only shell writes only inside approved writable roots', async () => {
    const { host, projectDir } = await createHost();
    const grantedDir = path.join(projectDir, 'granted');
    await mkdir(grantedDir, { recursive: true });

    const result = await host.runTool('run_shell_command', {
      command: 'touch granted/ok.txt',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { writableRoots: ['granted'] },
    });

    expect(result.content).toContain('Exit Code: 0');
    await expect(readFile(path.join(grantedDir, 'ok.txt'), 'utf8')).resolves.toBe('');
    await expect(host.runTool('run_shell_command', {
      command: 'touch denied.txt',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { writableRoots: ['granted'] },
    })).rejects.toThrow('未授权路径');
  });

  it('blocks obvious shell network access until network access is approved for the attempt', async () => {
    const { host } = await createHost();

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://example.com',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      name: ToolExecutionError.name,
      failureKind: 'network_denied',
      failureStage: 'preflight',
      data: {
        network_approval_context: {
          host: 'example.com',
          protocol: 'https',
          port: 443,
          target: 'https://example.com:443',
        },
      },
      message: expect.stringContaining('network_access'),
    });

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://read-only.example.com',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      name: ToolExecutionError.name,
      failureKind: 'network_denied',
      failureStage: 'preflight',
      data: {
        network_approval_context: {
          host: 'read-only.example.com',
          protocol: 'https',
          port: 443,
          target: 'https://read-only.example.com:443',
        },
      },
    });

    await expect(host.runTool('run_shell_command', {
      command: 'ssh git@github.com',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      name: ToolExecutionError.name,
      failureKind: 'network_denied',
      failureStage: 'preflight',
      data: {
        network_approval_context: {
          host: 'github.com',
          protocol: 'tcp',
          port: 22,
          target: 'tcp://github.com:22',
        },
      },
    });
  });

  it('does not execute MCP configuration through the pc tool path', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.previewToolCall('configure_mcp_server', { key: 'remote', url: 'https://example.com/mcp' }, context))
      .resolves.toBeNull();
    await expect(host.runTool('configure_mcp_server', { key: 'remote', url: 'https://example.com/mcp' }, context))
      .rejects.toThrow('Unknown tool');
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

  it('supports Codex-compatible exec_command and write_stdin tool names', async () => {
    const { host } = await createHost();
    const execResult = await host.runTool(
      'exec_command',
      {
        cmd: `${nodeCommand()} -e "process.stdout.write('exec compat\\n')"`,
        yield_time_ms: 0,
      },
      { threadId: 'thread_1', turnId: 'turn_1' },
    );

    expect(execResult.content).toContain('exec compat');
    await expect(host.approvalForTool('exec_command', {
      cmd: 'printf risky',
      sandbox_permissions: 'require_escalated',
      justification: 'needs unsandboxed access',
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toMatchObject({
      reason: expect.stringContaining('needs unsandboxed access'),
    });
    await expect(host.approvalForTool('exec_command', {
      cmd: 'printf extra',
      sandbox_permissions: 'with_additional_permissions',
      additional_permissions: { network: { enabled: true } },
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toMatchObject({
      reason: expect.stringContaining('高风险'),
    });

    const interactive = await host.runTool(
      'exec_command',
      {
        cmd: `${nodeCommand()} -e "process.stdin.once('data', d => { process.stdout.write('stdin:' + d.toString()); process.exit(0); }); setTimeout(() => {}, 10000)"`,
        yield_time_ms: 1,
      },
      { threadId: 'thread_1', turnId: 'turn_1' },
    );
    const processId = String((interactive.data as Record<string, unknown>).process_id || '');
    expect(processId).toBeTruthy();

    await expect(host.runTool('write_stdin', {
      session_id: processId,
      chars: 'hello\n',
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toMatchObject({
      content: expect.stringContaining('Wrote'),
    });
    const polled = await host.runTool('write_stdin', {
      session_id: processId,
      chars: '',
      yield_time_ms: 500,
    }, { threadId: 'thread_1', turnId: 'turn_1' });
    expect(polled.content).toContain('stdin:hello');
  });
});

async function createHost(options: { policyAmendmentStore?: PolicyAmendmentStore } = {}): Promise<{ host: PcLocalToolHost; projectDir: string; projectId: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-pc-toolhost-test-'));
  const projectDir = path.join(root, 'project');
  const dataDir = path.join(root, 'data');
  await mkdir(projectDir, { recursive: true });
  const store = new FileWorkspaceProjectStore(dataDir, systemClock);
  const project = await store.addProject({ path: projectDir });
  return { host: new PcLocalToolHost(store, options.policyAmendmentStore), projectDir, projectId: project.id };
}

class StaticPolicyAmendmentStore implements PolicyAmendmentStore {
  constructor(private readonly amendments: RuntimePolicyAmendments) {}

  async listPolicyAmendments(): Promise<RuntimePolicyAmendments> {
    return {
      execPolicyAmendments: this.amendments.execPolicyAmendments.map((item) => [...item]),
      networkPolicyAmendments: this.amendments.networkPolicyAmendments.map((item) => ({ ...item })),
    };
  }

  async appendExecPolicyAmendment(amendment: RuntimeExecPolicyAmendment): Promise<void> {
    this.amendments.execPolicyAmendments.push([...amendment]);
  }

  async appendNetworkPolicyAmendment(amendment: RuntimeNetworkPolicyAmendment): Promise<void> {
    this.amendments.networkPolicyAmendments.push({ ...amendment });
  }
}

function nodeCommand(): string {
  return JSON.stringify(process.execPath);
}

function shellApplyPatchCommand(filePath: string): string {
  return [
    "apply_patch <<'PATCH'",
    '*** Begin Patch',
    `*** Add File: ${filePath}`,
    '+generated',
    '*** End Patch',
    'PATCH',
  ].join('\n');
}
