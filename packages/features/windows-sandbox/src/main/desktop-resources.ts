import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import {
  WINDOWS_SANDBOX_CA_BUNDLE_ENV,
  WINDOWS_SANDBOX_CURL_ENV,
  WINDOWS_SANDBOX_EXECUTABLE_ENV,
  WINDOWS_SANDBOX_HOST_PID_ENV,
} from '../contracts/index.js';
import { prepareSandboxCurlTrustBundle } from './sandbox-curl-trust.js';

type DesktopWindowsSandboxResourceOptions = Readonly<{
  appRoot: string;
  arch?: NodeJS.Architecture;
  env?: NodeJS.ProcessEnv;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
}>;

export type PreparedDesktopWindowsSandbox = Readonly<{
  executablePath?: string;
}>;

export async function prepareDesktopWindowsSandbox(
  options: DesktopWindowsSandboxResourceOptions & Readonly<{
    dataRoot: string;
    hostPid?: number;
  }>,
): Promise<PreparedDesktopWindowsSandbox> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    clearRuntimeEnvironment(env);
    return {};
  }

  const executablePath = resolveDesktopWindowsSandbox(options);
  const sandboxCurlPath = resolveDesktopSandboxCurl(options);
  const required = options.isPackaged;
  if (required && !executablePath) {
    throw new Error('Bundled Windows sandbox is required but was not resolved.');
  }
  if (required && !sandboxCurlPath) {
    throw new Error('Bundled sandbox curl is required but was not resolved.');
  }

  const sandboxCaBundlePath = sandboxCurlPath
    ? (await prepareSandboxCurlTrustBundle({
      bundledCaPath: path.join(path.dirname(sandboxCurlPath), 'curl-ca-bundle.crt'),
      destination: path.join(options.dataRoot, 'sandbox-trust', 'curl-ca-bundle.pem'),
    })).bundlePath
    : undefined;
  installWindowsSandboxRuntimeEnvironment(env, {
    executablePath,
    hostPid: options.hostPid ?? process.pid,
    required,
    sandboxCaBundlePath,
    sandboxCurlPath,
  });
  return executablePath ? { executablePath } : {};
}

/** Resolve the Windows security sidecar without ever falling back to PATH. */
export function resolveDesktopWindowsSandbox(
  options: DesktopWindowsSandboxResourceOptions,
): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return undefined;
  const arch = options.arch ?? process.arch;
  if (arch !== 'x64') throw new Error(`Windows sandbox does not support architecture ${arch}.`);
  const env = options.env ?? process.env;
  if (options.isPackaged) {
    const resourcesPath = options.resourcesPath ?? packagedResourcesPath(options.appRoot);
    return requireExecutable(
      path.join(resourcesPath, 'setsuna-sandbox', 'setsuna-sandbox-win.exe'),
      platform,
      'Bundled Windows sandbox',
    );
  }

  const explicitPath = String(env[WINDOWS_SANDBOX_EXECUTABLE_ENV] ?? '').trim();
  if (explicitPath) {
    if (!path.win32.isAbsolute(explicitPath) && !path.isAbsolute(explicitPath)) {
      throw new Error(`${WINDOWS_SANDBOX_EXECUTABLE_ENV} must be an absolute path.`);
    }
    return requireExecutable(explicitPath, platform, 'Windows sandbox sidecar');
  }

  const preparedPath = path.join(
    options.appRoot,
    '.cache',
    'windows-sandbox',
    'win-x64',
    'setsuna-sandbox-win.exe',
  );
  return isExecutable(preparedPath, platform) ? path.resolve(preparedPath) : undefined;
}

/** Resolve the LibreSSL curl used by restricted Windows shell commands. */
export function resolveDesktopSandboxCurl(
  options: DesktopWindowsSandboxResourceOptions,
): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return undefined;
  const arch = options.arch ?? process.arch;
  if (arch !== 'x64') throw new Error(`Sandbox curl does not support architecture ${arch}.`);
  const env = options.env ?? process.env;
  const explicitPath = String(env[WINDOWS_SANDBOX_CURL_ENV] ?? '').trim();
  const candidate = options.isPackaged
    ? path.join(
      options.resourcesPath ?? packagedResourcesPath(options.appRoot),
      'setsuna-path',
      'curl.exe',
    )
    : explicitPath || path.join(
      options.appRoot,
      '.cache',
      'sandbox-curl',
      'win-x64',
      'curl.exe',
    );
  if (!options.isPackaged && explicitPath) {
    if (!path.win32.isAbsolute(candidate) && !path.isAbsolute(candidate)) {
      throw new Error(`${WINDOWS_SANDBOX_CURL_ENV} must be an absolute path.`);
    }
  }
  if (!options.isPackaged && !isExecutable(candidate, platform)) return undefined;
  const executable = requireExecutable(candidate, platform, 'Bundled sandbox curl');
  requireFile(path.join(path.dirname(executable), 'curl-ca-bundle.crt'), 'Bundled sandbox curl CA bundle');
  requireFile(path.join(path.dirname(executable), '_curlrc'), 'Bundled sandbox curl configuration');
  return executable;
}

export function installWindowsSandboxRuntimeEnvironment(
  env: NodeJS.ProcessEnv,
  input: Readonly<{
    executablePath?: string;
    hostPid: number;
    required: boolean;
    sandboxCaBundlePath?: string;
    sandboxCurlPath?: string;
  }>,
): void {
  if (input.required && !input.executablePath) {
    throw new Error('Bundled Windows sandbox is required but was not resolved.');
  }
  if (input.required && !input.sandboxCurlPath) {
    throw new Error('Bundled sandbox curl is required for the packaged Windows runtime.');
  }
  if (input.required && !input.sandboxCaBundlePath) {
    throw new Error('Sandbox curl trust bundle is required for the packaged Windows runtime.');
  }
  setAbsoluteEnvironmentPath(env, WINDOWS_SANDBOX_EXECUTABLE_ENV, input.executablePath);
  setAbsoluteEnvironmentPath(env, WINDOWS_SANDBOX_CURL_ENV, input.sandboxCurlPath);
  setAbsoluteEnvironmentPath(env, WINDOWS_SANDBOX_CA_BUNDLE_ENV, input.sandboxCaBundlePath);
  env[WINDOWS_SANDBOX_HOST_PID_ENV] = String(input.hostPid);
}

function setAbsoluteEnvironmentPath(
  env: NodeJS.ProcessEnv,
  key: string,
  value: string | undefined,
): void {
  if (!value) {
    delete env[key];
    return;
  }
  if (!path.isAbsolute(value) && !path.win32.isAbsolute(value)) {
    throw new Error(`${key} must be an absolute path.`);
  }
  env[key] = value;
}

function clearRuntimeEnvironment(env: NodeJS.ProcessEnv): void {
  delete env[WINDOWS_SANDBOX_EXECUTABLE_ENV];
  delete env[WINDOWS_SANDBOX_CURL_ENV];
  delete env[WINDOWS_SANDBOX_CA_BUNDLE_ENV];
  delete env[WINDOWS_SANDBOX_HOST_PID_ENV];
}

function packagedResourcesPath(appRoot: string): string {
  return appRoot.endsWith('.asar') ? path.dirname(appRoot) : appRoot;
}

function requireExecutable(value: string, platform: NodeJS.Platform, label: string): string {
  const resolved = path.resolve(value);
  if (!isExecutable(resolved, platform)) {
    throw new Error(`${label} executable is missing or invalid: ${resolved}`);
  }
  return resolved;
}

function requireFile(value: string, label: string): string {
  const resolved = path.resolve(value);
  try {
    if (!statSync(resolved).isFile()) throw new Error('not a file');
    accessSync(resolved, constants.F_OK);
    return resolved;
  } catch {
    throw new Error(`${label} is missing or invalid: ${resolved}`);
  }
}

function isExecutable(value: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(value).isFile()) return false;
    accessSync(value, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
