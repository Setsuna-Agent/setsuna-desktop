import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hookShellCommand, runCommandHook } from '../../src/hooks/runtime-hook-command.js';
import { prepareHookNodeEnvironment } from '../../src/hooks/runtime-hook-node-environment.js';
import { discoverRuntimeHooks } from '../../src/hooks/runtime-hooks.js';
import { HooksConfigStore } from '../support/agent-loop/shared.js';
import { createTestTempDirectory } from '../support/test-temp-directory.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe('hook command process', () => {
  it('preserves Chinese characters split across stdout and stderr data events', async () => {
    const root = await createTestTempDirectory('setsuna-hook-stream-');
    const config = await new HooksConfigStore({
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node hook.mjs', timeoutSec: 5 }] }],
    }).getConfig();
    const hook = discoverRuntimeHooks(config).hooks[0];
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      kill: vi.fn(),
    });
    const stdout = Buffer.from('{"systemMessage":"检查消息密钥"}', 'utf8');
    const stderr = Buffer.from('命令执行失败', 'utf8');
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => {
        const split = stdout.indexOf(Buffer.from('检')) + 1;
        child.stdout.write(stdout.subarray(0, split));
        child.stdout.end(stdout.subarray(split));
        child.stderr.write(stderr.subarray(0, 1));
        child.stderr.end(stderr.subarray(1));
        child.emit('close', 1);
      });
      return child as unknown as ReturnType<typeof spawn>;
    });

    await expect(runCommandHook(hook, '{}', root, root, undefined)).resolves.toEqual({
      exitCode: 1,
      stdout: stdout.toString('utf8'),
      stderr: stderr.toString('utf8'),
    });
  });

  it('prepares a single Windows PATH and configures PowerShell UTF-8 streams', async () => {
    const root = await createTestTempDirectory('setsuna hook windows-');
    const inherited = {
      Path: 'C:\\Windows\\System32',
      PATH: 'C:\\host-node',
      PATHEXT: '.EXE;.CMD;.BAT',
      SETSUNA_WINDOWS_SHELL: 'C:\\Program Files\\PowerShell\\pwsh.exe',
    };
    const environment = await prepareHookNodeEnvironment(root, inherited, 'win32');
    await access(path.join(root, 'hook-tools', 'bin', 'node.cmd'));

    expect(Object.keys(environment).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
    expect(environment.PATH?.split(';')).toEqual([path.join(root, 'hook-tools', 'bin'), inherited.Path]);
    expect(environment.SETSUNA_HOOK_NODE_PATH).toBe(process.execPath);
    expect(environment.PATHEXT).toBe(inherited.PATHEXT);
    expect(inherited.PATH).toBe('C:\\host-node');
    expect(inherited.Path).toBe('C:\\Windows\\System32');

    const shell = hookShellCommand('node hook.mjs', environment, 'win32');
    expect(shell.file).toBe(inherited.SETSUNA_WINDOWS_SHELL);
    expect(shell.args.at(-1)).toContain('[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)');
    expect(shell.args.at(-1)).toContain('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)');
    expect(shell.args.at(-1)).toContain('$OutputEncoding = [Console]::OutputEncoding');
    expect(shell.args.at(-1)).toContain('node hook.mjs; if ($global:LASTEXITCODE -ne $null) { exit $global:LASTEXITCODE }');
  });
});
