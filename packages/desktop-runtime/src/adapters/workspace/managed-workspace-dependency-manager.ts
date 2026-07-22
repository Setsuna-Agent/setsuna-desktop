import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  RuntimeEnvironment,
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependencySource,
  RuntimeWorkspaceDependencyToolStatus,
  RuntimeWorkspaceDependenciesToggleInput,
} from '@setsuna-desktop/contracts';
import type { ConfigStore } from '../../ports/config-store.js';
import type {
  PrepareShellToolchainInput,
  ShellToolchain,
  ShellToolchainCommand,
  WorkspaceDependencyManager,
  WorkspaceDependencyPromptContext,
} from '../../ports/workspace-dependency-manager.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';

const BUNDLE_VERSION = '2026.07.3';
const MANIFEST_FILE_NAME = 'manifest.json';
const MANAGED_PYTHON_VERSION = '3.12';
const MINIMUM_PYTHON_VERSION = [3, 10] as const;
const MINIMUM_NODE_MAJOR = 18;
const UV_VERSION = '0.11.28';
const FALLBACK_PNPM_VERSION = '7.33.7';
const MAX_COMMAND_OUTPUT_CHARS = 24_000;
const MAX_PROJECT_HINT_BYTES = 64 * 1024;
const BASELINE_SHELL_COMMANDS = [
  'node',
  'npm',
  'npx',
  'corepack',
  'pnpm',
  'python',
  'python3',
  'pip',
  'pip3',
  'uv',
  'git',
  'rg',
] as const;

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

type ProjectToolchainHints = {
  nodeVersion?: string;
  packageManager?: {
    name: 'bun' | 'npm' | 'pnpm' | 'yarn';
    version?: string;
  };
  pythonVersion?: string;
};

type PackageManagerShims = {
  binDir: string | null;
  readableRoots: string[];
};

type BundledCorepackEntrypoints = {
  corepack: string;
  npm: string;
  npx: string;
  root: string;
};

// 生产 runtime 会被 esbuild 输出为 CJS，不能依赖 import.meta.url。argv[1] 在开发和
// 打包后都指向实际 runtime 入口，因此 Node 的包解析会从应用自身的模块树开始。
const requireFromRuntime = createRequire(
  path.resolve(process.argv[1] ?? path.join(process.cwd(), 'setsuna-runtime.cjs')),
);

/**
 * 在不修改用户 Shell 配置的前提下提供确定的工作区二进制文件。可用的主机安装会通过
 * 私有 PATH 封装；只有缺失或过时的工具才会配置到 runtime 数据目录下。
 */
export class ManagedWorkspaceDependencyManager implements WorkspaceDependencyManager {
  private readonly cacheRoot: string;
  private readonly installRoot: string;
  private readonly nodeBinDir: string;
  private readonly projectBinDir: string;
  private readonly workspaceDependencyRoot: string;
  private installPromise: Promise<void> | null = null;
  private nodeShimTarget = '';
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
    this.projectBinDir = path.join(this.workspaceDependencyRoot, 'project-bin');
  }

  async getStatus(): Promise<RuntimeWorkspaceDependenciesStatus> {
    // 设置页每次进入都应反映真实可用性；这里只执行本机版本检查，
    // 不会触发下载或创建托管 Python 工具链。
    return this.status(true);
  }

  async getPromptContext(): Promise<WorkspaceDependencyPromptContext> {
    const config = await this.configStore.getConfig();
    return {
      enabled: config.desktopSettings?.workspaceDependenciesEnabled === true,
      packageIndexConfigured: Boolean(config.desktopSettings?.pythonPackageIndexUrl?.trim()),
    };
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

  async prepareShellToolchain({ command, environment }: PrepareShellToolchainInput): Promise<ShellToolchain> {
    const config = await this.configStore.getConfig();
    const enabled = config.desktopSettings?.workspaceDependenciesEnabled === true;
    const packageIndexUrl = typeof config.desktopSettings?.pythonPackageIndexUrl === 'string'
      ? config.desktopSettings.pythonPackageIndexUrl
      : '';
    const hints = await projectToolchainHints(environment);
    const hostNode = await this.findSystemNode();
    const bundledNode = await this.resolveNode();
    const selectedNode = preferredToolForVersion(hostNode, bundledNode, hints.nodeVersion);
    const useBundledNodeFallback = enabled && selectedNode?.source === 'bundled';
    if (useBundledNodeFallback && selectedNode) await this.ensureNodeShim(selectedNode);

    if (enabled) {
      await Promise.all([
        mkdir(path.join(this.cacheRoot, 'uv'), { recursive: true }),
        mkdir(path.join(this.cacheRoot, 'pip'), { recursive: true }),
        mkdir(path.join(this.cacheRoot, 'npm'), { recursive: true }),
        mkdir(path.join(this.cacheRoot, 'corepack'), { recursive: true }),
      ]);
    }

    const existingManifest = enabled ? await this.readManifest() : null;
    // 默认开启的设置不能让无关的首条 Shell 命令触发 Python 下载。
    // 只有请求受管理命令时才延迟配置。
    const needsPython = usesPythonDependencyCommand(command);
    if (enabled && needsPython) await this.ensureInstalled(false);
    const manifest = enabled && needsPython ? await this.readManifest() : existingManifest;
    if (enabled && needsPython && !manifest) throw new Error('工作空间依赖项安装结果缺少清单。');
    const toolchainBinDir = manifest ? path.join(this.installRoot, 'bin') : null;
    const packageManagerShims = enabled
      ? await this.ensureProjectPackageManagerShims(hints.packageManager, process.env.PATH)
      : { binDir: null, readableRoots: [] };
    const environmentOverrides = {
      PATH: composePaths([
        packageManagerShims.binDir,
        useBundledNodeFallback ? this.nodeBinDir : null,
      ], process.env.PATH, [toolchainBinDir]),
      ...(enabled ? {
        COREPACK_DEFAULT_TO_LATEST: '0',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        COREPACK_HOME: path.join(this.cacheRoot, 'corepack'),
        PIP_CACHE_DIR: path.join(this.cacheRoot, 'pip'),
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
        PIP_REQUIRE_VIRTUALENV: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        UV_CACHE_DIR: path.join(this.cacheRoot, 'uv'),
        UV_NO_MODIFY_PATH: '1',
        npm_config_cache: path.join(this.cacheRoot, 'npm'),
      } : {}),
      ...(enabled && packageIndexUrl ? {
        PIP_INDEX_URL: packageIndexUrl,
        UV_DEFAULT_INDEX: packageIndexUrl,
      } : {}),
      ...(manifest ? {
        UV_PYTHON: manifest.python.path,
        UV_PYTHON_BIN_DIR: path.join(this.installRoot, 'python-bin'),
        UV_PYTHON_INSTALL_DIR: path.join(this.installRoot, 'python'),
      } : {}),
    };
    const resolvedToolchain = await resolveShellToolchain(command, environmentOverrides.PATH);
    const managedRoots = [
      ...(manifest || packageManagerShims.binDir || useBundledNodeFallback ? [this.workspaceDependencyRoot] : []),
      ...(useBundledNodeFallback ? [runtimeExecutableReadRoot(process.execPath)] : []),
      ...packageManagerShims.readableRoots,
    ];
    return {
      commands: resolvedToolchain.commands,
      environment: environmentOverrides,
      readableRoots: uniqueSafeRoots([...resolvedToolchain.readableRoots, ...managedRoots]),
      writableCacheRoots: enabled ? [this.cacheRoot] : [],
    };
  }

  private async status(
    verifyManifest: boolean,
    inspectHostWhenMissing = verifyManifest,
  ): Promise<RuntimeWorkspaceDependenciesStatus> {
    const config = await this.configStore.getConfig();
    const enabled = config.desktopSettings?.workspaceDependenciesEnabled === true;
    const manifest = await this.readManifest();
    const installing = Boolean(this.installPromise);
    const tools = manifest
      ? await this.toolStatuses(manifest, verifyManifest)
      : inspectHostWhenMissing
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
    // 诊断可以在懒初始化清单落盘前确认本机工具链可用；只有已存在的清单
    // 才需要继续校验当前 bundle 版本。
    const ready = (!manifest || manifest.bundleVersion === BUNDLE_VERSION)
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
    const nodeTool = await this.findSystemNode().catch(() => null) ?? manifest.node;
    if (!runChecks) {
      return {
        node: manifestToolStatus(nodeTool),
        python: manifestToolStatus(manifest.python),
        uv: manifestToolStatus(manifest.uv),
      };
    }
    const [node, python, uv] = await Promise.all([
      checkedToolStatus(nodeTool, ['--version']),
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
      this.findSystemNode().then((tool) => tool ?? this.resolveNode()).catch(() => null),
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

  private async ensureNodeShim(node: ManagedToolManifest): Promise<void> {
    const targetKey = `${node.path}\0${node.source}`;
    if (this.nodeShimTarget === targetKey) return;
    if (this.nodeShimPromise) return this.nodeShimPromise;
    this.nodeShimPromise = (async () => {
      await mkdir(this.nodeBinDir, { recursive: true });
      await writeCommandShim(this.nodeBinDir, 'node', node.path, { electronRunAsNode: node.source === 'bundled' });
      this.nodeShimTarget = targetKey;
    })().finally(() => {
      this.nodeShimPromise = null;
    });
    return this.nodeShimPromise;
  }

  private async ensureProjectPackageManagerShims(
    packageManager: ProjectToolchainHints['packageManager'],
    currentPath: string | undefined,
  ): Promise<PackageManagerShims> {
    const bundledCorepack = resolveBundledCorepackEntrypoints();
    const bundledReadRoots: string[] = [];
    let corepack = await findExecutable('corepack', currentPath);
    let wroteShim = false;
    let wrotePnpmShim = false;
    let wroteNpmShim = false;
    let wroteNpxShim = false;

    if (!corepack && bundledCorepack) {
      await mkdir(this.projectBinDir, { recursive: true });
      await writeNodeScriptShim(this.projectBinDir, 'corepack', process.execPath, bundledCorepack.corepack);
      corepack = commandShimPath(this.projectBinDir, 'corepack');
      wroteShim = true;
      bundledReadRoots.push(bundledCorepack.root, runtimeExecutableReadRoot(process.execPath));
    }

    if (packageManager?.version && packageManager.name !== 'bun') {
      const existing = await findExecutable(packageManager.name, currentPath);
      const existingUsesBundledCorepack = existing && bundledCorepack
        ? await commandUsesBundledCorepack(existing, bundledCorepack.root)
        : false;
      const result = existing && !existingUsesBundledCorepack
        ? await runCommand(existing, ['--version']).catch(() => null)
        : null;
      if (!result || result.exitCode !== 0 || !versionMatchesHint(versionText(result), packageManager.version)) {
        if (corepack) {
          await mkdir(this.projectBinDir, { recursive: true });
          await writeCorepackShim(this.projectBinDir, packageManager.name, packageManager.version, corepack);
          wroteShim = true;
          wrotePnpmShim = packageManager.name === 'pnpm';
          wroteNpmShim = packageManager.name === 'npm';
          if (packageManager.name === 'npm') {
            await writeCorepackNpxShim(this.projectBinDir, packageManager.version, corepack);
            wroteNpxShim = true;
          }
        }
      }
    }

    // Electron ships Node.js but not npm/Corepack. The application-owned Corepack
    // entrypoints provide a deterministic fallback without changing global shims.
    if (!wroteNpmShim && !await findExecutable('npm', currentPath) && bundledCorepack) {
      await mkdir(this.projectBinDir, { recursive: true });
      await writeNodeScriptShim(this.projectBinDir, 'npm', process.execPath, bundledCorepack.npm);
      wroteShim = true;
      bundledReadRoots.push(bundledCorepack.root, runtimeExecutableReadRoot(process.execPath));
    }
    if (!wroteNpxShim && !await findExecutable('npx', currentPath) && bundledCorepack) {
      await mkdir(this.projectBinDir, { recursive: true });
      await writeNodeScriptShim(this.projectBinDir, 'npx', process.execPath, bundledCorepack.npx);
      wroteShim = true;
      bundledReadRoots.push(bundledCorepack.root, runtimeExecutableReadRoot(process.execPath));
    }
    // pnpm is part of the managed baseline even for non-Node projects. Corepack keeps the
    // package manager version deterministic without writing into the user's global prefix.
    const existingPnpm = wrotePnpmShim ? null : await findExecutable('pnpm', currentPath);
    const existingPnpmUsesBundledCorepack = existingPnpm && bundledCorepack
      ? await commandUsesBundledCorepack(existingPnpm, bundledCorepack.root)
      : false;
    if (!wrotePnpmShim && (!existingPnpm || existingPnpmUsesBundledCorepack) && corepack) {
      await mkdir(this.projectBinDir, { recursive: true });
      await writeCorepackShim(
        this.projectBinDir,
        'pnpm',
        packageManager?.name === 'pnpm' && packageManager.version ? packageManager.version : FALLBACK_PNPM_VERSION,
        corepack,
      );
      wroteShim = true;
    }
    return {
      binDir: wroteShim ? this.projectBinDir : null,
      readableRoots: uniqueSafeRoots(bundledReadRoots),
    };
  }

  private async install(): Promise<void> {
    const parentDir = path.dirname(this.installRoot);
    const stagingRoot = `${this.installRoot}.install-${process.pid}-${randomUUID()}`;
    const backupRoot = `${this.installRoot}.backup-${process.pid}-${randomUUID()}`;
    await mkdir(parentDir, { recursive: true });
    await rm(stagingRoot, { recursive: true, force: true });
    let previousMoved = false;
    let installationMoved = false;
    try {
      const manifest = await this.buildInstallation(stagingRoot);
      // uv 在 Unix 安装根目录内创建绝对链接。原子重命名前先转换这些链接，
      // 确保它们仍指向最终目录树内部。
      await rewriteInternalAbsoluteSymlinks(stagingRoot);
      await writeJsonFile(path.join(stagingRoot, MANIFEST_FILE_NAME), manifest);
      if (await pathExists(this.installRoot)) {
        await rename(this.installRoot, backupRoot);
        previousMoved = true;
      }
      await rename(stagingRoot, this.installRoot);
      installationMoved = true;
      if (!await manifestIsUsable(manifest)) {
        throw new Error('工作空间依赖项安装后的健康检查失败。');
      }
      if (previousMoved) await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
    } catch (error) {
      if (installationMoved) {
        await rm(this.installRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      if (previousMoved && await pathExists(backupRoot)) {
        // 如果恢复操作本身失败，则把备份保留在磁盘上；若在 finally 块中删除备份，
        // 会让重装失败进一步变成数据丢失。
        await rename(backupRoot, this.installRoot);
      }
      throw error;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
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

  private async findSystemNode(): Promise<ManagedToolManifest | null> {
    const executable = await findExecutable('node');
    if (!executable || path.resolve(executable) === path.resolve(process.execPath)) return null;
    const result = await runCommand(executable, ['--version']).catch(() => null);
    const version = result ? versionText(result) : '';
    return result?.exitCode === 0 && versionMajor(version) >= MINIMUM_NODE_MAJOR
      ? { path: executable, source: 'system', version }
      : null;
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

async function findExecutable(command: string, pathValue = process.env.PATH): Promise<string | null> {
  if (path.isAbsolute(command)) return await executableExists(command) ? command : null;
  const extensions = process.platform === 'win32'
    ? executableExtensions(command)
    : [''];
  for (const directory of String(pathValue ?? '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, command.endsWith(extension) ? command : `${command}${extension}`);
      if (await executableExists(candidate)) return candidate;
    }
  }
  return null;
}

async function resolveShellToolchain(command: string, pathValue: string): Promise<{
  commands: Record<string, ShellToolchainCommand>;
  readableRoots: string[];
}> {
  const commandNames = new Set<string>([
    ...BASELINE_SHELL_COMMANDS,
    ...shellCommandNames(command),
  ]);
  const commands: Record<string, ShellToolchainCommand> = {};
  const readableRoots: string[] = [];
  for (const commandName of commandNames) {
    const executablePath = await findExecutable(commandName, pathValue);
    if (!executablePath) continue;
    const canonicalPath = await realpath(executablePath).catch(() => path.resolve(executablePath));
    const packageBinTargets = await packageBinWrapperTargets(executablePath);
    const commandTarget = packageBinTargets[0] ?? await platformCommandTarget(commandName, canonicalPath);
    const installationRoot = commandInstallationRoot(commandTarget);
    commands[commandName] = { executablePath, installationRoot };
    readableRoots.push(
      path.dirname(executablePath),
      path.dirname(canonicalPath),
      ...packageBinTargets.flatMap((target) => [path.dirname(target), commandInstallationRoot(target)]),
      path.dirname(commandTarget),
      installationRoot,
    );
  }
  return { commands, readableRoots: uniqueSafeRoots(readableRoots) };
}

async function packageBinWrapperTargets(executablePath: string): Promise<string[]> {
  const binDir = path.dirname(path.resolve(executablePath));
  const nodeModulesRoot = path.dirname(binDir);
  if (path.basename(binDir) !== '.bin' || path.basename(nodeModulesRoot) !== 'node_modules') return [];
  const content = await readFile(executablePath, 'utf8').catch(() => '');
  if (!content || Buffer.byteLength(content) > MAX_PROJECT_HINT_BYTES) return [];

  const targets: string[] = [];
  for (const match of content.matchAll(/\$(?:\{?basedir\}?)[/\\]\.\.[/\\]([^"'\r\n]+)/giu)) {
    const candidate = path.resolve(binDir, '..', match[1].replaceAll('\\', path.sep));
    if (!pathIsInsideRoot(candidate, nodeModulesRoot) || !await pathExists(candidate)) continue;
    targets.push(candidate, await realpath(candidate).catch(() => candidate));
  }
  return [...new Set(targets)];
}

async function commandUsesBundledCorepack(executablePath: string, bundledCorepackRoot: string): Promise<boolean> {
  const targets = await packageBinWrapperTargets(executablePath);
  return targets.some((target) => pathIsInsideRoot(target, bundledCorepackRoot));
}

function shellCommandNames(command: string): string[] {
  const names = new Set<string>();
  const segments = String(command || '').split(/(?:^|[;&|()\n])+/u);
  for (const rawSegment of segments) {
    const words = shellWords(rawSegment);
    let index = 0;
    while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index])) index += 1;
    while (['command', 'env', 'exec', 'nohup', 'sudo', 'time'].includes(words[index] ?? '')) {
      index += 1;
      while (index < words.length && words[index].startsWith('-')) index += 1;
    }
    const candidate = words[index];
    if (candidate && !candidate.startsWith('-')) names.add(path.basename(candidate));
  }
  for (const match of String(command || '').matchAll(/\b(?:command\s+-v|which|type)\s+([A-Za-z0-9_.+-]+)/gu)) {
    names.add(match[1]);
  }
  return [...names];
}

function shellWords(segment: string): string[] {
  return [...String(segment || '').matchAll(/(?:"([^"]*)"|'([^']*)'|([^\s]+))/gu)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? '')
    .filter(Boolean);
}

function commandInstallationRoot(executablePath: string): string {
  const resolved = path.resolve(executablePath);
  const appRoot = runtimeExecutableReadRoot(resolved);
  if (appRoot.endsWith('.app')) return appRoot;
  const normalized = resolved.replace(/\\/gu, '/');
  const commandLineToolsRoot = '/Library/Developer/CommandLineTools';
  if (normalized.startsWith(`${commandLineToolsRoot}/`)) return commandLineToolsRoot;
  const nodeModulesIndex = normalized.indexOf('/lib/node_modules/');
  if (nodeModulesIndex > 0) return path.resolve(normalized.slice(0, nodeModulesIndex));
  const binIndex = normalized.lastIndexOf('/bin/');
  if (binIndex > 0) return path.resolve(normalized.slice(0, binIndex));
  const sbinIndex = normalized.lastIndexOf('/sbin/');
  if (sbinIndex > 0) return path.resolve(normalized.slice(0, sbinIndex));
  return path.dirname(resolved);
}

async function platformCommandTarget(commandName: string, executablePath: string): Promise<string> {
  if (process.platform !== 'darwin' || !executablePath.startsWith('/usr/bin/')) return executablePath;
  const result = await runCommand('/usr/bin/xcrun', ['--find', commandName]).catch(() => null);
  const resolved = result?.exitCode === 0 ? result.stdout.trim().split(/\r?\n/u)[0] : '';
  return resolved && path.isAbsolute(resolved) && await executableExists(resolved)
    ? await realpath(resolved).catch(() => path.resolve(resolved))
    : executablePath;
}

function uniqueSafeRoots(roots: string[]): string[] {
  const result = new Set<string>();
  for (const root of roots) {
    const resolved = path.resolve(String(root || ''));
    if (!root || resolved === path.parse(resolved).root) continue;
    result.add(resolved);
  }
  return [...result];
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
  const executableNames = new Set(process.platform === 'win32'
    ? ['python.exe', 'python3.exe']
    : [`python${MANAGED_PYTHON_VERSION}`, 'python3', 'python']);
  // 优先使用安装目录树内带版本的可执行文件。uv 的便捷链接可能是绝对路径，
  // 通过 realpath 解析还可能在 macOS 上将 /var 改写为 /private/var，
  // 从而跳出词法意义上的暂存根目录。
  const nested = await findFileRecursively(
    pythonInstallDir,
    executableNames,
    4,
  );
  if (nested) return nested;
  for (const fileName of executableNames) {
    const direct = path.join(pythonBinDir, fileName);
    if (await executableExists(direct)) return direct;
  }
  return null;
}

async function rewriteInternalAbsoluteSymlinks(root: string, current = root): Promise<void> {
  // Windows 上的 uv 安装使用可执行启动器，而不是 Unix 符号链接布局。
  // 重新创建 Windows 目录联接可能需要额外权限。
  if (process.platform === 'win32') return;
  const entries = await readdir(current, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await rewriteInternalAbsoluteSymlinks(root, candidate);
      return;
    }
    if (!entry.isSymbolicLink()) return;
    const target = await readlink(candidate);
    if (!path.isAbsolute(target) || !pathIsInsideRoot(target, root)) return;
    const relativeTarget = path.relative(path.dirname(candidate), target) || '.';
    await rm(candidate, { force: true });
    await symlink(relativeTarget, candidate);
  }));
}

function pathIsInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

async function writeNodeScriptShim(
  binDir: string,
  name: string,
  nodePath: string,
  scriptPath: string,
): Promise<void> {
  if (process.platform === 'win32') {
    await writeFile(
      path.join(binDir, `${name}.cmd`),
      `@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${nodePath}" "${scriptPath}" %*\r\n`,
      'utf8',
    );
    return;
  }
  const shimPath = path.join(binDir, name);
  await writeFile(
    shimPath,
    `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(nodePath)} ${shellQuote(scriptPath)} "$@"\n`,
    { encoding: 'utf8', mode: 0o755 },
  );
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

async function writeCorepackShim(
  binDir: string,
  name: 'npm' | 'pnpm' | 'yarn',
  version: string,
  corepackPath: string,
): Promise<void> {
  const spec = `${name}@${version}`;
  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, `${name}.cmd`), `@echo off\r\n"${corepackPath}" "${spec}" %*\r\n`, 'utf8');
    return;
  }
  const shimPath = path.join(binDir, name);
  await writeFile(shimPath, `#!/bin/sh\nexec ${shellQuote(corepackPath)} ${shellQuote(spec)} "$@"\n`, { encoding: 'utf8', mode: 0o755 });
}

async function writeCorepackNpxShim(binDir: string, version: string, corepackPath: string): Promise<void> {
  const spec = `npm@${version}`;
  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, 'npx.cmd'), `@echo off\r\n"${corepackPath}" "${spec}" exec %*\r\n`, 'utf8');
    return;
  }
  const shimPath = path.join(binDir, 'npx');
  await writeFile(
    shimPath,
    `#!/bin/sh\nexec ${shellQuote(corepackPath)} ${shellQuote(spec)} exec "$@"\n`,
    { encoding: 'utf8', mode: 0o755 },
  );
}

function commandShimPath(binDir: string, name: string): string {
  return path.join(binDir, process.platform === 'win32' ? `${name}.cmd` : name);
}

function resolveBundledCorepackEntrypoints(): BundledCorepackEntrypoints | null {
  try {
    const packageRoot = path.dirname(requireFromRuntime.resolve('corepack/package.json'));
    return {
      corepack: path.join(packageRoot, 'dist', 'corepack.js'),
      npm: path.join(packageRoot, 'dist', 'npm.js'),
      npx: path.join(packageRoot, 'dist', 'npx.js'),
      root: packageRoot,
    };
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function executableName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function composePaths(
  preferred: Array<string | null>,
  current: string | undefined,
  fallbacks: Array<string | null>,
): string {
  return [...preferred, ...(current ?? '').split(path.delimiter), ...fallbacks]
    .filter((item, index, all) => Boolean(item) && all.indexOf(item) === index)
    .join(path.delimiter);
}

export function runtimeExecutableReadRoot(executablePath: string, platform = process.platform): string {
  const resolved = path.resolve(executablePath);
  if (platform !== 'darwin') return path.dirname(resolved);
  const parts = resolved.split(path.sep);
  const appIndex = parts.findIndex((part) => part.endsWith('.app'));
  return appIndex >= 0
    ? path.join(path.parse(resolved).root, ...parts.slice(1, appIndex + 1))
    : path.dirname(resolved);
}

async function projectToolchainHints(environment: RuntimeEnvironment): Promise<ProjectToolchainHints> {
  const workspaceRoot = path.resolve(environment.workspaceRoot);
  let current = pathIsInsideRoot(environment.cwd, workspaceRoot)
    ? path.resolve(environment.cwd)
    : workspaceRoot;
  const hints: ProjectToolchainHints = {};
  for (let depth = 0; depth < 32; depth += 1) {
    const manifest = await readSmallJson(path.join(current, 'package.json'));
    if (!hints.packageManager) hints.packageManager = projectPackageManager(manifest?.packageManager);
    if (!hints.nodeVersion) {
      hints.nodeVersion = await readFirstProjectVersion(current, ['.node-version', '.nvmrc'])
        ?? projectEngineVersion(manifest, 'node');
    }
    if (!hints.pythonVersion) hints.pythonVersion = await readFirstProjectVersion(current, ['.python-version']);
    if (current === workspaceRoot || !pathIsInsideRoot(path.dirname(current), workspaceRoot)) break;
    current = path.dirname(current);
  }
  return hints;
}

async function readSmallJson(filePath: string): Promise<Record<string, unknown> | null> {
  const content = await readFile(filePath, 'utf8').catch(() => '');
  if (!content || Buffer.byteLength(content) > MAX_PROJECT_HINT_BYTES) return null;
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function readFirstProjectVersion(directory: string, fileNames: string[]): Promise<string | undefined> {
  for (const fileName of fileNames) {
    const content = await readFile(path.join(directory, fileName), 'utf8').catch(() => '');
    const version = content.trim().split(/\s+/u)[0];
    if (version && Buffer.byteLength(version) <= 128) return version;
  }
  return undefined;
}

function projectPackageManager(value: unknown): ProjectToolchainHints['packageManager'] {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(pnpm|yarn|npm|bun)(?:@([^\s]+))?$/u);
  if (!match) return undefined;
  return {
    name: match[1] as NonNullable<ProjectToolchainHints['packageManager']>['name'],
    ...(match[2] ? { version: match[2] } : {}),
  };
}

function projectEngineVersion(manifest: Record<string, unknown> | null, name: string): string | undefined {
  const engines = manifest?.engines;
  if (!engines || typeof engines !== 'object' || Array.isArray(engines)) return undefined;
  const value = (engines as Record<string, unknown>)[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function preferredToolForVersion(
  host: ManagedToolManifest | null,
  bundled: ManagedToolManifest | null,
  hint: string | undefined,
): ManagedToolManifest | null {
  if (!hint) return host ?? bundled;
  if (host && versionMatchesHint(host.version, hint)) return host;
  if (bundled && versionMatchesHint(bundled.version, hint)) return bundled;
  return host ?? bundled;
}

function versionMatchesHint(actual: string, hint: string): boolean {
  const actualParts = semanticVersionParts(actual);
  const hintedParts = semanticVersionParts(hint);
  if (!actualParts || !hintedParts) return true;
  if (/[<>]=?|\^|~|\*|x/iu.test(hint)) {
    if (/^\s*</u.test(hint)) return actualParts[0] < hintedParts[0];
    return actualParts[0] > hintedParts[0]
      || (actualParts[0] === hintedParts[0] && actualParts[1] >= hintedParts[1]);
  }
  const componentCount = hint.match(/\d+/gu)?.length ?? 0;
  if (actualParts[0] !== hintedParts[0]) return false;
  if (componentCount >= 2 && actualParts[1] !== hintedParts[1]) return false;
  return componentCount < 3 || actualParts[2] === hintedParts[2];
}

function semanticVersionParts(value: string): readonly [number, number, number] | null {
  const match = String(value || '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/u);
  return match
    ? [Number.parseInt(match[1], 10), Number.parseInt(match[2] ?? '0', 10), Number.parseInt(match[3] ?? '0', 10)]
    : null;
}

function versionMajor(value: string): number {
  return semanticVersionParts(value)?.[0] ?? 0;
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
