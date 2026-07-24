import { DEFAULT_NPM_REGISTRY_URL, DEFAULT_PYTHON_PACKAGE_INDEX_URL } from '@setsuna-desktop/contracts';
import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FileConfigStore } from '../../../src/adapters/store/file-config-store.js';
import {
  ManagedWorkspaceDependencyManager,
  runtimeExecutableReadRoot,
} from '../../../src/adapters/workspace/managed-workspace-dependency-manager.js';

const execFileAsync = promisify(execFile);

describe('managed workspace dependency manager', () => {
  it('keeps healthy host tools ready across ordinary status reads before lazy installation', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-dependencies-diagnose-'));
    const fakeBin = path.join(dataDir, 'fake-bin');
    const previousPath = process.env.PATH;
    await mkdir(fakeBin, { recursive: true });
    await writeFakeHostTools(fakeBin);
    process.env.PATH = fakeBin;

    try {
      const configStore = new FileConfigStore(dataDir);
      const manager = new ManagedWorkspaceDependencyManager(dataDir, configStore);

      await expect(manager.getStatus()).resolves.toMatchObject({
        enabled: true,
        state: 'ready',
        node: { available: true, source: 'bundled' },
        python: { available: true, source: 'system' },
        uv: { available: true, source: 'system' },
      });
      await expect(manager.diagnose()).resolves.toMatchObject({
        enabled: true,
        state: 'ready',
        node: { available: true, source: 'bundled' },
        python: { available: true, source: 'system' },
        uv: { available: true, source: 'system' },
      });
      await expect(manager.getStatus()).resolves.toMatchObject({ state: 'ready' });
    } finally {
      process.env.PATH = previousPath;
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('prefers healthy host tools before managed fallbacks', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-dependencies-'));
    const fakeBin = path.join(dataDir, 'fake-bin');
    const previousPath = process.env.PATH;
    await mkdir(fakeBin, { recursive: true });
    await Promise.all([
      writeExecutable(path.join(fakeBin, 'node'), '#!/bin/sh\necho "v22.23.1"\n'),
      writeExecutable(path.join(fakeBin, 'python3'), '#!/bin/sh\necho "Python 3.12.9"\n'),
      writeExecutable(path.join(fakeBin, 'uv'), [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo "uv 0.11.28"; else echo "fake uv $* index=$UV_DEFAULT_INDEX"; fi',
        '',
      ].join('\n')),
    ]);
    process.env.PATH = [fakeBin, previousPath ?? ''].filter(Boolean).join(path.delimiter);

    try {
      const configStore = new FileConfigStore(dataDir);
      await configStore.saveConfig({
        desktopSettings: {
          npmRegistryUrl: 'https://registry.example/npm/',
          pythonPackageIndexUrl: 'https://mirror.example/simple',
          workspaceDependenciesEnabled: true,
        },
      });
      const manager = new ManagedWorkspaceDependencyManager(dataDir, configStore);
      await expect(manager.getPromptContext()).resolves.toEqual({ enabled: true });
      const status = await manager.setEnabled({ enabled: true });

      expect(status).toMatchObject({
        enabled: true,
        state: 'ready',
        node: { available: true, source: 'system' },
        python: { available: true, source: 'system', version: 'Python 3.12.9' },
        uv: { available: true, source: 'system', version: 'uv 0.11.28' },
      });
      const shell = await manager.prepareShellToolchain({
        command: 'python --version',
        environment: testEnvironment(dataDir),
      });
      const dependencyRoot = path.join(dataDir, 'workspace-dependencies');
      const installBin = path.join(dependencyRoot, 'toolchain', 'bin');
      expect(shell).toMatchObject({
        environment: {
          COREPACK_NPM_REGISTRY: 'https://registry.example/npm/',
          PIP_INDEX_URL: 'https://mirror.example/simple',
          PIP_REQUIRE_VIRTUALENV: '1',
          UV_DEFAULT_INDEX: 'https://mirror.example/simple',
          UV_PYTHON: path.join(fakeBin, 'python3'),
          npm_config_registry: 'https://registry.example/npm/',
        },
        readableRoots: expect.arrayContaining([dependencyRoot]),
        writableCacheRoots: [path.join(dependencyRoot, 'cache')],
      });
      expect(shell?.readableRoots.some((root) => pathIsInside(process.execPath, root))).toBe(true);
      expect(shell.environment.PATH.split(path.delimiter)).toContain(installBin);
      expect(shell.environment.PATH.split(path.delimiter).indexOf(fakeBin)).toBeLessThan(
        shell.environment.PATH.split(path.delimiter).indexOf(installBin),
      );
      await expect(execFileAsync(path.join(installBin, 'python'), ['--version'])).resolves.toMatchObject({
        stdout: expect.stringContaining('Python 3.12.9'),
      });
      await expect(execFileAsync('/bin/sh', ['-c', 'pip install demo'], {
        env: { ...process.env, ...shell?.environment },
      })).resolves.toMatchObject({
        stdout: expect.stringContaining('fake uv pip install demo index=https://mirror.example/simple'),
      });
    } finally {
      process.env.PATH = previousPath;
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('keeps uv-managed Python executable after the staging directory is renamed', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-dependencies-managed-python-'));
    const fakeBin = path.join(dataDir, 'fake-bin');
    const previousPath = process.env.PATH;
    await mkdir(fakeBin, { recursive: true });
    await writeExecutable(path.join(fakeBin, 'uv'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "uv 0.11.28"',
      '  exit 0',
      'fi',
      'if [ "$1" = "python" ] && [ "$2" = "install" ]; then',
      '  shift 2',
      '  install_dir=""',
      '  while [ "$#" -gt 0 ]; do',
      '    case "$1" in',
      '      --install-dir) install_dir="$2"; shift 2 ;;',
      '      *) shift ;;',
      '    esac',
      '  done',
      '  version_dir="$install_dir/cpython-3.12.13-test"',
      '  /bin/mkdir -p "$version_dir/bin" "$UV_PYTHON_BIN_DIR"',
      '  printf "%s\\n" "#!/bin/sh" "echo Python 3.12.13" > "$version_dir/bin/python3"',
      '  /bin/chmod +x "$version_dir/bin/python3"',
      '  /bin/ln -s "$version_dir/bin/python3" "$UV_PYTHON_BIN_DIR/python3"',
      '  /bin/ln -s "$version_dir" "$install_dir/cpython-3.12-test"',
      '  exit 0',
      'fi',
      'echo "unexpected fake uv invocation: $*" >&2',
      'exit 2',
      '',
    ].join('\n'));
    process.env.PATH = fakeBin;

    try {
      const configStore = new FileConfigStore(dataDir);
      const manager = new ManagedWorkspaceDependencyManager(dataDir, configStore);
      const status = await manager.reinstall();
      const dependencyRoot = path.join(dataDir, 'workspace-dependencies');
      const installBin = path.join(dependencyRoot, 'toolchain', 'bin');
      const pythonBinLink = path.join(dependencyRoot, 'toolchain', 'python-bin', 'python3');

      expect(status).toMatchObject({
        state: 'ready',
        python: { available: true, source: 'managed', version: 'Python 3.12.13' },
      });
      expect(status.python.path).not.toContain('.install-');
      expect(path.isAbsolute(await readlink(pythonBinLink))).toBe(false);
      await expect(execFileAsync(path.join(installBin, 'python3'), ['--version'])).resolves.toMatchObject({
        stdout: expect.stringContaining('Python 3.12.13'),
      });
      await expect(manager.getStatus()).resolves.toMatchObject({ state: 'ready' });
    } finally {
      process.env.PATH = previousPath;
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('does not provision Python for an unrelated first shell command', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-dependencies-lazy-'));
    try {
      const configStore = new FileConfigStore(dataDir);
      const manager = new ManagedWorkspaceDependencyManager(dataDir, configStore);

      const shell = await manager.prepareShellToolchain({
        command: 'git status --short',
        environment: testEnvironment(dataDir),
      });
      expect(shell.environment.PATH.split(path.delimiter)).toEqual(
        expect.arrayContaining([...new Set(String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean))]),
      );
      expect(shell.environment).toMatchObject({
        COREPACK_NPM_REGISTRY: DEFAULT_NPM_REGISTRY_URL,
        PIP_INDEX_URL: DEFAULT_PYTHON_PACKAGE_INDEX_URL,
        UV_DEFAULT_INDEX: DEFAULT_PYTHON_PACKAGE_INDEX_URL,
        npm_config_registry: DEFAULT_NPM_REGISTRY_URL,
      });
      expect(shell.environment.UV_PYTHON).toBeUndefined();
      expect(shell.environment.UV_PYTHON_BIN_DIR).toBeUndefined();
      expect(shell.environment.UV_PYTHON_INSTALL_DIR).toBeUndefined();
      await expect(manager.getStatus()).resolves.toMatchObject({ enabled: true });
      await expect(access(path.join(dataDir, 'workspace-dependencies', 'toolchain', 'manifest.json')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('uses the project packageManager version through an isolated Corepack shim', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-project-package-manager-'));
    const fakeBin = path.join(dataDir, 'fake-bin');
    const previousPath = process.env.PATH;
    await mkdir(fakeBin, { recursive: true });
    await Promise.all([
      writeExecutable(path.join(fakeBin, 'node'), '#!/bin/sh\necho v22.23.1\n'),
      writeExecutable(path.join(fakeBin, 'corepack'), '#!/bin/sh\necho "corepack $*"\n'),
      writeExecutable(path.join(fakeBin, 'pnpm'), '#!/bin/sh\necho 9.15.0\n'),
      writeFile(path.join(dataDir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@7.33.7' }), 'utf8'),
    ]);
    process.env.PATH = fakeBin;

    try {
      const manager = new ManagedWorkspaceDependencyManager(dataDir, new FileConfigStore(dataDir));
      const shell = await manager.prepareShellToolchain({
        command: 'pnpm --version',
        environment: testEnvironment(dataDir),
      });
      const projectBin = path.join(dataDir, 'workspace-dependencies', 'project-bin');

      expect(shell.environment.PATH.split(path.delimiter)[0]).toBe(projectBin);
      expect(shell.commands.pnpm).toMatchObject({
        executablePath: path.join(projectBin, 'pnpm'),
        installationRoot: await realpath(projectBin),
      });
      expect(shell.readableRoots).toEqual(expect.arrayContaining([projectBin, fakeBin]));
      await expect(execFileAsync(path.join(projectBin, 'pnpm'), ['--version'], {
        env: { ...process.env, ...shell.environment },
      })).resolves.toMatchObject({ stdout: expect.stringContaining('corepack pnpm@7.33.7 --version') });
    } finally {
      process.env.PATH = previousPath;
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('provides app-owned package manager shims when the host only has Node.js', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-bundled-corepack-'));
    const fakeBin = path.join(dataDir, 'fake-bin');
    const previousPath = process.env.PATH;
    await mkdir(fakeBin, { recursive: true });
    await writeExecutable(path.join(fakeBin, 'node'), '#!/bin/sh\necho v22.23.1\n');
    process.env.PATH = fakeBin;

    try {
      const manager = new ManagedWorkspaceDependencyManager(dataDir, new FileConfigStore(dataDir));
      const shell = await manager.prepareShellToolchain({
        command: 'corepack --version',
        environment: testEnvironment(dataDir),
      });
      const projectBin = path.join(dataDir, 'workspace-dependencies', 'project-bin');

      expect(shell.environment.PATH.split(path.delimiter)[0]).toBe(projectBin);
      expect(shell.commands).toMatchObject({
        corepack: { executablePath: path.join(projectBin, 'corepack') },
        npm: { executablePath: path.join(projectBin, 'npm') },
        npx: { executablePath: path.join(projectBin, 'npx') },
        pnpm: { executablePath: path.join(projectBin, 'pnpm') },
      });
      expect(shell.readableRoots.some((root) => path.basename(root) === 'corepack')).toBe(true);
      await expect(execFileAsync(path.join(projectBin, 'corepack'), ['--version'], {
        env: { ...process.env, ...shell.environment },
      })).resolves.toMatchObject({ stdout: expect.stringContaining('0.34.7') });
    } finally {
      process.env.PATH = previousPath;
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('resolves explicit command and installation roots even when managed downloads are disabled', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-explicit-toolchain-'));
    const fakeBin = path.join(dataDir, 'session-bin');
    const installationRoot = path.join(dataDir, 'installation');
    const target = path.join(installationRoot, 'bin', 'setsuna-explicit-tool');
    const previousPath = process.env.PATH;
    await mkdir(fakeBin, { recursive: true });
    await mkdir(path.dirname(target), { recursive: true });
    await writeExecutable(target, '#!/bin/sh\necho explicit\n');
    await symlink(target, path.join(fakeBin, 'setsuna-explicit-tool'));
    process.env.PATH = fakeBin;

    try {
      const configStore = new FileConfigStore(dataDir);
      await configStore.saveConfig({ desktopSettings: { workspaceDependenciesEnabled: false } });
      const manager = new ManagedWorkspaceDependencyManager(dataDir, configStore);
      const shell = await manager.prepareShellToolchain({
        command: 'setsuna-explicit-tool --version',
        environment: testEnvironment(dataDir),
      });

      expect(shell.commands['setsuna-explicit-tool']).toEqual({
        executablePath: path.join(fakeBin, 'setsuna-explicit-tool'),
        installationRoot: await realpath(installationRoot),
      });
      expect(shell.readableRoots).toEqual(expect.arrayContaining([fakeBin, await realpath(installationRoot)]));
      expect(shell.writableCacheRoots).toEqual([]);
    } finally {
      process.env.PATH = previousPath;
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('opens the containing app bundle instead of only the Electron helper directory', () => {
    expect(runtimeExecutableReadRoot(
      '/Applications/Setsuna Desktop.app/Contents/Frameworks/Setsuna Desktop Helper.app/Contents/MacOS/Setsuna Desktop Helper',
      'darwin',
    )).toBe('/Applications/Setsuna Desktop.app');
  });
});

function testEnvironment(root: string) {
  return {
    id: 'test-environment',
    cwd: root,
    workspaceRoot: root,
    workspaceRoots: [root],
    shell: process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh',
  };
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
}

function pathIsInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function writeFakeHostTools(fakeBin: string): Promise<void> {
  if (process.platform === 'win32') {
    await Promise.all([
      linkOrCopyExecutable(process.execPath, path.join(fakeBin, 'python.exe')),
      linkOrCopyExecutable(process.execPath, path.join(fakeBin, 'uv.exe')),
    ]);
    return;
  }
  await Promise.all([
    writeExecutable(path.join(fakeBin, 'python3'), '#!/bin/sh\necho "Python 3.12.9"\n'),
    writeExecutable(path.join(fakeBin, 'uv'), '#!/bin/sh\necho "uv 0.11.28"\n'),
  ]);
}

async function linkOrCopyExecutable(source: string, destination: string): Promise<void> {
  await link(source, destination).catch(() => copyFile(source, destination));
}
