import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { prependPathDirectory } from './desktop-environment.js';

export const BUNDLED_RIPGREP_ENV = 'SETSUNA_DESKTOP_RG_PATH';
export const REQUIRE_BUNDLED_RIPGREP_ENV = 'SETSUNA_DESKTOP_REQUIRE_BUNDLED_RG';

type ResolveDesktopRipgrepOptions = {
  appRoot: string;
  arch?: NodeJS.Architecture;
  env?: NodeJS.ProcessEnv;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
};

/** Resolve an absolute executable path so internal search never depends on shell lookup. */
export function resolveDesktopRipgrep(options: ResolveDesktopRipgrepOptions): string | undefined {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  if (options.isPackaged) {
    const resourcesPath = options.resourcesPath ?? packagedResourcesPath(options.appRoot);
    return requireExecutable(path.join(resourcesPath, 'setsuna-path', executableName(platform)), platform);
  }

  const explicitPath = String(env[BUNDLED_RIPGREP_ENV] ?? '').trim();
  if (explicitPath) {
    if (!path.isAbsolute(explicitPath)) throw new Error(`${BUNDLED_RIPGREP_ENV} must be an absolute path.`);
    return requireExecutable(explicitPath, platform);
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

function requireExecutable(value: string, platform: NodeJS.Platform): string {
  const resolved = path.resolve(value);
  if (!isExecutable(resolved, platform)) throw new Error(`Bundled ripgrep executable is missing or invalid: ${resolved}`);
  return resolved;
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
