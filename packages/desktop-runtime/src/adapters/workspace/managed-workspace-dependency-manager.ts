import type {
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependencyToolStatus,
} from '@setsuna-desktop/contracts';
import {
  DEFAULT_NPM_REGISTRY_URL,
  DEFAULT_PYTHON_PACKAGE_INDEX_URL,
} from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { ConfigStore } from '../../ports/config-store.js';
import type {
  PrepareShellToolchainInput,
  ShellToolchain,
  WorkspaceDependencyManager,
  WorkspaceDependencyPromptContext,
} from '../../ports/workspace-dependency-manager.js';
import { errorMessage } from '../../shared/node-errors.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';
import {
  runManagedWorkspaceCommand as runCommand,
} from './managed-workspace-command.js';
import {
  checkedToolStatus,
  commandFailure,
  manifestIsUsable,
  manifestToolStatus,
  pathExists,
  relocateManagedTool,
  toolCheck,
  unavailableTool,
  versionAtLeast,
  versionMajor,
  versionText,
  type ManagedToolManifest,
  type WorkspaceDependencyManifest,
  type WorkspaceDependencyVersionRequirements,
} from './managed-workspace-manifest.js';
import {
  ManagedWorkspaceDependencyNetwork,
  type ManagedWorkspaceDependencyNetworkOptions,
} from './managed-workspace-dependency-network.js';
import {
  MANAGED_PYTHON_VERSION,
  commandShimPath,
  commandUsesBundledCorepack,
  composePaths,
  executableName,
  findExecutable,
  findManagedPython,
  preferredToolForVersion,
  projectToolchainHints,
  resolveBundledCorepackEntrypoints,
  resolveShellToolchain,
  rewriteInternalAbsoluteSymlinks,
  runtimeExecutableReadRoot,
  uniqueSafeRoots,
  usesPythonDependencyCommand,
  versionMatchesHint,
  writeCommandShim,
  writeCorepackNpxShim,
  writeCorepackShim,
  writeNodeScriptShim,
  writeUvPipShim,
  type ProjectToolchainHints,
} from './managed-workspace-toolchain.js';

export { runtimeExecutableReadRoot } from './managed-workspace-toolchain.js';

const BUNDLE_VERSION = '2026.07.3';
const MANIFEST_FILE_NAME = 'manifest.json';
const MINIMUM_PYTHON_VERSION = [3, 10] as const;
const MINIMUM_NODE_MAJOR = 18;
const UV_VERSION = '0.11.28';
const FALLBACK_PNPM_VERSION = '7.33.7';
const TOOL_VERSION_REQUIREMENTS: WorkspaceDependencyVersionRequirements = {
  node: (version) => versionMajor(version) >= MINIMUM_NODE_MAJOR,
  python: (version) => versionAtLeast(version, MINIMUM_PYTHON_VERSION),
};
type PackageManagerShims = {
  binDir: string | null;
  readableRoots: string[];
};

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
  private readonly network: ManagedWorkspaceDependencyNetwork;
  private installPromise: Promise<void> | null = null;
  private nodeShimTarget = '';
  private nodeShimPromise: Promise<void> | null = null;
  private lastError: string | undefined;

  constructor(
    runtimeDataDir: string,
    private readonly configStore: ConfigStore,
    networkOptions: ManagedWorkspaceDependencyNetworkOptions = {},
  ) {
    this.workspaceDependencyRoot = path.join(runtimeDataDir, 'workspace-dependencies');
    this.cacheRoot = path.join(this.workspaceDependencyRoot, 'cache');
    this.installRoot = path.join(this.workspaceDependencyRoot, 'toolchain');
    this.nodeBinDir = path.join(this.workspaceDependencyRoot, 'bin');
    this.projectBinDir = path.join(this.workspaceDependencyRoot, 'project-bin');
    this.network = new ManagedWorkspaceDependencyNetwork(networkOptions);
  }

  async getStatus(): Promise<RuntimeWorkspaceDependenciesStatus> {
    // 设置页每次进入都应反映真实可用性；这里只执行本机版本检查，
    // 不会触发下载或创建托管 Python 工具链。
    return this.status(true);
  }

  async getPromptContext(): Promise<WorkspaceDependencyPromptContext> {
    return { enabled: true };
  }

  async diagnose(): Promise<RuntimeWorkspaceDependenciesStatus> {
    return this.status(true);
  }

  async repair(): Promise<RuntimeWorkspaceDependenciesStatus> {
    // 健康的现有清单会直接复用；只有缺失、损坏或版本过期时才重建私有工具链。
    await this.ensureInstalled(false);
    return this.status(true);
  }

  async prepareShellToolchain({ command, environment }: PrepareShellToolchainInput): Promise<ShellToolchain> {
    const config = await this.configStore.getConfig();
    const packageIndexUrl = config.desktopSettings?.pythonPackageIndexUrl?.trim()
      || DEFAULT_PYTHON_PACKAGE_INDEX_URL;
    const npmRegistryUrl = config.desktopSettings?.npmRegistryUrl?.trim()
      || DEFAULT_NPM_REGISTRY_URL;
    const hints = await projectToolchainHints(environment);
    const hostNode = await this.findSystemNode();
    const bundledNode = await this.resolveNode();
    const selectedNode = preferredToolForVersion(hostNode, bundledNode, hints.nodeVersion);
    const useBundledNodeFallback = selectedNode?.source === 'bundled';
    if (useBundledNodeFallback && selectedNode) await this.ensureNodeShim(selectedNode);

    await Promise.all([
      mkdir(path.join(this.cacheRoot, 'uv'), { recursive: true }),
      mkdir(path.join(this.cacheRoot, 'pip'), { recursive: true }),
      mkdir(path.join(this.cacheRoot, 'npm'), { recursive: true }),
      mkdir(path.join(this.cacheRoot, 'corepack'), { recursive: true }),
    ]);

    const existingManifest = await this.readManifest();
    // 无关的首条 Shell 命令不应触发 Python 下载；只有请求 Python 依赖命令时才延迟配置。
    const needsPython = usesPythonDependencyCommand(command);
    if (needsPython) await this.ensureInstalled(false);
    const manifest = needsPython ? await this.readManifest() : existingManifest;
    if (needsPython && !manifest) throw new Error('工作空间依赖项安装结果缺少清单。');
    const toolchainBinDir = manifest ? path.join(this.installRoot, 'bin') : null;
    const packageManagerShims = await this.ensureProjectPackageManagerShims(hints.packageManager, process.env.PATH);
    const environmentOverrides = {
      PATH: composePaths([
        packageManagerShims.binDir,
        useBundledNodeFallback ? this.nodeBinDir : null,
      ], process.env.PATH, [toolchainBinDir]),
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
      ...(packageIndexUrl ? {
        PIP_INDEX_URL: packageIndexUrl,
        UV_DEFAULT_INDEX: packageIndexUrl,
      } : {}),
      ...(npmRegistryUrl ? {
        COREPACK_NPM_REGISTRY: npmRegistryUrl,
        npm_config_registry: npmRegistryUrl,
      } : {}),
      ...(manifest ? {
        UV_PYTHON: manifest.python.path,
        UV_PYTHON_BIN_DIR: path.join(this.installRoot, 'python-bin'),
        UV_PYTHON_INSTALL_DIR: path.join(this.installRoot, 'python'),
      } : {}),
    };
    const resolvedToolchain = await resolveShellToolchain(command, environmentOverrides.PATH);
    const cachedPnpmFiles = usesPnpmCommand(command)
      ? await existingCorepackPnpmFiles(
        path.join(this.cacheRoot, 'corepack'),
        hints.packageManager?.name === 'pnpm' && hints.packageManager.version
          ? hints.packageManager.version
          : FALLBACK_PNPM_VERSION,
      )
      : [];
    const managedRoots = [
      ...(manifest && needsPython ? [this.installRoot] : []),
      ...(useBundledNodeFallback ? [this.nodeBinDir] : []),
      ...(useBundledNodeFallback ? [runtimeExecutableReadRoot(process.execPath)] : []),
      ...packageManagerShims.readableRoots,
      ...cachedPnpmFiles,
    ];
    return {
      commands: resolvedToolchain.commands,
      environment: environmentOverrides,
      readableRoots: uniqueSafeRoots([...resolvedToolchain.readableRoots, ...managedRoots]),
      writableCacheRoots: [this.cacheRoot],
    };
  }

  private async status(
    verifyManifest: boolean,
    inspectHostWhenMissing = verifyManifest,
  ): Promise<RuntimeWorkspaceDependenciesStatus> {
    const config = await this.configStore.getConfig();
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
    const state: RuntimeWorkspaceDependenciesStatus['state'] = installing
      ? 'installing'
      : this.lastError
        ? 'error'
        : ready
          ? 'ready'
          : 'not-installed';
    return {
      bundleVersion: BUNDLE_VERSION,
      checks,
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
      checkedToolStatus(nodeTool, ['--version'], TOOL_VERSION_REQUIREMENTS.node),
      checkedToolStatus(manifest.python, ['--version'], TOOL_VERSION_REQUIREMENTS.python),
      checkedToolStatus(manifest.uv, ['--version'], TOOL_VERSION_REQUIREMENTS.uv),
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
      if (
        manifest?.bundleVersion === BUNDLE_VERSION
        && await manifestIsUsable(manifest, TOOL_VERSION_REQUIREMENTS)
      ) {
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
    if (wroteShim && corepack) {
      const corepackToolchain = await resolveShellToolchain(`"${corepack}" --version`, currentPath ?? '');
      bundledReadRoots.push(...corepackToolchain.readableRoots);
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
      if (!await manifestIsUsable(manifest, TOOL_VERSION_REQUIREMENTS)) {
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

    const downloadEnvironment = () => this.network.processEnvironment();
    const node = await this.resolveNode();
    const uv = await this.resolveUv(stagingRoot, uvInstallDir, downloadEnvironment);
    const python = await this.resolvePython(
      uv,
      pythonBinDir,
      pythonInstallDir,
      path.join(this.cacheRoot, 'uv'),
      downloadEnvironment,
    );
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

  private async resolveUv(
    stagingRoot: string,
    uvInstallDir: string,
    downloadEnvironment: () => Promise<NodeJS.ProcessEnv>,
  ): Promise<ManagedToolManifest> {
    const systemUv = await this.findSystemUv();
    if (systemUv) return systemUv;

    const installerExtension = process.platform === 'win32' ? 'ps1' : 'sh';
    const installerUrl = `https://astral.sh/uv/${UV_VERSION}/install.${installerExtension}`;
    const installerPath = path.join(stagingRoot, `install-uv.${installerExtension}`);
    const response = await this.network.fetch(installerUrl);
    if (!response.ok) throw new Error(`下载 uv 安装器失败：HTTP ${response.status}`);
    await writeFile(installerPath, new Uint8Array(await response.arrayBuffer()));
    const installerEnv = {
      ...await downloadEnvironment(),
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
    downloadEnvironment: () => Promise<NodeJS.ProcessEnv>,
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
      ...await downloadEnvironment(),
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

function usesPnpmCommand(command: string): boolean {
  return /(?:^|[\s;&|()])["']?pnpm(?:\.cmd)?["']?(?=$|[\s;&|()])/iu.test(command);
}

async function existingCorepackPnpmFiles(corepackHome: string, version: string): Promise<string[]> {
  const packageRoot = path.join(corepackHome, 'v1', 'pnpm', version);
  const candidates = [
    path.dirname(packageRoot),
    packageRoot,
    path.join(packageRoot, 'bin'),
    path.join(packageRoot, 'dist'),
    path.join(packageRoot, '.corepack'),
    path.join(packageRoot, 'package.json'),
    path.join(packageRoot, 'bin', 'pnpm.cjs'),
    path.join(packageRoot, 'dist', 'pnpm.cjs'),
    path.join(packageRoot, 'dist', 'pnpmrc'),
  ];
  const existing = await Promise.all(candidates.map(async (candidate) => (
    await pathExists(candidate) ? candidate : null
  )));
  return existing.filter((candidate): candidate is string => Boolean(candidate));
}
