import { spawn } from 'node:child_process';
import { powershellCommand } from '../utils/windows-shell.js';
import { prepareHookNodeEnvironment } from './runtime-hook-node-environment.js';
import type { CommandProcessRunResult, RuntimeDiscoveredHook } from './runtime-hook-types.js';

const HOOK_OUTPUT_CHARS_CAP = 1024 * 1024;

export async function runCommandHook(
  hook: RuntimeDiscoveredHook,
  stdin: string,
  cwd: string,
  dataPath: string,
  signal: AbortSignal | undefined,
): Promise<CommandProcessRunResult> {
  if (signal?.aborted) return abortedHookResult();
  let environment: NodeJS.ProcessEnv;
  try {
    // Prepare once, only when a trusted hook actually runs. No tool discovery,
    // downloads or executable version probes are needed for the bundled Node.
    environment = await prepareHookNodeEnvironment(dataPath);
  } catch (error) {
    return { exitCode: null, stdout: '', stderr: '', error: error instanceof Error ? error.message : String(error) };
  }
  if (signal?.aborted) return abortedHookResult();
  const shell = hookShellCommand(hook.command ?? '', environment);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(shell.file, shell.args, {
      cwd,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = (result: CommandProcessRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => {
      child.kill();
      finish({ exitCode: null, stdout, stderr, error: 'hook aborted' });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1, hook.timeoutSec) * 1000);
    signal?.addEventListener('abort', abort, { once: true });
    // Decode across stream chunks; a Chinese UTF-8 character may span data events.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = appendHookOutput(stdout, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = appendHookOutput(stderr, chunk);
    });
    child.on('error', (error) => finish({ exitCode: null, stdout, stderr, error: error.message }));
    child.on('close', (code) => {
      finish({
        exitCode: code,
        stdout,
        stderr,
        ...(timedOut ? { error: `hook timed out after ${hook.timeoutSec}s` } : {}),
      });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);
  });
}

export function hookShellCommand(
  command: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } {
  if (platform === 'win32') {
    // PowerShell's own localized diagnostics must use the same encoding as the
    // runtime decoder; configuring the native pipeline also preserves stdin JSON.
    const utf8Setup = [
      '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '$OutputEncoding = [Console]::OutputEncoding',
    ].join('; ');
    return {
      file: environment.SETSUNA_WINDOWS_SHELL || environment.SHELL || 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `${utf8Setup}; ${powershellCommand(command)}`],
    };
  }
  // The parent already provides the desktop environment. A login shell can
  // reorder PATH and put the host Node ahead of the app's hook entrypoint.
  return { file: '/bin/sh', args: ['-c', command] };
}

function appendHookOutput(current: string, chunk: string): string {
  if (current.length >= HOOK_OUTPUT_CHARS_CAP) return current;
  return (current + chunk).slice(0, HOOK_OUTPUT_CHARS_CAP);
}

function abortedHookResult(): CommandProcessRunResult {
  return { exitCode: null, stdout: '', stderr: '', error: 'hook aborted' };
}
