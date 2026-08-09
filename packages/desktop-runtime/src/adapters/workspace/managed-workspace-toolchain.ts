import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ShellToolchainCommand } from '../../ports/workspace-dependency-manager.js';
import { runManagedWorkspaceCommand as runCommand } from './managed-workspace-command.js';
import { pathExists, type ManagedToolManifest } from './managed-workspace-manifest.js';

export const MANAGED_PYTHON_VERSION = '3.12';
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

export type ProjectToolchainHints = {
  nodeVersion?: string;
  packageManager?: {
    name: 'bun' | 'npm' | 'pnpm' | 'yarn';
    version?: string;
  };
  pythonVersion?: string;
};

export type BundledCorepackEntrypoints = {
  corepack: string;
  npm: string;
  npx: string;
  root: string;
};

// Production is bundled as CJS, so package resolution must start from the actual runtime entry.
const requireFromRuntime = createRequire(
  path.resolve(process.argv[1] ?? path.join(process.cwd(), 'setsuna-runtime.cjs')),
);

export async function findExecutable(command: string, pathValue = process.env.PATH): Promise<string | null> {
  if (path.isAbsolute(command)) return await executableExists(command) ? command : null;
  const extensions = process.platform === 'win32' ? executableExtensions(command) : [''];
  for (const directory of String(pathValue ?? '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, command.endsWith(extension) ? command : `${command}${extension}`);
      if (await executableExists(candidate)) return candidate;
    }
  }
  return null;
}

export async function resolveShellToolchain(command: string, pathValue: string): Promise<{
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

export async function commandUsesBundledCorepack(
  executablePath: string,
  bundledCorepackRoot: string,
): Promise<boolean> {
  const targets = await packageBinWrapperTargets(executablePath);
  return targets.some((target) => pathIsInsideRoot(target, bundledCorepackRoot));
}

export function uniqueSafeRoots(roots: string[]): string[] {
  const result = new Set<string>();
  for (const root of roots) {
    const resolved = path.resolve(String(root || ''));
    if (!root || resolved === path.parse(resolved).root) continue;
    result.add(resolved);
  }
  return [...result];
}

export async function findManagedPython(
  pythonBinDir: string,
  pythonInstallDir: string,
): Promise<string | null> {
  const executableNames = new Set(process.platform === 'win32'
    ? ['python.exe', 'python3.exe']
    : [`python${MANAGED_PYTHON_VERSION}`, 'python3', 'python']);
  // Prefer versioned executables inside the install tree. uv convenience links may be absolute,
  // and realpath can rewrite /var to /private/var on macOS, escaping the lexical staging root.
  const nested = await findFileRecursively(pythonInstallDir, executableNames, 4);
  if (nested) return nested;
  for (const fileName of executableNames) {
    const direct = path.join(pythonBinDir, fileName);
    if (await executableExists(direct)) return direct;
  }
  return null;
}

export async function rewriteInternalAbsoluteSymlinks(root: string, current = root): Promise<void> {
  // uv uses executable launchers rather than this Unix symlink layout on Windows.
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

export async function writeCommandShim(
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

export async function writeNodeScriptShim(
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

export async function writeUvPipShim(binDir: string, name: string, uvPath: string): Promise<void> {
  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, `${name}.cmd`), `@echo off\r\n"${uvPath}" pip %*\r\n`, 'utf8');
    return;
  }
  const shimPath = path.join(binDir, name);
  await writeFile(shimPath, `#!/bin/sh\nexec ${shellQuote(uvPath)} pip "$@"\n`, { encoding: 'utf8', mode: 0o755 });
}

export async function writeCorepackShim(
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

export async function writeCorepackNpxShim(
  binDir: string,
  version: string,
  corepackPath: string,
): Promise<void> {
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

export function commandShimPath(binDir: string, name: string): string {
  return path.join(binDir, process.platform === 'win32' ? `${name}.cmd` : name);
}

export function resolveBundledCorepackEntrypoints(): BundledCorepackEntrypoints | null {
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

export function executableName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

export function composePaths(
  preferred: Array<string | null>,
  current: string | undefined,
  fallbacks: Array<string | null>,
): string {
  return [...preferred, ...(current ?? '').split(path.delimiter), ...fallbacks]
    .filter((item, index, all) => Boolean(item) && all.indexOf(item) === index)
    .join(path.delimiter);
}

export function runtimeExecutableReadRoot(executablePath: string, platform = process.platform): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const resolved = pathApi.resolve(executablePath);
  if (platform !== 'darwin') return pathApi.dirname(resolved);
  const parts = resolved.split(pathApi.sep);
  const appIndex = parts.findIndex((part) => part.endsWith('.app'));
  return appIndex >= 0
    ? pathApi.join(pathApi.parse(resolved).root, ...parts.slice(1, appIndex + 1))
    : pathApi.dirname(resolved);
}

export async function projectToolchainHints(environment: RuntimeEnvironment): Promise<ProjectToolchainHints> {
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

export function preferredToolForVersion(
  host: ManagedToolManifest | null,
  bundled: ManagedToolManifest | null,
  hint: string | undefined,
): ManagedToolManifest | null {
  if (!hint) return host ?? bundled;
  if (host && versionMatchesHint(host.version, hint)) return host;
  if (bundled && versionMatchesHint(bundled.version, hint)) return bundled;
  return host ?? bundled;
}

export function versionMatchesHint(actual: string, hint: string): boolean {
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

export function usesPythonDependencyCommand(command: string): boolean {
  const tool = String.raw`(?:python(?:3(?:\.\d+)*)?(?:\.exe)?|pip3?(?:\.exe)?|uv(?:\.exe)?)`;
  return new RegExp(String.raw`(?:^|[\s;&|()])["']?${tool}["']?(?=$|[\s;&|()])`, 'u').test(command);
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

async function findFileRecursively(
  root: string,
  names: ReadonlySet<string>,
  depth: number,
): Promise<string | null> {
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

function pathIsInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
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

function semanticVersionParts(value: string): readonly [number, number, number] | null {
  const match = String(value || '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/u);
  return match
    ? [Number.parseInt(match[1], 10), Number.parseInt(match[2] ?? '0', 10), Number.parseInt(match[3] ?? '0', 10)]
    : null;
}
