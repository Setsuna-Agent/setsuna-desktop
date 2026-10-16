import { accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { desktopProcessEnvironment, prependPathDirectory } from './desktop-environment.js';

export type RuntimeProcessEnvironmentOptions = {
  appVersion: string;
  ripgrepPath?: string;
  requireBundledRipgrep?: boolean;
};

export function resolvePackagedRuntimeEntry(appRoot: string): string {
  return path.join(appRoot, 'dist/runtime/cli.cjs');
}

export function resolveBuiltinSkillsDir(appRoot: string): string {
  return path.join(appRoot, 'skills');
}

export function resolveBuiltinPluginsDir(appRoot: string): string {
  return path.join(appRoot, 'plugins');
}

export function resolveRuntimeSpawnCwd(appRoot: string): string {
  return appRoot.endsWith('.asar') ? path.dirname(appRoot) : appRoot;
}

/**
 * Electron 的 macOS Helper 与主程序使用相同的 Node ABI，但被标记为 LSUIElement。
 * Node 模式从 Helper 启动后，runtime 内的 process.execPath 也会指向 Helper，因此工作空间
 * 依赖管理器生成的 node 垫片不会在每次 pnpm/test 调用时闪烁 Dock 图标。
 */
export function resolveRuntimeNodeExecutable(
  executablePath: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
  isExecutable: (candidate: string) => boolean = executableExists,
): string {
  if (platform !== 'darwin') return executablePath;

  const macosDir = path.dirname(executablePath);
  const contentsDir = path.dirname(macosDir);
  const appBundleDir = path.dirname(contentsDir);
  if (
    path.basename(macosDir) !== 'MacOS'
    || path.basename(contentsDir) !== 'Contents'
    || path.extname(appBundleDir) !== '.app'
  ) {
    return executablePath;
  }

  // electron-builder 通常按 app bundle 命名 Helper；同时兼容主可执行文件自定义名称。
  const helperBaseNames = [
    path.basename(appBundleDir, '.app'),
    path.basename(executablePath),
  ];
  for (const baseName of new Set(helperBaseNames)) {
    const helperName = `${baseName} Helper`;
    const helperPath = path.join(
      contentsDir,
      'Frameworks',
      `${helperName}.app`,
      'Contents',
      'MacOS',
      helperName,
    );
    if (isExecutable(helperPath)) return helperPath;
  }
  return executablePath;
}

export function runtimeProcessEnvironment(
  options: RuntimeProcessEnvironmentOptions,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = desktopProcessEnvironment(baseEnv);
  // 主 App 和 macOS Helper 都必须显式进入 Node 模式，否则会启动 Electron 桌面实例。
  env.ELECTRON_RUN_AS_NODE = '1';
  env.SETSUNA_DESKTOP_APP_VERSION = options.appVersion;
  if (options.requireBundledRipgrep && !options.ripgrepPath) {
    throw new Error('Bundled ripgrep is required for the packaged runtime.');
  }
  if (options.ripgrepPath) {
    env.SETSUNA_DESKTOP_RG_PATH = options.ripgrepPath;
    prependPathDirectory(env, path.dirname(options.ripgrepPath));
  }
  if (options.requireBundledRipgrep) env.SETSUNA_DESKTOP_REQUIRE_BUNDLED_RG = '1';
  return env;
}

function executableExists(candidate: string): boolean {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
