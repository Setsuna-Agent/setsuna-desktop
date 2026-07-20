import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { extractArchiveMembers } from './archive.mjs';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectDir = path.resolve(scriptDir, '../..');
const manifestPath = path.join(scriptDir, 'manifest.json');
const DOWNLOAD_TIMEOUT_MS = 60_000;
const ELECTRON_BUILDER_ARCH_NAMES = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal'],
]);
const OUTPUT_FILES = {
  binary: (target) => target.platform === 'win32' ? 'rg.exe' : 'rg',
  licenseMit: () => 'LICENSE-MIT',
  unlicense: () => 'UNLICENSE',
  copying: () => 'COPYING',
};

export async function loadRipgrepManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
  return manifest;
}

export function electronBuilderArchName(arch) {
  const name = ELECTRON_BUILDER_ARCH_NAMES.get(arch);
  if (!name) throw new Error(`Unsupported electron-builder architecture id: ${arch}`);
  return name;
}

export async function prepareRipgrep(options = {}) {
  const manifest = options.manifest ?? await loadRipgrepManifest();
  const target = targetForPlatform(manifest, options.platform ?? process.platform, options.arch ?? process.arch);
  const projectDir = path.resolve(options.projectDir ?? defaultProjectDir);
  const destination = preparedRipgrepDirectory(projectDir, target);
  const archivePath = cachedArchivePath(projectDir, target);
  await mkdir(path.dirname(archivePath), { recursive: true });

  let archive = await readFile(archivePath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (archive && !archiveMatchesTarget(archive, target)) {
    await rm(archivePath, { force: true });
    archive = null;
  }
  if (!archive) {
    archive = await downloadArchive(target, options.fetchImpl ?? globalThis.fetch);
    await writeFileAtomically(archivePath, archive);
  }

  const members = extractArchiveMembers(archive, target.archiveFormat, Object.values(target.members));
  await mkdir(destination, { recursive: true });
  const fileDigests = {};
  for (const [memberKey, memberPath] of Object.entries(target.members)) {
    const outputName = OUTPUT_FILES[memberKey]?.(target);
    if (!outputName) throw new Error(`Unknown ripgrep manifest member: ${memberKey}`);
    const content = members.get(memberPath);
    if (!content) throw new Error(`Ripgrep archive member was not extracted: ${memberPath}`);
    await writeFileAtomically(path.join(destination, outputName), content);
    fileDigests[outputName] = sha256(content);
  }

  const binaryPath = path.join(destination, OUTPUT_FILES.binary(target));
  if (target.platform !== 'win32') await chmod(binaryPath, 0o755);
  const notice = ripgrepNotice(manifest, target);
  await writeFileAtomically(path.join(destination, 'NOTICE.txt'), Buffer.from(notice));
  fileDigests['NOTICE.txt'] = sha256(Buffer.from(notice));
  await writeFileAtomically(path.join(destination, 'metadata.json'), Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    source: target.url,
    archiveSha256: target.archiveSha256,
    files: fileDigests,
  }, null, 2)}\n`));

  await verifyPreparedRipgrep({
    arch: target.arch,
    destination,
    execute: options.verifyExecutable ?? isHostTarget(target),
    manifest,
    platform: target.platform,
    projectDir,
  });
  return { archivePath, binaryPath, destination, target };
}

export async function verifyPreparedRipgrep(options) {
  const manifest = options.manifest ?? await loadRipgrepManifest();
  const target = targetForPlatform(manifest, options.platform, options.arch);
  const projectDir = path.resolve(options.projectDir ?? defaultProjectDir);
  const destination = path.resolve(options.destination ?? preparedRipgrepDirectory(projectDir, target));
  const archive = await readFile(cachedArchivePath(projectDir, target));
  if (!archiveMatchesTarget(archive, target)) {
    throw new Error(`Cached ripgrep archive failed size or SHA-256 verification for ${target.builderOs}-${target.arch}.`);
  }
  const members = extractArchiveMembers(archive, target.archiveFormat, Object.values(target.members));

  for (const [memberKey, memberPath] of Object.entries(target.members)) {
    const outputName = OUTPUT_FILES[memberKey]?.(target);
    if (!outputName) throw new Error(`Unknown ripgrep manifest member: ${memberKey}`);
    const actual = await readFile(path.join(destination, outputName));
    const expected = members.get(memberPath);
    if (!expected || sha256(actual) !== sha256(expected)) {
      throw new Error(`Prepared ripgrep file failed verification: ${outputName}`);
    }
  }
  await Promise.all(['NOTICE.txt', 'metadata.json'].map((name) => access(path.join(destination, name))));

  const binaryPath = path.join(destination, OUTPUT_FILES.binary(target));
  if (options.execute ?? isHostTarget(target)) await verifyRipgrepVersion(binaryPath, manifest.version);
  return { binaryPath, destination, target };
}

export function targetForPlatform(manifest, platform, arch) {
  const target = Object.values(manifest.packages).find((candidate) => (
    candidate.platform === platform && candidate.arch === arch
  ));
  if (!target) throw new Error(`No pinned ripgrep package for ${platform}-${arch}.`);
  return target;
}

export function preparedRipgrepDirectory(projectDir, target) {
  return path.join(projectDir, '.cache', 'ripgrep', `${target.builderOs}-${target.arch}`);
}

export async function verifyRipgrepVersion(binaryPath, expectedVersion) {
  const { stdout } = await execFileAsync(binaryPath, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  const firstLine = String(stdout).split(/\r?\n/u, 1)[0]?.trim();
  if (firstLine !== `ripgrep ${expectedVersion}` && !firstLine?.startsWith(`ripgrep ${expectedVersion} (`)) {
    throw new Error(`Unexpected bundled ripgrep version: ${firstLine || '(no output)'}`);
  }
}

function cachedArchivePath(projectDir, target) {
  const extension = target.archiveFormat === 'zip' ? 'zip' : 'tar.gz';
  return path.join(projectDir, '.cache', 'ripgrep', 'downloads', `${target.archiveSha256}.${extension}`);
}

async function downloadArchive(target, fetchImpl) {
  const abort = new globalThis.AbortController();
  const timer = setTimeout(() => abort.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(target.url, { signal: abort.signal });
    if (!response.ok) throw new Error(`Failed to download ripgrep: HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (!archiveMatchesTarget(archive, target)) {
      throw new Error(`Downloaded ripgrep archive failed size or SHA-256 verification for ${target.builderOs}-${target.arch}.`);
    }
    return archive;
  } finally {
    clearTimeout(timer);
  }
}

function archiveMatchesTarget(archive, target) {
  return archive.length === target.archiveSize && sha256(archive) === target.archiveSha256;
}

async function writeFileAtomically(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, content);
    await rm(filePath, { force: true });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isHostTarget(target) {
  return target.platform === process.platform && target.arch === process.arch;
}

function ripgrepNotice(manifest, target) {
  return [
    `${manifest.name} ${manifest.version}`,
    `Source: ${target.url}`,
    `License: ${manifest.license}`,
    '',
    'The complete upstream LICENSE-MIT, UNLICENSE, and COPYING files are included in this directory.',
    '',
  ].join('\n');
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !manifest.name || !manifest.version || !manifest.license) {
    throw new Error('Ripgrep manifest header is invalid.');
  }
  const targets = Object.values(manifest.packages ?? {});
  if (!targets.length) throw new Error('Ripgrep manifest has no packages.');
  for (const target of targets) {
    if (!target.platform || !target.arch || !target.builderOs || !target.url) {
      throw new Error('Ripgrep manifest target identity is invalid.');
    }
    if (!Number.isSafeInteger(target.archiveSize) || target.archiveSize <= 0) {
      throw new Error(`Ripgrep manifest archive size is invalid for ${target.platform}-${target.arch}.`);
    }
    if (!/^[a-f0-9]{64}$/u.test(target.archiveSha256)) {
      throw new Error(`Ripgrep manifest SHA-256 is invalid for ${target.platform}-${target.arch}.`);
    }
    for (const key of Object.keys(OUTPUT_FILES)) {
      if (!target.members?.[key]) throw new Error(`Ripgrep manifest is missing ${key} for ${target.platform}-${target.arch}.`);
    }
  }
}

function cliValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareRipgrep({
    arch: cliValue('--arch'),
    platform: cliValue('--platform'),
    projectDir: cliValue('--project-dir'),
    verifyExecutable: process.argv.includes('--skip-execute') ? false : undefined,
  });
  console.log(JSON.stringify({ binaryPath: result.binaryPath, target: `${result.target.builderOs}-${result.target.arch}` }));
}
