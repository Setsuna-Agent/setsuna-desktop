import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOGIN_SHELL_ENV_MARKER = '__SETSUNA_DESKTOP_LOGIN_SHELL_ENV__';
const LOGIN_SHELL_ENV_TIMEOUT_MS = 5000;

/**
 * 从访达或程序坞启动的 macOS 图形应用继承的是 launchd 的精简环境，而不是
 * 用户终端登录 Shell 的环境。启动 runtime 前补全一次环境，使命令工具、
 * MCP 服务器和工作区应用发现使用与终端中一致的 PATH 和环境变量。
 */
export async function hydrateDesktopProcessEnvironment(options: { loadLoginShell: boolean } = { loadLoginShell: true }): Promise<void> {
  let loginShellEnv: NodeJS.ProcessEnv = {};
  if (options.loadLoginShell && process.platform === 'darwin' && process.env.SETSUNA_DESKTOP_SKIP_LOGIN_SHELL_ENV !== '1') {
    try {
      loginShellEnv = await resolveLoginShellEnvironment();
    } catch (error) {
      console.warn(`[desktop-env] failed to load login shell environment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const nextEnv = desktopProcessEnvironment(process.env, loginShellEnv);
  for (const [key, value] of Object.entries(nextEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
}

export function desktopProcessEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
  loginShellEnv: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...loginShellEnv,
    ...baseEnv,
  };
  const pathEnv = desktopShellPath([pathValue(loginShellEnv), pathValue(baseEnv)].filter(Boolean).join(path.delimiter));
  setPathValue(env, pathEnv);
  return env;
}

export function desktopShellPath(basePath = ''): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return uniquePathEntries([
    ...String(basePath || '').split(path.delimiter),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.setsuna-code', 'node', 'current', 'bin'),
    path.join(home, '.setsuna-code', 'npm-global', 'bin'),
    path.join(home, 'Library', 'pnpm'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.fnm'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.asdf', 'bin'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.yarn', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.deno', 'bin'),
  ]);
}

export async function resolveLoginShellEnvironment(shellPath = defaultLoginShell()): Promise<NodeJS.ProcessEnv> {
  const command = `/usr/bin/printf '${LOGIN_SHELL_ENV_MARKER}\\0'; /usr/bin/env -0`;
  const { stdout } = await execFileAsync(shellPath, ['-ilc', command], {
    encoding: 'buffer',
    env: process.env,
    maxBuffer: 1024 * 1024,
    timeout: LOGIN_SHELL_ENV_TIMEOUT_MS,
    windowsHide: true,
  });
  return parseNullSeparatedEnvironment(stdout);
}

export function parseNullSeparatedEnvironment(output: Buffer | string): NodeJS.ProcessEnv {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : output;
  const marker = `${LOGIN_SHELL_ENV_MARKER}\0`;
  const markerIndex = text.indexOf(marker);
  const body = markerIndex === -1 ? text : text.slice(markerIndex + marker.length);
  const env: NodeJS.ProcessEnv = {};

  for (const entry of body.split('\0')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const key = entry.slice(0, separator);
    if (!isPortableEnvKey(key)) continue;
    env[key] = entry.slice(separator + 1);
  }
  return env;
}

function defaultLoginShell(): string {
  const candidates = [
    process.env.SHELL,
    userInfo().shell,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ];
  return candidates.find((candidate) => candidate && path.isAbsolute(candidate) && existsSync(candidate)) ?? '/bin/sh';
}

function pathValue(env: NodeJS.ProcessEnv): string | undefined {
  return env.PATH ?? env.Path ?? Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1];
}

function setPathValue(env: NodeJS.ProcessEnv, value: string): void {
  const key = Object.keys(env).find((item) => item.toLowerCase() === 'path') ?? 'PATH';
  env[key] = value;
}

function uniquePathEntries(entries: string[]): string {
  return entries
    .map((entry) => entry.trim())
    .filter((entry, index, items) => entry && items.indexOf(entry) === index)
    .join(path.delimiter);
}

function isPortableEnvKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
