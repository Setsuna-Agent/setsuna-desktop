import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { prependPathDirectory } from './desktop-environment.js';

export const BUNDLED_RIPGREP_ENV = 'SETSUNA_DESKTOP_RG_PATH';
export const REQUIRE_BUNDLED_RIPGREP_ENV = 'SETSUNA_DESKTOP_REQUIRE_BUNDLED_RG';
export const BUNDLED_WINDOWS_SANDBOX_ENV = 'SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH';
export const BUNDLED_SANDBOX_CURL_ENV = 'SETSUNA_DESKTOP_SANDBOX_CURL_PATH';

type ResolveDesktopRipgrepOptions = {
  appRoot: string;
  arch?: NodeJS.Architecture;
  env?: NodeJS.ProcessEnv;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
};

type ResolveDesktopWindowsSandboxOptions = ResolveDesktopRipgrepOptions;
type ResolveDesktopSandboxCurlOptions = ResolveDesktopRipgrepOptions;

/** Resolve an absolute executable path so internal search never depends on shell lookup. */
export function resolveDesktopRipgrep(options: ResolveDesktopRipgrepOptions): string | undefined {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  if (options.isPackaged) {
    const resourcesPath = options.resourcesPath ?? packagedResourcesPath(options.appRoot);
    return requireExecutable(
      path.join(resourcesPath, 'setsuna-path', executableName(platform)),
      platform,
      'Bundled ripgrep',
    );
  }

  const explicitPath = String(env[BUNDLED_RIPGREP_ENV] ?? '').trim();
  if (explicitPath) {
    if (!path.isAbsolute(explicitPath)) throw new Error(`${BUNDLED_RIPGREP_ENV} must be an absolute path.`);
    return requireExecutable(explicitPath, platform, 'Bundled ripgrep');
  }

  const builderOs = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
  const preparedPath = path.join(options.appRoot, '.cache', 'ripgrep', `${builderOs}-${arch}`, executableName(platform));
  if (isExecutable(preparedPath, platform)) return path.resolve(preparedPath);
  return findExecutableOnPath('rg', env, platform);
}

/** Install both the explicit internal path and a shell-compatible PATH entry. */
export function installDesktopRipgrepEnvironment(
  env: NodeJS.ProcessEnv,
  ripgrepPath: string | undefined,
  options: { required: boolean },
): void {
  if (options.required && !ripgrepPath) throw new Error('Bundled ripgrep is required but was not resolved.');
  if (!ripgrepPath) return;
  env[BUNDLED_RIPGREP_ENV] = ripgrepPath;
  if (options.required) env[REQUIRE_BUNDLED_RIPGREP_ENV] = '1';
  prependPathDirectory(env, path.dirname(ripgrepPath));
}

/** Resolve the Windows security sidecar without ever falling back to PATH. */
export function resolveDesktopWindowsSandbox(
  options: ResolveDesktopWindowsSandboxOptions,
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

  const explicitPath = String(env[BUNDLED_WINDOWS_SANDBOX_ENV] ?? '').trim();
  if (explicitPath) {
    if (!path.win32.isAbsolute(explicitPath) && !path.isAbsolute(explicitPath)) {
      throw new Error(`${BUNDLED_WINDOWS_SANDBOX_ENV} must be an absolute path.`);
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

export function installDesktopWindowsSandboxEnvironment(
  env: NodeJS.ProcessEnv,
  executablePath: string | undefined,
  options: { required: boolean },
): void {
  if (options.required && !executablePath) {
    throw new Error('Bundled Windows sandbox is required but was not resolved.');
  }
  if (executablePath) env[BUNDLED_WINDOWS_SANDBOX_ENV] = executablePath;
  else delete env[BUNDLED_WINDOWS_SANDBOX_ENV];
}

/** Resolve the LibreSSL curl used by restricted Windows shell commands. */
export function resolveDesktopSandboxCurl(
  options: ResolveDesktopSandboxCurlOptions,
): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return undefined;
  const arch = options.arch ?? process.arch;
  if (arch !== 'x64') throw new Error(`Sandbox curl does not support architecture ${arch}.`);
  const env = options.env ?? process.env;
  const candidate = options.isPackaged
    ? path.join(
      options.resourcesPath ?? packagedResourcesPath(options.appRoot),
      'setsuna-path',
      'curl.exe',
    )
    : String(env[BUNDLED_SANDBOX_CURL_ENV] ?? '').trim() || path.join(
      options.appRoot,
      '.cache',
      'sandbox-curl',
      'win-x64',
      'curl.exe',
    );
  if (!options.isPackaged && String(env[BUNDLED_SANDBOX_CURL_ENV] ?? '').trim()) {
    if (!path.win32.isAbsolute(candidate) && !path.isAbsolute(candidate)) {
      throw new Error(`${BUNDLED_SANDBOX_CURL_ENV} must be an absolute path.`);
    }
  }
  if (!options.isPackaged && !isExecutable(candidate, platform)) return undefined;
  const executable = requireExecutable(candidate, platform, 'Bundled sandbox curl');
  requireFile(path.join(path.dirname(executable), 'curl-ca-bundle.crt'), 'Bundled sandbox curl CA bundle');
  requireFile(path.join(path.dirname(executable), '_curlrc'), 'Bundled sandbox curl configuration');
  return executable;
}

export function findExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const pathValue = environmentValue(env, 'PATH') ?? '';
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const extensions = platform === 'win32'
    ? executableExtensions(command, environmentValue(env, 'PATHEXT'))
    : [''];
  for (const entry of pathValue.split(delimiter).map((value) => value.trim()).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${command}${extension}`);
      if (isExecutable(candidate, platform)) return path.resolve(candidate);
    }
  }
  return undefined;
}

function packagedResourcesPath(appRoot: string): string {
  return appRoot.endsWith('.asar') ? path.dirname(appRoot) : appRoot;
}

function executableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'rg.exe' : 'rg';
}

function requireExecutable(value: string, platform: NodeJS.Platform, label: string): string {
  const resolved = path.resolve(value);
  if (!isExecutable(resolved, platform)) throw new Error(`${label} executable is missing or invalid: ${resolved}`);
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

function environmentValue(env: NodeJS.ProcessEnv, requestedKey: string): string | undefined {
  return Object.entries(env).find(([key]) => key.toLowerCase() === requestedKey.toLowerCase())?.[1];
}

function executableExtensions(command: string, pathExt: string | undefined): string[] {
  if (path.extname(command)) return [''];
  const values = String(pathExt || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(values)];
}
