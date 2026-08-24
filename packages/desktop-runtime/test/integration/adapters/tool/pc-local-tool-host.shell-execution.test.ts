import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_DEPENDENCY_SETTINGS } from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import { ManagedWorkspaceDependencyManager } from '@setsuna-desktop/feature-workspace-dependencies/runtime';
import { PcLocalToolHost } from '../../../../src/adapters/tool/pc-local/pc-local-tool-host.js';
import { shellCommandHiddenBySandbox } from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-process.js';
import { createHost, stubWorkspaceDependencyManager, commandAvailableOnPath, nodeCommand } from './pc-local-tool-host.support.js';

describe('pc local shell execution', () => {
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
        permissionProfile: 'danger-full-access',
        onToolOutputDelta: (delta) => deltas.push(delta),
      },
    );

    expect(result.content).toContain('pc delta');
    expect(deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ delta: expect.stringContaining('pc delta'), stream: 'stdout', processId: expect.any(String) }),
    ]));
  });

  it('does not retain pending progress output after a shell command yields', async () => {
    const { host } = await createHost();
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'danger-full-access' as const,
      onToolOutputDelta: () => undefined,
    };
    const running = await host.runTool('run_shell_command', {
      command: `${nodeCommand()} -e "setTimeout(() => process.stdout.write('x'.repeat(500000)), 20); setInterval(() => {}, 1000)"`,
      risk_level: 'low',
      yield_time_ms: 1,
    }, context);
    const processId = String((running.data as Record<string, unknown>).process_id || '');

    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const processStore = (host as unknown as {
        shellProcessStore: { sessions: Map<string, { pendingStdout: string; pendingStderr: string; stdout: string }> };
      }).shellProcessStore;
      const session = processStore.sessions.get(processId);
      expect(session?.pendingStdout).toBe('');
      expect(session?.pendingStderr).toBe('');
      expect(session?.stdout.length).toBeLessThanOrEqual(240_000);
    } finally {
      await host.runTool('terminate_shell_process', { process_id: processId }, context).catch(() => undefined);
    }
  });

  it('propagates a pre-aborted shell invocation as cancellation', async () => {
    const { host } = await createHost();
    const controller = new AbortController();
    controller.abort('cancel before spawn');

    await expect(host.runTool('run_shell_command', {
      command: `${nodeCommand()} -e "setInterval(() => {}, 1000)"`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'danger-full-access',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError', message: 'cancel before spawn' });
  });

  it('propagates a pre-aborted Git invocation as cancellation', async () => {
    const { host } = await createHost();
    const controller = new AbortController();
    controller.abort('cancel git');

    await expect(host.runTool('git_status', {}, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError', message: 'cancel git' });
  });

  it('returns complete shell output when a command fails', async () => {
    const { host } = await createHost();

    await expect(host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "process.stderr.write('precise shell failure\\n'); process.exit(7)"`,
        risk_level: 'low',
        yield_time_ms: 0,
      },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        sandbox: { mode: 'bypass' },
      },
    )).rejects.toThrow('precise shell failure');
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('preserves the managed PATH inside the macOS shell sandbox', async () => {
    let managedBin = '';
    const workspaceDependencies = stubWorkspaceDependencyManager({
      prepareShellToolchain: async () => ({
        commands: {
          python3: { executablePath: path.join(managedBin, 'python3'), installationRoot: managedBin },
        },
        environment: { PATH: [managedBin, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter) },
        readableRoots: [managedBin],
        writableCacheRoots: [],
      }),
    });
    const { host, projectDir } = await createHost({ workspaceDependencies });
    managedBin = path.join(projectDir, '.managed-bin');
    const managedPython = path.join(managedBin, 'python3');
    await mkdir(managedBin, { recursive: true });
    await writeFile(managedPython, '#!/bin/sh\necho "Python 3.12.99 managed"\n', 'utf8');
    await chmod(managedPython, 0o755);

    const result = await host.runTool('run_shell_command', {
      command: 'command -v python3 && python3 --version',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: { networkAccess: false },
    });

    expect(result.content).toContain(managedPython);
    expect(result.content).toContain('Python 3.12.99 managed');
    expect(result.content).not.toContain('/usr/bin/python3');
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('follows fnm-style PATH and package symlinks inside the macOS shell sandbox', async () => {
    const dependencyRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-fnm-toolchain-'));
    const installationRoot = path.join(dependencyRoot, 'node-versions', 'v22.23.1', 'installation');
    const installationBin = path.join(installationRoot, 'bin');
    const packageExecutable = path.join(installationRoot, 'lib', 'node_modules', 'setsuna-tool', 'bin', 'setsuna-fnm-tool-test');
    const defaultAlias = path.join(dependencyRoot, 'aliases', 'default');
    const sessionRoot = path.join(dependencyRoot, 'fnm_multishells', 'session');
    await mkdir(path.dirname(packageExecutable), { recursive: true });
    await mkdir(installationBin, { recursive: true });
    await mkdir(path.dirname(defaultAlias), { recursive: true });
    await mkdir(path.dirname(sessionRoot), { recursive: true });
    await writeFile(packageExecutable, '#!/bin/sh\necho "fnm package tool available"\n', 'utf8');
    await chmod(packageExecutable, 0o755);
    await symlink('../lib/node_modules/setsuna-tool/bin/setsuna-fnm-tool-test', path.join(installationBin, 'setsuna-fnm-tool-test'));
    await symlink(installationRoot, defaultAlias);
    await symlink(defaultAlias, sessionRoot);
    const workspaceDependencies = stubWorkspaceDependencyManager({
      prepareShellToolchain: async () => ({
        commands: {
          'setsuna-fnm-tool-test': {
            executablePath: path.join(sessionRoot, 'bin', 'setsuna-fnm-tool-test'),
            installationRoot,
          },
        },
        environment: { PATH: [path.join(sessionRoot, 'bin'), '/usr/bin', '/bin'].join(path.delimiter) },
        readableRoots: [path.join(sessionRoot, 'bin'), installationRoot],
        writableCacheRoots: [],
      }),
    });
    const { host } = await createHost({ workspaceDependencies });

    try {
      const result = await host.runTool('run_shell_command', {
        command: 'setsuna-fnm-tool-test --version',
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('fnm package tool available');
    } finally {
      await host.shutdown();
      await rm(dependencyRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('grants managed toolchain read roots to the macOS shell sandbox', async () => {
    const managedRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-managed-toolchain-'));
    const wrapperBin = path.join(managedRoot, 'bin');
    const target = path.join(managedRoot, 'toolchain', 'python', 'bin', 'setsuna-managed-python-test');
    const marker = path.join(managedRoot, 'toolchain', 'python', 'lib', 'marker.txt');
    await mkdir(wrapperBin, { recursive: true });
    await mkdir(path.dirname(target), { recursive: true });
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, 'managed Python stdlib readable\n', 'utf8');
    await writeFile(target, `#!/bin/sh\n/bin/cat ${JSON.stringify(marker)}\n`, 'utf8');
    await chmod(target, 0o755);
    await writeFile(path.join(wrapperBin, 'setsuna-managed-python-test'), `#!/bin/sh\nexec ${JSON.stringify(target)} "$@"\n`, 'utf8');
    await chmod(path.join(wrapperBin, 'setsuna-managed-python-test'), 0o755);
    const workspaceDependencies = stubWorkspaceDependencyManager({
      prepareShellToolchain: async () => ({
        commands: {
          'setsuna-managed-python-test': {
            executablePath: path.join(wrapperBin, 'setsuna-managed-python-test'),
            installationRoot: managedRoot,
          },
        },
        environment: { PATH: [wrapperBin, '/usr/bin', '/bin'].join(path.delimiter) },
        readableRoots: [managedRoot],
        writableCacheRoots: [],
      }),
    });
    const { host } = await createHost({ workspaceDependencies });

    try {
      const result = await host.runTool('run_shell_command', {
        command: 'setsuna-managed-python-test',
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('managed Python stdlib readable');
    } finally {
      await host.shutdown();
      await rm(managedRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(
    process.platform !== 'darwin'
      || !existsSync('/usr/bin/sandbox-exec')
      || !['node', 'pnpm', 'corepack', 'python3', 'pip3', 'uv'].every(commandAvailableOnPath),
  )('runs the baseline Node and Python toolchain through the real macOS sandbox', async () => {
    const dependencyDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-real-toolchain-'));
    const previousPath = process.env.PATH;
    const runtimePackageBin = path.resolve('node_modules', '.bin');
    process.env.PATH = String(previousPath ?? '')
      .split(path.delimiter)
      .filter((entry) => entry && path.resolve(entry) !== runtimePackageBin)
      .join(path.delimiter);
    const workspaceDependencies = createManagedWorkspaceDependencies(dependencyDataDir);
    const { host } = await createHost({ workspaceDependencies });

    try {
      const result = await host.runTool('run_shell_command', {
        command: [
          'node --version',
          'pnpm --version',
          'corepack --version',
          'python3 --version',
          'pip3 --version',
          'uv --version',
        ].join(' && '),
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('Sandbox: macos-seatbelt');
      expect(result.content).toMatch(/v\d+\.\d+/u);
      expect(result.content).toContain('Python');
      expect(result.content).toContain('uv');
    } finally {
      process.env.PATH = previousPath;
      await host.shutdown();
      await rm(dependencyDataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(
    process.platform !== 'darwin'
      || !existsSync('/usr/bin/sandbox-exec')
      || !commandAvailableOnPath('node'),
  )('allows the active macOS temp directory when the workspace is elsewhere', async () => {
    const dependencyDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-temp-sandbox-'));
    const workspaceDependencies = createManagedWorkspaceDependencies(dependencyDataDir);
    const { host, projectDir, fixtureRoot } = await createHost({
      fixtureRootParent: homedir(),
      workspaceDependencies,
    });
    const scriptName = 'verify-sandbox-temp.cjs';
    await writeFile(path.join(projectDir, scriptName), [
      "const fs = require('node:fs');",
      "const os = require('node:os');",
      "const path = require('node:path');",
      'const tempRoot = fs.realpathSync(os.tmpdir());',
      "const marker = path.join(tempRoot, `setsuna-temp-${process.pid}-${Date.now()}`);",
      "fs.writeFileSync(marker, 'ok');",
      'fs.unlinkSync(marker);',
      "process.stdout.write(`temp-ok:${tempRoot}\\n`);",
    ].join('\n'), 'utf8');

    try {
      const result = await host.runTool('run_shell_command', {
        command: `node ${scriptName}`,
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('Sandbox: macos-seatbelt');
      const shellTempRoot = result.content.match(/^temp-ok:(.+)$/mu)?.[1]?.trim();
      expect(shellTempRoot).toBeTruthy();
      expect(path.dirname(String(shellTempRoot))).toBe(await realpath(tmpdir()));
      expect(path.basename(String(shellTempRoot))).toMatch(/^setsuna-shell-/u);
      expect(existsSync(String(shellTempRoot))).toBe(false);
    } finally {
      await host.shutdown();
      await rm(fixtureRoot, { recursive: true, force: true });
      await rm(dependencyDataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('runs the app-owned Corepack fallback through the real macOS sandbox', async () => {
    const dependencyDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-bundled-corepack-sandbox-'));
    const fakeBin = path.join(dependencyDataDir, 'fake-bin');
    const previousPath = process.env.PATH;
    let host: PcLocalToolHost | null = null;
    await mkdir(fakeBin, { recursive: true });
    const fakeNode = path.join(fakeBin, 'node');
    await writeFile(fakeNode, '#!/bin/sh\necho v22.23.1\n', 'utf8');
    await chmod(fakeNode, 0o755);
    process.env.PATH = fakeBin;

    try {
      const workspaceDependencies = createManagedWorkspaceDependencies(dependencyDataDir);
      const created = await createHost({ workspaceDependencies });
      host = created.host;
      const result = await host.runTool('run_shell_command', {
        command: 'corepack --version',
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('Sandbox: macos-seatbelt');
      expect(result.content).toContain('0.34.7');
    } finally {
      process.env.PATH = previousPath;
      await host?.shutdown();
      await rm(dependencyDataDir, { recursive: true, force: true });
    }
  });

  it('classifies a host-visible command-not-found result as sandbox denial', async () => {
    const dependencyRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-hidden-path-tool-'));
    const binDir = path.join(dependencyRoot, 'bin');
    const executable = path.join(binDir, 'setsuna-hidden-path-tool-test');
    await mkdir(binDir, { recursive: true });
    await writeFile(executable, '#!/bin/sh\necho hidden tool\n', 'utf8');
    await chmod(executable, 0o755);

    try {
      const session = {
        cwd: dependencyRoot,
        environment: { PATH: binDir },
        exitCode: 127,
      };
      expect(shellCommandHiddenBySandbox(
        '/bin/sh: line 1: setsuna-hidden-path-tool-test: command not found',
        session,
      )).toBe(true);
      expect(shellCommandHiddenBySandbox('/bin/sh: missing-tool: command not found', session)).toBe(false);
    } finally {
      await rm(dependencyRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('enforces macOS shell readable roots after variable expansion', async () => {
    const { host, projectDir } = await createHost();
    const secretDir = await mkdtemp(path.join(homedir(), '.setsuna-seatbelt-secret-'));
    const secretPath = path.join(secretDir, 'secret.txt');
    await writeFile(secretPath, 'must stay private\n', 'utf8');
    await writeFile(path.join(projectDir, 'visible.txt'), 'workspace visible\n', 'utf8');
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write' as const,
      sandboxWorkspaceWrite: { networkAccess: false },
    };

    try {
      const visible = await host.runTool('run_shell_command', {
        command: 'cat visible.txt',
        risk_level: 'low',
        yield_time_ms: 0,
      }, context);
      expect(visible.content).toContain('workspace visible');

      await expect(host.runTool('run_shell_command', {
        command: `cat "$HOME/${path.basename(secretDir)}/secret.txt"`,
        risk_level: 'low',
        yield_time_ms: 0,
      }, context)).rejects.toMatchObject({
        failureKind: 'sandbox_denied',
        failureStage: 'execution',
      });
      await expect(host.runTool('run_shell_command', {
        command: 'cat /etc/passwd',
        risk_level: 'low',
        yield_time_ms: 0,
      }, context)).rejects.toMatchObject({
        failureKind: 'sandbox_denied',
        failureStage: 'execution',
      });
    } finally {
      await rm(secretDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('enforces denied globs in the macOS shell sandbox after variable expansion', async () => {
    const { host, projectDir } = await createHost();
    await writeFile(path.join(projectDir, '.env'), 'SECRET=blocked\n', 'utf8');

    await expect(host.runTool('run_shell_command', {
      command: 'suffix=env; cat ".${suffix}"',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {
        deniedGlobPatterns: [path.join(projectDir, '**/*.env')],
        networkAccess: false,
      },
    })).rejects.toMatchObject({
      failureKind: 'sandbox_denied',
      failureStage: 'execution',
    });
  });

  it('stops bounded range reads without buffering the rest of a large file', async () => {
    const { host, projectDir } = await createHost();
    await writeFile(path.join(projectDir, 'large.txt'), `first line\n${'x'.repeat(1_000_000)}`, 'utf8');

    const result = await host.runTool('read_file', {
      file_path: 'large.txt',
      offset: 1,
      limit: 1,
    }, { threadId: 'thread_1', turnId: 'turn_1' });

    expect(result.content).toContain('lines 1-1; file continues');
    expect(result.content).toContain('1: first line');
    expect(result.content.length).toBeLessThan(1_000);
  });

  it('supports Codex-compatible exec_command and write_stdin tool names', async () => {
    const { host } = await createHost();
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'danger-full-access' as const,
    };
    const execResult = await host.runTool(
      'exec_command',
      {
        cmd: `${nodeCommand()} -e "process.stdout.write('exec compat\\n')"`,
        yield_time_ms: 0,
      },
      context,
    );

    expect(execResult.content).toContain('exec compat');
    await expect(host.approvalForTool('exec_command', {
      cmd: 'printf risky',
      sandbox_permissions: 'require_escalated',
      justification: 'needs unsandboxed access',
    }, context)).resolves.toMatchObject({
      reason: expect.stringContaining('needs unsandboxed access'),
    });
    await expect(host.approvalForTool('exec_command', {
      cmd: 'printf extra',
      sandbox_permissions: 'with_additional_permissions',
      additional_permissions: { network: { enabled: true } },
    }, context)).resolves.toMatchObject({
      reason: expect.stringContaining('高风险'),
    });

    const interactive = await host.runTool(
      'exec_command',
      {
        cmd: `${nodeCommand()} -e "process.stdin.once('data', d => { process.stdout.write('stdin:' + d.toString()); process.exit(0); }); setInterval(() => {}, 1000)"`,
        yield_time_ms: 1,
      },
      context,
    );
    const processId = String((interactive.data as Record<string, unknown>).process_id || '');
    expect(processId).toBeTruthy();

    await expect(host.approvalForTool('write_stdin', {
      session_id: processId,
      chars: '',
    }, context)).resolves.toBeNull();
    await expect(host.approvalForTool('write_stdin', {
      session_id: processId,
      chars: 'hello\n',
    }, context)).resolves.toMatchObject({
      reason: expect.stringContaining('unsandboxed shell process'),
    });

    await expect(host.runTool('write_stdin', {
      session_id: processId,
      chars: 'hello\n',
    }, context)).resolves.toMatchObject({
      content: expect.stringContaining('Wrote'),
    });
    const polled = await host.runTool('write_stdin', {
      session_id: processId,
      chars: '',
      yield_time_ms: 500,
    }, context);
    expect(polled.content).toContain('stdin:hello');
  });
});

function createManagedWorkspaceDependencies(dataDir: string): ManagedWorkspaceDependencyManager {
  return new ManagedWorkspaceDependencyManager(
    dataDir,
    async () => DEFAULT_WORKSPACE_DEPENDENCY_SETTINGS,
    async () => true,
  );
}
