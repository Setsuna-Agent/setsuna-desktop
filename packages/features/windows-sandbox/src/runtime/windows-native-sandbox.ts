import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  WindowsNativeSandboxCapability,
  WindowsSandboxCommandRequest,
  WindowsSandboxRuntimeService,
} from '../contracts/index.js';
import {
  WINDOWS_SANDBOX_CA_BUNDLE_ENV,
  WINDOWS_SANDBOX_CURL_ENV,
  WINDOWS_SANDBOX_EXECUTABLE_ENV,
  WINDOWS_SANDBOX_HOST_PID_ENV,
} from '../contracts/index.js';

const WINDOWS_SANDBOX_PROTOCOL_VERSION = 1;
const STATUS_CACHE_MS = 5_000;
const SETSUNA_DESKTOP_DATA_DIR_ENV = 'SETSUNA_DESKTOP_DATA_DIR';

// Match Codex's Windows full-read boundary, with product-owned state added to
// the credential-oriented exclusions. AppData itself remains usable for
// per-user toolchains; the active Setsuna data root is carved out below.
const WINDOWS_PROFILE_READ_EXCLUSIONS = new Set([
  '.ssh',
  '.tsh',
  '.brev',
  '.gnupg',
  '.aws',
  '.azure',
  '.kube',
  '.docker',
  '.config',
  '.npm',
  '.pki',
  '.terraform.d',
  '.codex',
  '.setsuna',
].map((name) => name.toLowerCase()));

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

export class WindowsNativeSandboxService implements WindowsSandboxRuntimeService {
  capability(): WindowsNativeSandboxCapability {
    return windowsNativeSandboxCapability();
  }

  controlRoot(): string {
    return windowsNativeSandboxTempRoot();
  }

  prepareEnvironment(environment: Record<string, string>) {
    return prepareWindowsSandboxEnvironment(environment);
  }

  writeRequest(input: WindowsSandboxCommandRequest): Promise<string> {
    return writeWindowsSandboxRequest(input);
  }
}

function prepareWindowsSandboxEnvironment(environment: Record<string, string>): Readonly<{
  environment: Record<string, string>;
  readableRoots: readonly string[];
}> {
  const nextEnvironment = { ...environment };
  const readableRoots = windowsSandboxDefaultReadableRoots(process.env);
  const executablePath = existingAbsoluteFile(process.env[WINDOWS_SANDBOX_CURL_ENV]);
  const caBundlePath = existingAbsoluteFile(process.env[WINDOWS_SANDBOX_CA_BUNDLE_ENV]);
  if (!executablePath || !caBundlePath) {
    return { environment: nextEnvironment, readableRoots };
  }
  const pathApi = usesWindowsPathSemantics(executablePath) ? path.win32 : path;
  const directory = pathApi.dirname(executablePath);
  const configPath = existingAbsoluteFile(pathApi.join(directory, '_curlrc'));
  const delimiter = usesWindowsPathSemantics(executablePath) ? ';' : path.delimiter;
  const existingPath = environmentValue(nextEnvironment, 'PATH');
  const comparison = (value: string) => usesWindowsPathSemantics(executablePath)
    ? value.toLowerCase()
    : value;
  const directoryKey = comparison(directory);
  const pathEntries = existingPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry && comparison(entry) !== directoryKey);
  setEnvironmentValue(nextEnvironment, 'PATH', [directory, ...pathEntries].join(delimiter));
  setEnvironmentValue(nextEnvironment, 'CURL_HOME', directory);
  setEnvironmentValue(nextEnvironment, 'CURL_CA_BUNDLE', caBundlePath);
  return {
    environment: nextEnvironment,
    readableRoots: uniqueWindowsPaths([
      ...readableRoots,
      executablePath,
      caBundlePath,
      configPath,
    ].filter(Boolean)),
  };
}

/**
 * Resolve the stable Windows read baseline once per execution plan. System
 * directories cover machine-wide tools; user-profile children cover per-user
 * toolchains without granting the profile root or known credential stores.
 */
export function windowsSandboxDefaultReadableRoots(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const systemRoot = environmentValue(env, 'SystemRoot') || environmentValue(env, 'WINDIR');
  const platformRoots = [
    systemRoot,
    environmentValue(env, 'ProgramFiles'),
    environmentValue(env, 'ProgramFiles(x86)'),
    environmentValue(env, 'ProgramData'),
  ].map(existingAbsolutePath).filter(Boolean);
  const profileRoot = existingAbsoluteDirectory(environmentValue(env, 'USERPROFILE'));
  if (!profileRoot) return uniqueWindowsPaths(platformRoots);

  const protectedRoots = [
    existingAbsolutePath(environmentValue(env, SETSUNA_DESKTOP_DATA_DIR_ENV)),
    ...[...WINDOWS_PROFILE_READ_EXCLUSIONS]
      .map((name) => existingAbsolutePath(path.join(profileRoot, name))),
  ].filter(Boolean);
  let profileEntries: string[];
  try {
    profileEntries = readdirSync(profileRoot)
      .filter((name) => !WINDOWS_PROFILE_READ_EXCLUSIONS.has(name.toLowerCase()))
      .map((name) => existingAbsolutePath(path.join(profileRoot, name)))
      .filter((entry) => entry !== '' && isPathWithin(entry, profileRoot));
  } catch {
    // Do not fall back to the whole profile: that would bypass the exclusions.
    profileEntries = [];
  }

  return uniqueWindowsPaths([
    ...readableRootsExcluding(platformRoots, protectedRoots),
    ...readableRootsExcluding(profileEntries, protectedRoots),
  ]);
}

function readableRootsExcluding(
  candidates: readonly string[],
  protectedRoots: readonly string[],
  depth = 0,
): string[] {
  if (depth >= 32) return [];
  const roots: string[] = [];
  for (const candidate of candidates) {
    const resolvedCandidate = existingAbsolutePath(candidate);
    if (!resolvedCandidate) continue;
    const nestedProtectedRoots = protectedRoots.filter((protectedRoot) => (
      isPathWithin(protectedRoot, resolvedCandidate)
      || isPathWithin(resolvedCandidate, protectedRoot)
    ));
    if (!nestedProtectedRoots.length) {
      roots.push(candidate);
      continue;
    }
    if (nestedProtectedRoots.some((protectedRoot) => isPathWithin(resolvedCandidate, protectedRoot))) {
      continue;
    }
    let children: string[];
    try {
      children = readdirSync(resolvedCandidate).map((name) => path.join(resolvedCandidate, name));
    } catch {
      continue;
    }
    roots.push(...readableRootsExcluding(children, nestedProtectedRoots, depth + 1));
  }
  return roots;
}

function existingAbsolutePath(value: unknown): string {
  const candidate = String(value ?? '').trim();
  if (!candidate || (!path.isAbsolute(candidate) && !path.win32.isAbsolute(candidate))) return '';
  try {
    statSync(candidate);
    return realpathSync.native(candidate);
  } catch {
    return '';
  }
}

function existingAbsoluteDirectory(value: unknown): string {
  const candidate = existingAbsolutePath(value);
  if (!candidate) return '';
  try {
    return statSync(candidate).isDirectory() ? candidate : '';
  } catch {
    return '';
  }
}

function isPathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function uniqueWindowsPaths(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = process.platform === 'win32' ? value.toLowerCase() : value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function existingAbsoluteFile(value: unknown): string {
  const candidate = String(value ?? '').trim();
  if (!candidate || (!path.isAbsolute(candidate) && !path.win32.isAbsolute(candidate))) return '';
  try {
    return statSync(candidate).isFile() ? candidate : '';
  } catch {
    return '';
  }
}

function usesWindowsPathSemantics(value: string): boolean {
  if (process.platform === 'win32') return true;
  return /^[a-z]:[\\/]/iu.test(value) || /^\\\\/u.test(value);
}

function environmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? environment[key] ?? '' : '';
}

function setEnvironmentValue(
  environment: Record<string, string>,
  name: string,
  value: string,
): void {
  for (const key of Object.keys(environment)) {
    if (key !== name && key.toLowerCase() === name.toLowerCase()) delete environment[key];
  }
  environment[name] = value;
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
  input: WindowsSandboxCommandRequest,
): Promise<string> {
  if (!input.providerExecutable) {
    throw new Error('Windows sandbox request requires a resolved native provider.');
  }
  if (!input.controlRoot || !path.isAbsolute(input.controlRoot)) {
    throw new Error('Windows sandbox request requires an isolated temporary directory.');
  }
  const requestPath = path.join(input.controlRoot, 'sandbox-request.json');
  const request = {
    protocolVersion: WINDOWS_SANDBOX_PROTOCOL_VERSION,
    executionId: input.executionId,
    supervisorPids: sandboxSupervisorPids(process.env),
    command: input.command,
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    permissionProfile: input.permissionProfile,
    readableRoots: input.readableRoots,
    writableRoots: input.writableRoots,
    ephemeralWritableRoots: input.ephemeralWritableRoots,
    deniedRoots: input.deniedRoots,
    deniedGlobRegExpSources: input.deniedGlobRegExpSources,
    protectedWritableRoots: input.protectedWritableRoots,
    networkAccess: input.networkAccess,
    environment: input.environment,
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
