import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FileConfigStore } from '../store/file-config-store.js';
import { ManagedWorkspaceDependencyManager } from './managed-workspace-dependency-manager.js';

const execFileAsync = promisify(execFile);

describe('managed workspace dependency manager', () => {
  it.skipIf(process.platform === 'win32')('wraps the app Node runtime and reuses healthy host Python and uv tools', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-dependencies-'));
    const fakeBin = path.join(dataDir, 'fake-bin');
    const previousPath = process.env.PATH;
    await mkdir(fakeBin, { recursive: true });
    await Promise.all([
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
          pythonPackageIndexUrl: 'https://mirror.example/simple',
          workspaceDependenciesEnabled: true,
        },
      });
      const manager = new ManagedWorkspaceDependencyManager(dataDir, configStore);
      const status = await manager.setEnabled({ enabled: true });

      expect(status).toMatchObject({
        enabled: true,
        state: 'ready',
        node: { available: true, source: 'bundled' },
        python: { available: true, source: 'system', version: 'Python 3.12.9' },
        uv: { available: true, source: 'system', version: 'uv 0.11.28' },
      });
      const shell = await manager.prepareShellEnvironment('python --version');
      const dependencyRoot = path.join(dataDir, 'workspace-dependencies');
      const installBin = path.join(dependencyRoot, 'toolchain', 'bin');
      expect(shell).toMatchObject({
        environment: {
          PIP_INDEX_URL: 'https://mirror.example/simple',
          PIP_REQUIRE_VIRTUALENV: '1',
          UV_DEFAULT_INDEX: 'https://mirror.example/simple',
          UV_PYTHON: path.join(fakeBin, 'python3'),
        },
        writableRoots: [path.join(dependencyRoot, 'cache')],
      });
      expect(shell?.environment.PATH.split(path.delimiter).slice(0, 2)).toEqual([
        path.join(dependencyRoot, 'bin'),
        installBin,
      ]);
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

      const shell = await manager.prepareShellEnvironment('git status --short');
      expect(shell?.environment.PATH.split(path.delimiter)[0]).toBe(
        path.join(dataDir, 'workspace-dependencies', 'bin'),
      );
      expect(shell?.environment).not.toHaveProperty('PIP_INDEX_URL');
      expect(shell?.environment).not.toHaveProperty('UV_DEFAULT_INDEX');
      await expect(execFileAsync(path.join(dataDir, 'workspace-dependencies', 'bin', 'node'), ['--version']))
        .resolves.toMatchObject({ stdout: expect.stringMatching(/^v\d+/u) });
      await expect(manager.getStatus()).resolves.toMatchObject({
        enabled: true,
        state: 'not-installed',
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
}
