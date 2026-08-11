import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectDir = path.resolve(scriptDir, '../..');
const WINDOWS_TARGET = 'x86_64-pc-windows-msvc';
const BINARY_NAME = 'setsuna-sandbox-win.exe';
const PROTOCOL_VERSION = 1;
const REQUIRED_FILES = [BINARY_NAME, 'LICENSE-APACHE.txt', 'NOTICE.txt'];

export async function prepareWindowsSandbox(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error(`Windows sandbox can only be prepared for win32-x64, received ${platform}-${arch}.`);
  }
  const projectDir = path.resolve(options.projectDir ?? defaultProjectDir);
  const manifestPath = path.join(projectDir, 'native', 'windows-sandbox', 'Cargo.toml');
  const crateRoot = path.dirname(manifestPath);
  const destination = preparedWindowsSandboxDirectory(projectDir);
  const sourceBinary = path.join(crateRoot, 'target', WINDOWS_TARGET, 'release', BINARY_NAME);
  await execFileAsync(options.cargoPath ?? 'cargo', [
    'build',
    '--locked',
    '--release',
    '--manifest-path',
    manifestPath,
    '--target',
    WINDOWS_TARGET,
  ], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 10 * 60_000,
    windowsHide: true,
  }).catch((error) => {
    throw new Error(`Failed to build Windows sandbox sidecar: ${error instanceof Error ? error.message : String(error)}`);
  });

  await mkdir(destination, { recursive: true });
  await Promise.all([
    copyFile(sourceBinary, path.join(destination, BINARY_NAME)),
    copyFile(path.join(crateRoot, 'LICENSE-APACHE'), path.join(destination, 'LICENSE-APACHE.txt')),
    copyFile(path.join(crateRoot, 'NOTICE'), path.join(destination, 'NOTICE.txt')),
  ]);
  const binary = await readFile(path.join(destination, BINARY_NAME));
  const version = cargoPackageVersion(await readFile(manifestPath, 'utf8'));
  await writeFile(path.join(destination, 'metadata.json'), `${JSON.stringify({
    schemaVersion: 1,
    name: 'setsuna-windows-sandbox',
    version,
    protocolVersion: PROTOCOL_VERSION,
    target: WINDOWS_TARGET,
    files: {
      [BINARY_NAME]: sha256(binary),
      'LICENSE-APACHE.txt': sha256(await readFile(path.join(destination, 'LICENSE-APACHE.txt'))),
      'NOTICE.txt': sha256(await readFile(path.join(destination, 'NOTICE.txt'))),
    },
  }, null, 2)}\n`);
  await verifyPreparedWindowsSandbox({ destination, execute: true, version });
  return { binaryPath: path.join(destination, BINARY_NAME), destination, version };
}

export async function verifyPreparedWindowsSandbox(options = {}) {
  const projectDir = path.resolve(options.projectDir ?? defaultProjectDir);
  const destination = path.resolve(options.destination ?? preparedWindowsSandboxDirectory(projectDir));
  const metadata = JSON.parse(await readFile(path.join(destination, 'metadata.json'), 'utf8'));
  if (
    metadata?.schemaVersion !== 1
    || metadata?.name !== 'setsuna-windows-sandbox'
    || metadata?.target !== WINDOWS_TARGET
    || metadata?.protocolVersion !== PROTOCOL_VERSION
  ) {
    throw new Error('Prepared Windows sandbox metadata is invalid.');
  }
  const expectedVersion = options.version ?? metadata.version;
  if (!expectedVersion || metadata.version !== expectedVersion) {
    throw new Error(`Prepared Windows sandbox version mismatch: ${metadata.version ?? 'unknown'}.`);
  }
  if (
    !metadata.files
    || REQUIRED_FILES.some((name) => typeof metadata.files[name] !== 'string')
    || Object.keys(metadata.files).some((name) => !REQUIRED_FILES.includes(name))
  ) {
    throw new Error('Prepared Windows sandbox file manifest is invalid.');
  }
  for (const [name, expectedDigest] of Object.entries(metadata.files)) {
    const actual = await readFile(path.join(destination, name));
    if (sha256(actual) !== expectedDigest) {
      throw new Error(`Prepared Windows sandbox file failed verification: ${name}`);
    }
  }
  const binaryPath = path.join(destination, BINARY_NAME);
  await access(binaryPath);
  if (options.execute !== false) {
    const { stdout } = await execFileAsync(binaryPath, ['version'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    const envelope = JSON.parse(String(stdout).trim().split(/\r?\n/u).at(-1) ?? '{}');
    if (envelope?.ok !== true || envelope?.version !== expectedVersion) {
      throw new Error(`Prepared Windows sandbox reported unexpected version: ${String(stdout).trim()}`);
    }
  }
  return { binaryPath, destination, version: expectedVersion };
}

export function preparedWindowsSandboxDirectory(projectDir = defaultProjectDir) {
  return path.join(path.resolve(projectDir), '.cache', 'windows-sandbox', 'win-x64');
}

function cargoPackageVersion(cargoToml) {
  const packageSection = cargoToml.match(/\[package\]([\s\S]*?)(?:\n\[|$)/u)?.[1] ?? '';
  const version = packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  if (!version) throw new Error('Windows sandbox Cargo.toml has no package version.');
  return version;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cliValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareWindowsSandbox({
    arch: cliValue('--arch'),
    cargoPath: cliValue('--cargo'),
    platform: cliValue('--platform'),
    projectDir: cliValue('--project-dir'),
  });
  console.log(JSON.stringify(result));
}
