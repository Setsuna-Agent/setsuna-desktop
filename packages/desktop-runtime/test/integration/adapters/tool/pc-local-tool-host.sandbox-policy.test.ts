import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createShellSandboxExecutionPlan, shellSandboxCapability, shellSandboxProfile, shellSandboxUnavailableReason } from '../../../../src/adapters/tool/pc-local/pc-local-tools.js';
import { ToolExecutionError } from '../../../../src/ports/tool-host.js';
import { restrictedShellExecutionUnavailable, expectRestrictedShellUnavailable, createHost, StaticPolicyAmendmentStore, nodeCommand } from './pc-local-tool-host.support.js';

describe('pc local shell sandbox policy', () => {
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

    await expect(host.approvalForTool('exec_command', {
      cmd: 'git status --short; touch owned.txt',
      sandbox_permissions: 'require_escalated',
      justification: 'compound command must not reuse the prefix',
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toMatchObject({
      reason: expect.any(String),
    });

    await expect(host.approvalForTool('exec_command', {
      cmd: 'git status\ntouch owned.txt',
      sandbox_permissions: 'require_escalated',
      justification: 'newline-separated command must not reuse the prefix',
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toMatchObject({
      reason: expect.any(String),
    });
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

  it('does not treat a persisted host allow as process-wide shell authorization', async () => {
    const { host } = await createHost({
      policyAmendmentStore: new StaticPolicyAmendmentStore({
        execPolicyAmendments: [],
        networkPolicyAmendments: [{ host: 'example.com', action: 'allow' }],
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
    })).rejects.toMatchObject({
      failureKind: 'network_denied',
      message: expect.stringContaining('进程级网络访问'),
    });
  });

  it('checks every network target in a compound shell command', async () => {
    const { host } = await createHost({
      policyAmendmentStore: new StaticPolicyAmendmentStore({
        execPolicyAmendments: [],
        networkPolicyAmendments: [{ host: 'blocked.example', action: 'deny' }],
      }),
    });

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://allowed.example; curl https://blocked.example',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      failureKind: 'network_denied',
      data: { network_policy_decision: 'deny' },
      message: expect.stringContaining('blocked.example'),
    });

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://allowed.example\nssh blocked.example',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_2',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      failureKind: 'network_denied',
      data: { network_policy_decision: 'deny' },
      message: expect.stringContaining('blocked.example'),
    });
  });

  it('builds a macOS seatbelt profile for workspace-write shell sandboxing', async () => {
    const root = path.join(tmpdir(), 'setsuna seatbelt workspace');
    const writableRoot = path.join(tmpdir(), 'setsuna approved writes');
    const deniedRoot = path.join(root, 'blocked');
    const shellTempRoot = await realpath(tmpdir());
    const capability = { supported: true, provider: 'macos-seatbelt', reason: '' };
    const workspaceFilter = `(require-not (subpath ${JSON.stringify(path.resolve(root))}))`;
    const writableRootFilter = `(require-not (subpath ${JSON.stringify(path.resolve(writableRoot))}))`;
    const shellTempRootFilter = `(require-not (subpath ${JSON.stringify(shellTempRoot)}))`;
    const devNullFilter = `(require-not (literal ${JSON.stringify('/dev/null')}))`;
    const denyOutsideWritableRoots = `(deny file-write* (require-all ${workspaceFilter} ${writableRootFilter} ${shellTempRootFilter} ${devNullFilter}))`;

    const state = {
      root,
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {
        writableRoots: [writableRoot],
        deniedRoots: ['blocked'],
        deniedGlobPatterns: [path.join(root, '**/*.env')],
        networkAccess: false,
      },
    };
    const plan = createShellSandboxExecutionPlan(state, {
      capability,
      environment: { TMPDIR: tmpdir() },
      temporaryRoot: tmpdir(),
    });
    const profile = shellSandboxProfile(plan, capability);

    const lines = profile.split('\n');
    expect(lines.slice(0, 2)).toEqual(['(version 1)', '(allow default)']);
    expect(lines).toContain('(deny network*)');
    expect(lines).toContain(denyOutsideWritableRoots);
    expect(lines.some((line) => line.startsWith('(deny file-read* (require-all ')
      && line.includes(`(require-not (subpath ${JSON.stringify(path.resolve(root))}))`)
      && line.includes('(require-not (literal "/"))'))).toBe(true);
    expect(lines).toEqual(expect.arrayContaining([
      `(deny file-read* (literal ${JSON.stringify(path.resolve(deniedRoot))}))`,
      `(deny file-read* (subpath ${JSON.stringify(path.resolve(deniedRoot))}))`,
      `(deny file-write* (literal ${JSON.stringify(path.resolve(deniedRoot))}))`,
      `(deny file-write* (subpath ${JSON.stringify(path.resolve(deniedRoot))}))`,
      `(deny file-write* (literal ${JSON.stringify(path.join(path.resolve(root), '.git'))}))`,
    ]));
    expect(lines.some((line) => line.startsWith('(deny file-read* (regex ') && line.includes('.env'))).toBe(true);
    expect(lines.some((line) => line.startsWith('(deny file-write* (regex ') && line.includes('.env'))).toBe(true);
    expect(shellSandboxUnavailableReason({
      root,
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {},
    }, capability)).toBe('');
  });

  it('builds one explicit sandbox execution plan for the provider', async () => {
    const root = path.join(tmpdir(), 'setsuna-explicit-plan');
    const toolchainRoot = path.join(tmpdir(), 'setsuna-toolchain');
    const canonicalTempRoot = await realpath(tmpdir());
    const environment = {
      PATH: path.join(toolchainRoot, 'bin'),
      COREPACK_HOME: path.join(root, '.cache'),
      TMPDIR: tmpdir(),
    };
    const plan = createShellSandboxExecutionPlan({
      root,
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {
        readableRoots: [toolchainRoot],
        writableRoots: [path.join(root, '.cache')],
        networkAccess: false,
      },
    }, {
      cwd: root,
      environment,
      capability: { supported: true, provider: 'macos-seatbelt', reason: '' },
      temporaryRoot: tmpdir(),
    });

    expect(plan).toMatchObject({
      cwd: path.resolve(root),
      environment,
      networkAccess: false,
      permissionProfile: 'workspace-write',
      provider: 'macos-seatbelt',
      workspaceRoot: path.resolve(root),
    });
    expect(plan.readableRoots).toEqual(expect.arrayContaining([
      path.resolve(root),
      path.resolve(toolchainRoot),
      path.resolve(tmpdir()),
      canonicalTempRoot,
    ]));
    expect(plan.writableRoots).toEqual(expect.arrayContaining([
      path.resolve(root),
      path.join(path.resolve(root), '.cache'),
      canonicalTempRoot,
    ]));

    const planWithoutExplicitTempRoot = createShellSandboxExecutionPlan({
      root,
      osSandbox: true,
      permissionProfile: 'workspace-write',
    }, {
      environment,
      capability: { supported: true, provider: 'macos-seatbelt', reason: '' },
    });
    expect(planWithoutExplicitTempRoot.writableRoots).not.toContain(canonicalTempRoot);
  });

  it('keeps macOS seatbelt network open only after sandbox network approval', () => {
    const capability = { supported: true, provider: 'macos-seatbelt', reason: '' };
    const profile = shellSandboxProfile({
      root: path.join(tmpdir(), 'setsuna seatbelt network'),
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: { networkAccess: true },
    }, capability);

    expect(profile).not.toContain('(deny network*)');
    expect(profile).toContain('(deny file-write*');
  });

  it('routes restricted Windows shell execution through the sandbox-unavailable approval path', () => {
    const capability = shellSandboxCapability('win32', false, {
      supported: false,
      provider: '',
      reason: 'Windows native sandbox is unavailable.',
    });
    expect(capability).toMatchObject({ supported: false, provider: '' });
    expect(shellSandboxUnavailableReason({
      root: 'C:\\workspace',
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {},
    }, capability)).toContain('Windows native sandbox');
    expect(shellSandboxUnavailableReason({
      root: 'C:\\workspace',
      osSandbox: true,
      permissionProfile: 'danger-full-access',
      sandboxWorkspaceWrite: {},
    }, capability)).toBe('');
  });

  it('builds a native Windows plan and fails closed for unrepresentable deny rules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-windows-plan-'));
    const capability = {
      executablePath: 'C:\\Program Files\\Setsuna Desktop\\setsuna-sandbox-win.exe',
      provider: 'windows-native',
      reason: '',
      supported: true,
    };
    const plan = createShellSandboxExecutionPlan({
      osSandbox: true,
      permissionProfile: 'workspace-write',
      root,
      sandboxWorkspaceWrite: { networkAccess: true },
    }, {
      capability,
      environment: { HTTP_PROXY: 'http://sandbox:secret@127.0.0.1:61080' },
      temporaryRoot: root,
    });

    expect(plan).toMatchObject({
      networkAccess: true,
      permissionProfile: 'workspace-write',
      provider: 'windows-native',
      providerExecutable: capability.executablePath,
    });
    expect(plan.writableRoots).toContain(await realpath(root));
    expect(plan.ephemeralWritableRoots).toEqual([await realpath(root)]);
    expect(shellSandboxUnavailableReason({
      osSandbox: true,
      permissionProfile: 'workspace-write',
      root,
      sandboxWorkspaceWrite: { deniedRoots: ['private'] },
    }, capability)).toContain('已拒绝降级');
    expect(shellSandboxUnavailableReason({
      osSandbox: true,
      permissionProfile: 'workspace-write',
      root,
      sandboxWorkspaceWrite: { deniedGlobPatterns: ['**/*.secret'] },
    }, capability)).toContain('已拒绝降级');
  });

  it('allows read-only shell writes only inside approved writable roots', async () => {
    const { host, projectDir } = await createHost();
    const grantedDir = path.join(projectDir, 'granted');
    await mkdir(grantedDir, { recursive: true });

    const execution = host.runTool('run_shell_command', {
      command: 'touch granted/ok.txt',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { writableRoots: ['granted'] },
    });

    if (restrictedShellExecutionUnavailable) {
      await expectRestrictedShellUnavailable(execution);
      await expect(readFile(path.join(grantedDir, 'ok.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      const result = await execution;
      expect(result.content).toContain('Exit Code: 0');
      await expect(readFile(path.join(grantedDir, 'ok.txt'), 'utf8')).resolves.toBe('');
    }
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

  it('fails closed for opaque scripts under restricted shell profiles', async () => {
    const { host, projectDir, projectId } = await createHost();
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'setsuna-shell-escape-test-'));
    const outsideTarget = path.join(outsideDir, 'escaped.txt');
    await writeFile(path.join(projectDir, 'escape.cjs'), [
      "const { writeFileSync } = require('node:fs');",
      `writeFileSync(${JSON.stringify(outsideTarget)}, 'escaped');`,
      '',
    ].join('\n'), 'utf8');

    await expect(host.runTool('run_shell_command', {
      command: `${nodeCommand()} escape.cjs`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_restricted',
      turnId: 'turn_restricted',
      projectId,
      permissionProfile: 'workspace-write',
    })).rejects.toThrow();
    await expect(readFile(outsideTarget, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(host.runTool('run_shell_command', {
      command: `${nodeCommand()} escape.cjs`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_unrestricted',
      turnId: 'turn_unrestricted',
      projectId,
      permissionProfile: 'danger-full-access',
    })).resolves.toMatchObject({ content: expect.stringContaining('Sandbox: bypass') });
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('escaped');
  });

  it('keeps concurrent tool permissions isolated per invocation', async () => {
    const { host, projectDir, projectId } = await createHost();
    const [readOnlyWrite, workspaceWrite] = await Promise.allSettled([
      host.runTool('write_file', { file_path: 'read-only.txt', content: 'must not exist\n' }, {
        threadId: 'thread_read_only',
        turnId: 'turn_read_only',
        projectId,
        permissionProfile: 'read-only',
      }),
      host.runTool('write_file', { file_path: 'workspace.txt', content: 'allowed\n' }, {
        threadId: 'thread_workspace',
        turnId: 'turn_workspace',
        projectId,
        permissionProfile: 'workspace-write',
      }),
    ]);

    expect(readOnlyWrite.status).toBe('rejected');
    expect(workspaceWrite.status).toBe('fulfilled');
    await expect(readFile(path.join(projectDir, 'read-only.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(projectDir, 'workspace.txt'), 'utf8')).resolves.toBe('allowed\n');
  });
});
