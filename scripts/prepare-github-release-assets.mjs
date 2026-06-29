import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import packageJson from '../package.json' with { type: 'json' };

const [downloadedArg, uploadArg, logsArg] = process.argv.slice(2);
const downloadedDir = path.resolve(downloadedArg ?? 'release-artifacts/downloaded');
const uploadDir = path.resolve(uploadArg ?? 'release-artifacts/upload');
const logsDir = path.resolve(logsArg ?? 'release-artifacts/logs');

await rm(uploadDir, { recursive: true, force: true });
await rm(logsDir, { recursive: true, force: true });
await mkdir(uploadDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

async function listFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function hasPathSegment(filePath, segment) {
  return path.relative(downloadedDir, filePath).split(path.sep).includes(segment);
}

function inferPlatform(fileName) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.includes('build-logs')) return null;
  if (lowerName.includes('mac-') || lowerName.endsWith('.dmg')) return 'darwin';
  if (lowerName.includes('windows-') || lowerName.endsWith('.exe') || lowerName.endsWith('.msi')) return 'win32';
  if (
    lowerName.includes('ubuntu-') ||
    lowerName.endsWith('.appimage') ||
    lowerName.endsWith('.deb') ||
    lowerName.endsWith('.tar.gz')
  ) {
    return 'linux';
  }

  return null;
}

function inferArch(fileName) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.includes('arm64') || lowerName.includes('aarch64')) return 'arm64';
  if (lowerName.includes('x64') || lowerName.includes('x86_64') || lowerName.includes('amd64')) return 'x64';

  return null;
}

function inferKind(fileName) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.dmg')) return 'dmg';
  if (lowerName.endsWith('.exe')) return 'windows-installer';
  if (lowerName.endsWith('.appimage')) return 'appimage';
  if (lowerName.endsWith('.deb')) return 'deb';
  if (lowerName.endsWith('.tar.gz')) return 'tarball';
  if (lowerName.endsWith('.zip')) return lowerName.includes('build-logs') ? 'build-logs' : 'zip';
  if (lowerName.endsWith('.blockmap')) return 'blockmap';
  if (lowerName.endsWith('.yml') || lowerName.endsWith('.yaml')) return 'updater-metadata';

  return 'artifact';
}

const downloadedFiles = await listFiles(downloadedDir);

for (const filePath of downloadedFiles) {
  const relativePath = path.relative(downloadedDir, filePath);

  if (hasPathSegment(filePath, 'logs')) {
    const logDestination = path.join(logsDir, relativePath);
    await mkdir(path.dirname(logDestination), { recursive: true });
    await copyFile(filePath, logDestination);
    continue;
  }

  const destination = path.join(uploadDir, path.basename(filePath));
  try {
    await access(destination, fsConstants.F_OK);
    throw new Error(`Release asset name collision: ${path.basename(filePath)}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await copyFile(filePath, destination);
}

const logFiles = await listFiles(logsDir);
if (logFiles.length) {
  const logArchivePath = path.join(uploadDir, `build-logs-v${packageJson.version}.zip`);
  const zipResult = spawnSync('zip', ['-qr', logArchivePath, '.'], {
    cwd: logsDir,
    stdio: 'inherit',
  });

  if (zipResult.status !== 0) {
    throw new Error(`Failed to create build log archive at ${logArchivePath}.`);
  }
}

const uploadFiles = (await listFiles(uploadDir))
  .filter((filePath) => !['release-manifest.json', 'SHA256SUMS'].includes(path.basename(filePath)))
  .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));

if (!uploadFiles.length) {
  throw new Error(`No release assets were prepared in ${uploadDir}.`);
}

const assets = [];
for (const filePath of uploadFiles) {
  const fileStat = await stat(filePath);
  const fileName = path.basename(filePath);
  assets.push({
    name: fileName,
    size: fileStat.size,
    sha256: await sha256(filePath),
    platform: inferPlatform(fileName),
    arch: inferArch(fileName),
    kind: inferKind(fileName),
  });
}

const releaseTargets = [
  {
    platform: 'darwin',
    arch: 'arm64',
    label: 'macOS Apple Silicon',
    signing: 'unsigned',
    notarization: 'skipped',
    installMode: 'manual',
  },
  {
    platform: 'darwin',
    arch: 'x64',
    label: 'macOS Intel',
    signing: 'unsigned',
    notarization: 'skipped',
    installMode: 'manual',
  },
  {
    platform: 'win32',
    arch: 'x64',
    label: 'Windows x64',
    signing: 'unsigned',
    notarization: 'not-applicable',
    installMode: 'installer-or-archive',
  },
  {
    platform: 'linux',
    arch: 'x64',
    label: 'Ubuntu x64',
    signing: 'unsigned',
    notarization: 'not-applicable',
    installMode: 'package-or-appimage',
  },
];

const manifest = {
  version: packageJson.version,
  tag: process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? null,
  commit: process.env.GITHUB_SHA ?? 'local',
  builtAt: new Date().toISOString(),
  canonicalSource: 'github-release',
  workflow: {
    repository: process.env.GITHUB_REPOSITORY ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    serverUrl: process.env.GITHUB_SERVER_URL ?? null,
  },
  platforms: releaseTargets.map((target) => ({
    ...target,
    artifacts: assets
      .filter((asset) => asset.platform === target.platform && asset.arch === target.arch)
      .map(({ name, size, sha256, kind }) => ({ name, size, sha256, kind })),
  })),
  supportingAssets: assets
    .filter((asset) => asset.platform === null)
    .map(({ name, size, sha256, kind }) => ({ name, size, sha256, kind })),
  requiredAssets: [
    'macOS Apple Silicon dmg/zip',
    'macOS Intel dmg/zip',
    'Windows x64 installer/archive',
    'Ubuntu x64 package/archive',
    'SHA256SUMS',
    'release-manifest.json',
    `build-logs-v${packageJson.version}.zip`,
  ],
};

await writeFile(path.join(uploadDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const checksumFiles = (await listFiles(uploadDir))
  .filter((filePath) => path.basename(filePath) !== 'SHA256SUMS')
  .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));

const checksumLines = [];
for (const filePath of checksumFiles) {
  checksumLines.push(`${await sha256(filePath)}  ${path.basename(filePath)}`);
}

await writeFile(path.join(uploadDir, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);

console.log(`Prepared ${assets.length} release asset(s) in ${uploadDir}.`);
