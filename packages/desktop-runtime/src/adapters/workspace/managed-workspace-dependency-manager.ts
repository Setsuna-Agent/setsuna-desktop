import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type {
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependencySource,
  RuntimeWorkspaceDependencyToolStatus,
  RuntimeWorkspaceDependenciesToggleInput,
} from '@setsuna-desktop/contracts';
import type { ConfigStore } from '../../ports/config-store.js';
import type {
  WorkspaceDependencyManager,
  WorkspaceDependencyShellEnvironment,
} from '../../ports/workspace-dependency-manager.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';

const BUNDLE_VERSION = '2026.07.2';
const MANIFEST_FILE_NAME = 'manifest.json';
const MANAGED_PYTHON_VERSION = '3.12';
const MINIMUM_PYTHON_VERSION = [3, 10] as const;
const MINIMUM_NODE_MAJOR = 18;
const UV_VERSION = '0.11.28';
const MAX_COMMAND_OUTPUT_CHARS = 24_000;

type ManagedToolManifest = {
  path: string;
  source: RuntimeWorkspaceDependencySource;
  version: string;
};

type WorkspaceDependencyManifest = {
  bundleVersion: string;
  node: ManagedToolManifest;
  python: ManagedToolManifest;
  updatedAt: string;
  uv: ManagedToolManifest;
};

type CommandResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

/**
 * Supplies deterministic workspace binaries without modifying the user's shell
 * profile. Healthy host installations are wrapped in a private PATH; only
 * missing/obsolete tools are provisioned under the runtime data directory.
 */
export class ManagedWorkspaceDependencyManager implements WorkspaceDependencyManager {
  private readonly cacheRoot: string;
  private readonly installRoot: string;
  private readonly nodeBinDir: string;
  private readonly workspaceDependencyRoot: string;
  private installPromise: Promise<void> | null = null;
  private nodeShimReady = false;
  private nodeShimPromise: Promise<void> | null = null;
  private lastError: string | undefined;

  constructor(
    runtimeDataDir: string,
    private readonly configStore: ConfigStore,
  ) {
    this.workspaceDependencyRoot = path.join(runtimeDataDir, 'workspace-dependencies');
    this.cacheRoot = path.join(this.workspaceDependencyRoot, 'cache');
    this.installRoot = path.join(this.workspaceDependencyRoot, 'toolchain');
    this.nodeBinDir = path.join(this.workspaceDependencyRoot, 'bin');
  }

  async getStatus(): Promise<RuntimeWorkspaceDependenciesStatus> {
    return this.status(false);
  }

  async diagnose(): Promise<RuntimeWorkspaceDependenciesStatus> {
    return this.status(true);
  }

  async setEnabled(input: RuntimeWorkspaceDependenciesToggleInput): Promise<RuntimeWorkspaceDependenciesStatus> {
    const current = await this.configStore.getConfig();
    await this.configStore.saveConfig({
      desktopSettings: {
        ...(current.desktopSettings ?? {}),
        workspaceDependenciesEnabled: input.enabled,
      },
    });
    if (!input.enabled) this.lastError = undefined;
    if (input.enabled) await this.ensureInstalled(false).catch(() => undefined);
    return this.status(true);
  }

  async reinstall(): Promise<RuntimeWorkspaceDependenciesStatus> {
    const config = await this.configStore.getConfig();
    if (config.desktopSettings?.workspaceDependenciesEnabled !== true) {
      throw new Error('请先启用工作空间依赖项，再重新安装。');
    }
    await this.ensureInstalled(true);
    return this.status(true);
  }

  async prepareShellEnvironment(command: string): Promise<WorkspaceDependencyShellEnvironment | null> {
    const config = await this.configStore.getConfig();
    if (config.desktopSettings?.workspaceDependenciesEnabled !== true) return null;
    await Promise.all([
      this.ensureNodeShim(),
      mkdir(path.join(this.cacheRoot, 'uv'), { recursive: true }),
      mkdir(path.join(this.cacheRoot, 'pip'), { recursive: true }),
      mkdir(path.join(this.cacheRoot, 'npm'), { recursive: true }),
    ]);
    const existingManifest = await this.readManifest();
    // The default-on setting must not turn an unrelated first shell command into
    // a Python download. Provision lazily once a managed command is requested.
    const needsPython = usesPythonDependencyCommand(command);
    if (needsPython) await this.ensureInstalled(false);
    const manifest = needsPython ? await this.readManifest() : existingManifest;
    if (needsPython && !manifest) throw new Error('工作空间依赖项安装结果缺少清单。');
    const toolchainBinDir = manifest ? path.join(this.installRoot, 'bin') : null;
    return {
      environment: {
        PATH: prependPaths([this.nodeBinDir, toolchainBinDir], process.env.PATH),
        PIP_CACHE_DIR: path.join(this.cacheRoot, 'pip'),
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
        PIP_REQUIRE_VIRTUALENV: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        UV_CACHE_DIR: path.join(this.cacheRoot, 'uv'),
        UV_NO_MODIFY_PATH: '1',
        ...(manifest ? {
          UV_PYTHON: manifest.python.path,
          UV_PYTHON_BIN_DIR: path.join(this.installRoot, 'python-bin'),
          UV_PYTHON_INSTALL_DIR: path.join(this.installRoot, 'python'),
        } : {}),
        npm_config_cache: path.join(this.cacheRoot, 'npm'),
      },
      writableRoots: [this.cacheRoot],
    };
  }

  private async status(runChecks: boolean): Promise<RuntimeWorkspaceDependenciesStatus> {
    const config = await this.configStore.getConfig();
    const enabled = config.desktopSettings?.workspaceDependenciesEnabled === true;
    const manifest = await this.readManifest();
    const installing = Boolean(this.installPromise);
    const tools = manifest
      ? await this.toolStatuses(manifest, runChecks)
      : runChecks
        ? await this.availableHostTools()
        : { node: unavailableTool(), python: unavailableTool(), uv: unavailableTool() };
    const checks = [
      toolCheck('node', 'Node.js', tools.node, `需要 Node.js ${MINIMUM_NODE_MAJOR}+。`),
      toolCheck('python', 'Python', tools.python, `需要 Python ${MINIMUM_PYTHON_VERSION.join('.')}+。`),
      toolCheck('uv', 'uv', tools.uv, '用于隔离安装和运行 Python 依赖。'),
      {
        id: 'sandbox' as const,
        label: '沙箱网络',
        message: config.sandboxWorkspaceWrite?.networkAccess === true
          ? 'workspace-write 沙箱默认允许联网。'
          : 'workspace-write 沙箱联网已被关闭；工作区命令将无法访问网络。',
        status: config.sandboxWorkspaceWrite?.networkAccess === true ? 'ok' as const : 'warning' as const,
      },
    ];
    const ready = manifest?.bundleVersion === BUNDLE_VERSION
      && tools.node.available
      && tools.python.available
      && tools.uv.available;
    const state: RuntimeWorkspaceDependenciesStatus['state'] = !enabled
      ? 'disabled'
      : installing
        ? 'installing'
        : this.lastError
          ? 'error'
          : ready
            ? 'ready'
            : 'not-installed';
    return {
      bundleVersion: BUNDLE_VERSION,
      checks,
      enabled,
      ...(this.lastError ? { error: this.lastError } : {}),
      installPath: this.workspaceDependencyRoot,
      node: tools.node,
      python: tools.python,
      state,
      ...(manifest?.updatedAt ? { updatedAt: manifest.updatedAt } : {}),
      uv: tools.uv,
    };
  }

  private async toolStatuses(
    manifest: WorkspaceDependencyManifest,
    runChecks: boolean,
  ): Promise<{
    node: RuntimeWorkspaceDependencyToolStatus;
    python: RuntimeWorkspaceDependencyToolStatus;
    uv: RuntimeWorkspaceDependencyToolStatus;
  }> {
    if (!runChecks) {
      return {
        node: manifestToolStatus(manifest.node),
        python: manifestToolStatus(manifest.python),
        uv: manifestToolStatus(manifest.uv),
      };
    }
    const [node, python, uv] = await Promise.all([
      checkedToolStatus(manifest.node, ['--version']),
      checkedToolStatus(manifest.python, ['--version']),
      checkedToolStatus(manifest.uv, ['--version']),
    ]);
    return { node, python, uv };
  }

  private async availableHostTools(): Promise<{
    node: RuntimeWorkspaceDependencyToolStatus;
    python: RuntimeWorkspaceDependencyToolStatus;
    uv: RuntimeWorkspaceDependencyToolStatus;
  }> {
    const [node, python, uv] = await Promise.all([
      this.resolveNode().catch(() => null),
      this.findSystemPython(),
      this.findSystemUv(),
    ]);
    return {
      node: node ? manifestToolStatus(node) : unavailableTool(),
      python: python ? manifestToolStatus(python) : unavailableTool(),
      uv: uv ? manifestToolStatus(uv) : unavailableTool(),
    };
  }

  private async ensureInstalled(force: boolean): Promise<void> {
    if (this.installPromise) return this.installPromise;
    if (!force) {
      const manifest = await this.readManifest();
      if (manifest?.bundleVersion === BUNDLE_VERSION && await manifestIsUsable(manifest)) {
        this.lastError = undefined;
        return;
      }
    }
    this.installPromise = this.install().then(() => {
      this.lastError = undefined;
    }).catch((error: unknown) => {
      this.lastError = errorMessage(error);
      throw error;
    }).finally(() => {
      this.installPromise = null;
    });
    return this.installPromise;
  }

  private async ensureNodeShim(): Promise<void> {
    if (this.nodeShimReady) return;
    if (this.nodeShimPromise) return this.nodeShimPromise;
    this.nodeShimPromise = (async () => {
      await mkdir(this.nodeBinDir, { recursive: true });
      await writeCommandShim(this.nodeBinDir, 'node', process.execPath, { electronRunAsNode: true });
      this.nodeShimReady = true;
    })().finally(() => {
      this.nodeShimPromise = null;
    });
    return this.nodeShimPromise;
  }

  private async install(): Promise<void> {
    const parentDir = path.dirname(this.installRoot);
    const stagingRoot = `${this.installRoot}.install-${process.pid}-${randomUUID()}`;
    const backupRoot = `${this.installRoot}.backup-${process.pid}-${randomUUID()}`;
    await mkdir(parentDir, { recursive: true });
    await rm(stagingRoot, { recursive: true, force: true });
    let previousMoved = false;
    try {
      const manifest = await this.buildInstallation(stagingRoot);
      await writeJsonFile(path.join(stagingRoot, MANIFEST_FILE_NAME), manifest);
      if (await pathExists(this.installRoot)) {
        await rename(this.installRoot, backupRoot);
        previousMoved = true;
      }
      await rename(stagingRoot, this.installRoot);
      if (previousMoved) await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
    } catch (error) {
      if (previousMoved && !await pathExists(this.installRoot) && await pathExists(backupRoot)) {
        await rename(backupRoot, this.installRoot).catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async buildInstallation(stagingRoot: string): Promise<WorkspaceDependencyManifest> {
    const binDir = path.join(stagingRoot, 'bin');
    const uvInstallDir = path.join(stagingRoot, 'uv-bin');
    const pythonBinDir = path.join(stagingRoot, 'python-bin');
    const pythonInstallDir = path.join(stagingRoot, 'python');
    await Promise.all([
      mkdir(binDir, { recursive: true }),
      mkdir(uvInstallDir, { recursive: true }),
      mkdir(pythonBinDir, { recursive: true }),
      mkdir(pythonInstallDir, { recursive: true }),
      mkdir(path.join(this.cacheRoot, 'uv'), { recursive: true }),
    ]);

    const node = await this.resolveNode();
    const uv = await this.resolveUv(stagingRoot, uvInstallDir);
    const python = await this.resolvePython(uv, pythonBinDir, pythonInstallDir, path.join(this.cacheRoot, 'uv'));
    const finalNode = relocateManagedTool(node, stagingRoot, this.installRoot);
    const finalUv = relocateManagedTool(uv, stagingRoot, this.installRoot);
    const finalPython = relocateManagedTool(python, stagingRoot, this.installRoot);

    await Promise.all([
      writeCommandShim(binDir, 'python', finalPython.path),
      writeCommandShim(binDir, 'python3', finalPython.path),
      writeCommandShim(binDir, 'uv', finalUv.path),
      writeUvPipShim(binDir, 'pip', finalUv.path),
      writeUvPipShim(binDir, 'pip3', finalUv.path),
    ]);

    return {
      bundleVersion: BUNDLE_VERSION,
      node: finalNode,
      python: finalPython,
      updatedAt: new Date().toISOString(),
      uv: finalUv,
    };
  }

  private async resolveNode(): Promise<ManagedToolManifest> {
    const bundled = await runCommand(process.execPath, ['--version'], {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    });
    if (bundled.exitCode !== 0) throw new Error(`应用内置 Node.js 不可用：${commandFailure(bundled)}`);
    return { path: process.execPath, source: 'bundled', version: versionText(bundled) };
  }

  private async resolveUv(stagingRoot: string, uvInstallDir: string): Promise<ManagedToolManifest> {
    const systemUv = await this.findSystemUv();
    if (systemUv) return systemUv;

    const installerExtension = process.platform === 'win32' ? 'ps1' : 'sh';
    const installerUrl = `https://astral.sh/uv/${UV_VERSION}/install.${installerExtension}`;
    const installerPath = path.join(stagingRoot, `install-uv.${installerExtension}`);
    const response = await fetch(installerUrl);
    if (!response.ok) throw new Error(`下载 uv 安装器失败：HTTP ${response.status}`);
    await writeFile(installerPath, new Uint8Array(await response.arrayBuffer()));
    const installerEnv = {
      ...process.env,
      UV_NO_MODIFY_PATH: '1',
      UV_UNMANAGED_INSTALL: uvInstallDir,
    };
    const result = process.platform === 'win32'
      ? await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', installerPath], installerEnv)
      : await runCommand('/bin/sh', [installerPath], installerEnv);
    if (result.exitCode !== 0) throw new Error(`安装 uv 失败：${commandFailure(result)}`);
    const uvPath = path.join(uvInstallDir, executableName('uv'));
    const versionResult = await runCommand(uvPath, ['--version']);
    if (versionResult.exitCode !== 0) throw new Error(`托管 uv 不可用：${commandFailure(versionResult)}`);
    return { path: uvPath, source: 'managed', version: versionText(versionResult) };
  }

  private async resolvePython(
    uv: ManagedToolManifest,
    pythonBinDir: string,
    pythonInstallDir: string,
    uvCacheDir: string,
  ): Promise<ManagedToolManifest> {
    const systemPython = await this.findSystemPython();
    if (systemPython) return systemPython;

    const result = await runCommand(uv.path, [
      'python',
      'install',
      MANAGED_PYTHON_VERSION,
      '--install-dir',
      pythonInstallDir,
      '--default',
      '--managed-python',
      '--no-progress',
    ], {
      ...process.env,
      UV_CACHE_DIR: uvCacheDir,
      UV_NO_MODIFY_PATH: '1',
      UV_PYTHON_BIN_DIR: pythonBinDir,
      UV_PYTHON_INSTALL_DIR: pythonInstallDir,
    });
    if (result.exitCode !== 0) throw new Error(`安装托管 Python ${MANAGED_PYTHON_VERSION} 失败：${commandFailure(result)}`);
    const pythonPath = await findManagedPython(pythonBinDir, pythonInstallDir);
    if (!pythonPath) throw new Error('uv 已完成，但未找到托管 Python 可执行文件。');
    const versionResult = await runCommand(pythonPath, ['--version']);
    if (versionResult.exitCode !== 0) throw new Error(`托管 Python 不可用：${commandFailure(versionResult)}`);
    return { path: pythonPath, source: 'managed', version: versionText(versionResult) };
  }

  private async findSystemPython(): Promise<ManagedToolManifest | null> {
    for (const command of process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python']) {
      const executable = await findExecutable(command);
      if (!executable) continue;
      const result = await runCommand(executable, ['--version']);
      const version = versionText(result);
      if (result.exitCode === 0 && versionAtLeast(version, MINIMUM_PYTHON_VERSION)) {
        return { path: executable, source: 'system', version };
      }
    }
    return null;
  }

  private async findSystemUv(): Promise<ManagedToolManifest | null> {
    const executable = await findExecutable('uv');
    if (!executable) return null;
    const result = await runCommand(executable, ['--version']);
    return result.exitCode === 0
      ? { path: executable, source: 'system', version: versionText(result) }
      : null;
  }

  private async readManifest(): Promise<WorkspaceDependencyManifest | null> {
    const manifestPath = path.join(this.installRoot, MANIFEST_FILE_NAME);
    return readJsonFile<WorkspaceDependencyManifest | null>(manifestPath, null).catch(() => null);
  }
}

function unavailableTool(): RuntimeWorkspaceDependencyToolStatus {
  return { available: false };
}

function manifestToolStatus(tool: ManagedToolManifest): RuntimeWorkspaceDependencyToolStatus {
  return { available: true, path: tool.path, source: tool.source, version: tool.version };
}

async function checkedToolStatus(tool: ManagedToolManifest, args: string[]): Promise<RuntimeWorkspaceDependencyToolStatus> {
  const result = await runCommand(tool.path, args, tool.source === 'bundled' ? {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  } : undefined).catch(() => null);
  return result?.exitCode === 0
    ? { available: true, path: tool.path, source: tool.source, version: versionText(result) || tool.version }
    : { available: false, path: tool.path, source: tool.source, version: tool.version };
}

function toolCheck(
  id: 'node' | 'python' | 'uv',
  label: string,
  tool: RuntimeWorkspaceDependencyToolStatus,
  unavailableMessage: string,
) {
  return {
    id,
    label,
    message: tool.available
      ? `${tool.version ?? '版本未知'} · ${sourceLabel(tool.source)} · ${tool.path ?? '路径未知'}`
      : unavailableMessage,
    status: tool.available ? 'ok' as const : 'error' as const,
  };
}

function sourceLabel(source: RuntimeWorkspaceDependencySource | undefined): string {
  if (source === 'system') return '复用本机';
  if (source === 'bundled') return '应用内置';
  return '应用托管';
}

async function manifestIsUsable(manifest: WorkspaceDependencyManifest): Promise<boolean> {
  const results = await Promise.all([
    checkedToolStatus(manifest.node, ['--version']),
    checkedToolStatus(manifest.python, ['--version']),
    checkedToolStatus(manifest.uv, ['--version']),
  ]);
  return results.every((tool) => tool.available);
}

function relocateManagedTool(tool: ManagedToolManifest, fromRoot: string, toRoot: string): ManagedToolManifest {
  return {
    ...tool,
    path: tool.source === 'managed' ? relocatePath(tool.path, fromRoot, toRoot) : tool.path,
  };
}

function relocatePath(value: string, fromRoot: string, toRoot: string): string {
  const relative = path.relative(fromRoot, value);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? path.join(toRoot, relative)
    : value;
}

async function findExecutable(command: string): Promise<string | null> {
  if (path.isAbsolute(command)) return await executableExists(command) ? command : null;
  const extensions = process.platform === 'win32'
    ? executableExtensions(command)
    : [''];
  for (const directory of String(process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, command.endsWith(extension) ? command : `${command}${extension}`);
      if (await executableExists(candidate)) return candidate;
    }
  }
  return null;
}

function executableExtensions(command: string): string[] {
  if (path.extname(command)) return [''];
  return String(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
}

async function executableExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findManagedPython(pythonBinDir: string, pythonInstallDir: string): Promise<string | null> {
  for (const fileName of process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python']) {
    const direct = path.join(pythonBinDir, fileName);
    if (await executableExists(direct)) return direct;
  }
  return findFileRecursively(pythonInstallDir, new Set(process.platform === 'win32' ? ['python.exe'] : ['python3', 'python']), 4);
}

async function findFileRecursively(root: string, names: ReadonlySet<string>, depth: number): Promise<string | null> {
  if (depth < 0) return null;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && names.has(entry.name) && await executableExists(candidate)) return candidate;
    if (entry.isDirectory()) {
      const nested = await findFileRecursively(candidate, names, depth - 1);
      if (nested) return nested;
    }
  }
  return null;
}

async function writeCommandShim(
  binDir: string,
  name: string,
  target: string,
  options: { electronRunAsNode?: boolean } = {},
): Promise<void> {
  if (process.platform === 'win32') {
    const prefix = options.electronRunAsNode ? 'set "ELECTRON_RUN_AS_NODE=1"\r\n' : '';
    await writeFile(path.join(binDir, `${name}.cmd`), `@echo off\r\n${prefix}"${target}" %*\r\n`, 'utf8');
    return;
  }
  const environment = options.electronRunAsNode ? 'ELECTRON_RUN_AS_NODE=1 ' : '';
  const shimPath = path.join(binDir, name);
  await writeFile(shimPath, `#!/bin/sh\n${environment}exec ${shellQuote(target)} "$@"\n`, { encoding: 'utf8', mode: 0o755 });
  await access(shimPath, fsConstants.X_OK);
}

async function writeUvPipShim(binDir: string, name: string, uvPath: string): Promise<void> {
  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, `${name}.cmd`), `@echo off\r\n"${uvPath}" pip %*\r\n`, 'utf8');
    return;
  }
  const shimPath = path.join(binDir, name);
  await writeFile(shimPath, `#!/bin/sh\nexec ${shellQuote(uvPath)} pip "$@"\n`, { encoding: 'utf8', mode: 0o755 });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function executableName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function prependPaths(directories: Array<string | null>, current: string | undefined): string {
  return [...directories, ...(current ?? '').split(path.delimiter)]
    .filter((item, index, all) => Boolean(item) && all.indexOf(item) === index)
    .join(path.delimiter);
}

function usesPythonDependencyCommand(command: string): boolean {
  const tool = String.raw`(?:python(?:3(?:\.\d+)*)?(?:\.exe)?|pip3?(?:\.exe)?|uv(?:\.exe)?)`;
  return new RegExp(String.raw`(?:^|[\s;&|()])["']?${tool}["']?(?=$|[\s;&|()])`, 'u').test(command);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function versionText(result: CommandResult): string {
  return (result.stdout || result.stderr).trim().split(/\r?\n/u)[0] ?? '';
}

function versionAtLeast(version: string, minimum: readonly [number, number]): boolean {
  const match = version.match(/(\d+)\.(\d+)/u);
  if (!match) return false;
  const current = [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)] as const;
  return current[0] > minimum[0] || (current[0] === minimum[0] && current[1] >= minimum[1]);
}

function commandFailure(result: CommandResult): string {
  return (result.stderr || result.stdout || `exit code ${String(result.exitCode)}`).trim().slice(0, 1200);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runCommand(command: string, args: string[], environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      env: environment ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendCommandOutput(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendCommandOutput(stderr, chunk.toString());
    });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stderr, stdout }));
  });
}

function appendCommandOutput(current: string, delta: string): string {
  const next = current + delta;
  return next.length <= MAX_COMMAND_OUTPUT_CHARS ? next : next.slice(-MAX_COMMAND_OUTPUT_CHARS);
}
