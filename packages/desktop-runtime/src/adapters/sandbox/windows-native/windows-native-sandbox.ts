import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SandboxExecutionPlan } from '../../../ports/sandbox-execution-plan.js';

export const WINDOWS_SANDBOX_EXECUTABLE_ENV = 'SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH';
export const WINDOWS_SANDBOX_HOST_PID_ENV = 'SETSUNA_DESKTOP_HOST_PID';
const WINDOWS_SANDBOX_PROTOCOL_VERSION = 1;
const STATUS_CACHE_MS = 5_000;

export type WindowsNativeSandboxCapability = {
  supported: boolean;
  provider: 'windows-native' | '';
  reason: string;
  executablePath?: string;
};

type SidecarStatusEnvelope = {
  ok?: unknown;
  status?: {
    protocolVersion?: unknown;
    state?: unknown;
    reason?: unknown;
  };
};

type CachedCapability = {
  cacheKey: string;
  expiresAt: number;
  value: WindowsNativeSandboxCapability;
};

let cachedCapability: CachedCapability | null = null;

/**
 * Probe the bundled sidecar and its installed machine state. A short cache keeps
 * synchronous capability checks out of the hot shell-policy path while repair
 * and install actions still become visible quickly.
 */
export function windowsNativeSandboxCapability(options: {
  env?: NodeJS.ProcessEnv;
  now?: number;
  platform?: NodeJS.Platform | string;
  probe?: typeof probeWindowsSandbox;
} = {}): WindowsNativeSandboxCapability {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return {
      supported: false,
      provider: '',
      reason: 'Windows native sandbox 仅支持 Windows x64。',
    };
  }
  const env = options.env ?? process.env;
  const executablePath = String(env[WINDOWS_SANDBOX_EXECUTABLE_ENV] ?? '').trim();
  if (!executablePath || !path.win32.isAbsolute(executablePath)) {
    return {
      supported: false,
      provider: '',
      reason: `未配置绝对路径 ${WINDOWS_SANDBOX_EXECUTABLE_ENV}。`,
    };
  }
  const now = options.now ?? Date.now();
  const cacheKey = `${executablePath}\0${sidecarMtime(executablePath)}`;
  if (cachedCapability?.cacheKey === cacheKey && cachedCapability.expiresAt > now) {
    return cachedCapability.value;
  }
  const value = (options.probe ?? probeWindowsSandbox)(executablePath);
  // Do not cache not-installed/needs-repair. The settings action runs in Electron
  // main, so the runtime has no direct invalidation signal after elevation finishes.
  cachedCapability = value.supported
    ? { cacheKey, expiresAt: now + STATUS_CACHE_MS, value }
    : null;
  return value;
}

export function clearWindowsNativeSandboxCapabilityCache(): void {
  cachedCapability = null;
}

/**
 * Keep command control files outside the interactive user's private profile.
 * Windows Temp lets ordinary accounts create and traverse randomized children
 * without granting them directory listing or read access to another user's files.
 */
export function windowsNativeSandboxTempRoot(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = String(
    env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR ?? '',
  ).trim();
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) return '';
  const systemTemp = path.win32.join(systemRoot, 'Temp');
  return existsSync(systemTemp) ? systemTemp : '';
}

export async function writeWindowsSandboxRequest(
  command: string,
  plan: SandboxExecutionPlan,
  executionId: string,
  temporaryRoot: string,
): Promise<string> {
  if (plan.provider !== 'windows-native' || !plan.providerExecutable) {
    throw new Error('Windows sandbox request requires a resolved native provider.');
  }
  if (!temporaryRoot || !path.isAbsolute(temporaryRoot)) {
    throw new Error('Windows sandbox request requires an isolated temporary directory.');
  }
  const requestPath = path.join(temporaryRoot, 'sandbox-request.json');
  const request = {
    protocolVersion: WINDOWS_SANDBOX_PROTOCOL_VERSION,
    executionId,
    supervisorPids: sandboxSupervisorPids(process.env),
    command,
    cwd: plan.cwd,
    workspaceRoot: plan.workspaceRoot,
    permissionProfile: plan.permissionProfile,
    readableRoots: plan.readableRoots,
    writableRoots: plan.writableRoots,
    ephemeralWritableRoots: plan.ephemeralWritableRoots ?? [],
    deniedRoots: plan.deniedRoots,
    deniedGlobRegExpSources: plan.deniedGlobRegExpSources,
    protectedWritableRoots: plan.protectedWritableRoots,
    networkAccess: plan.networkAccess,
    environment: plan.environment,
  };
  await writeFile(requestPath, `${JSON.stringify(request)}\n`, { encoding: 'utf8', mode: 0o600 });
  return requestPath;
}

function sandboxSupervisorPids(env: NodeJS.ProcessEnv): number[] {
  const hostPid = Number.parseInt(String(env[WINDOWS_SANDBOX_HOST_PID_ENV] ?? ''), 10);
  return [...new Set([
    process.pid,
    ...(Number.isSafeInteger(hostPid) && hostPid > 0 ? [hostPid] : []),
  ])];
}

function probeWindowsSandbox(executablePath: string): WindowsNativeSandboxCapability {
  if (!isFile(executablePath)) {
    return {
      supported: false,
      provider: '',
      reason: `Windows sandbox sidecar 不存在：${executablePath}`,
    };
  }
  const result = spawnSync(executablePath, ['status'], {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error) {
    return {
      supported: false,
      provider: '',
      reason: `Windows sandbox 检测失败：${result.error.message}`,
    };
  }
  const line = String(result.stdout ?? '').trim().split(/\r?\n/u).at(-1) ?? '';
  let envelope: SidecarStatusEnvelope;
  try {
    envelope = JSON.parse(line) as SidecarStatusEnvelope;
  } catch {
    return {
      supported: false,
      provider: '',
      reason: 'Windows sandbox sidecar 返回了无效状态。',
    };
  }
  if (
    envelope.status?.protocolVersion !== WINDOWS_SANDBOX_PROTOCOL_VERSION
    || envelope.status.state !== 'ready'
  ) {
    return {
      supported: false,
      provider: '',
      reason: typeof envelope.status?.reason === 'string' && envelope.status.reason
        ? envelope.status.reason
        : 'Windows 原生沙箱尚未安装或需要修复。',
    };
  }
  return {
    supported: true,
    provider: 'windows-native',
    reason: '',
    executablePath: path.resolve(executablePath),
  };
}

function sidecarMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function isFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}
