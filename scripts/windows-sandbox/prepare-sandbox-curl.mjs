import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { extractArchiveMembers } from '../ripgrep/archive.mjs';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectDir = path.resolve(scriptDir, '../..');
const manifestPath = path.join(scriptDir, 'curl-manifest.json');
const DOWNLOAD_TIMEOUT_MS = 60_000;
// Dev startup owns this preparation, so brief proxy or network interruptions
// should recover here instead of requiring a separate manual command.
const DOWNLOAD_RETRY_DELAYS_MS = [1_000, 3_000];
const TARGET_KEY = 'win-x64';
const REQUIRED_FILES = [
  'curl.exe',
  'curl-ca-bundle.crt',
  '_curlrc',
  'LICENSE-CURL.txt',
  'THIRD-PARTY-LICENSES-CURL.txt',
  'NOTICE-CURL.txt',
];
const DEFAULT_CONFIG = Buffer.from([
  '# Use Windows trust anchors in addition to the bundled Mozilla CA file.',
  'ca-native',
  '',
].join('\n'));
const DIRECT_OUTPUTS = {
  binary: 'curl.exe',
  caBundle: 'curl-ca-bundle.crt',
  curlLicense: 'LICENSE-CURL.txt',
};

export async function loadSandboxCurlManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
  return manifest;
}

export async function prepareSandboxCurl(options = {}) {
  const manifest = options.manifest ?? await loadSandboxCurlManifest();
  const target = targetForPlatform(manifest, options.platform ?? process.platform, options.arch ?? process.arch);
  const projectDir = path.resolve(options.projectDir ?? defaultProjectDir);
  const destination = preparedSandboxCurlDirectory(projectDir);
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
    archive = await downloadSandboxCurlArchive(target, { fetchImpl: options.fetchImpl });
    await writeFileAtomically(archivePath, archive);
  }

  const members = extractArchiveMembers(archive, target.archiveFormat, Object.values(target.members));
  await mkdir(destination, { recursive: true });
  const fileDigests = {};
  for (const [memberKey, outputName] of Object.entries(DIRECT_OUTPUTS)) {
    const content = requiredMember(members, target.members[memberKey]);
    await writeFileAtomically(path.join(destination, outputName), content);
    fileDigests[outputName] = sha256(content);
  }

  await writeFileAtomically(path.join(destination, '_curlrc'), DEFAULT_CONFIG);
  fileDigests._curlrc = sha256(DEFAULT_CONFIG);

  const thirdPartyLicenses = combinedThirdPartyLicenses(target, members);
  await writeFileAtomically(
    path.join(destination, 'THIRD-PARTY-LICENSES-CURL.txt'),
    thirdPartyLicenses,
  );
  fileDigests['THIRD-PARTY-LICENSES-CURL.txt'] = sha256(thirdPartyLicenses);
  const notice = Buffer.from(sandboxCurlNotice(manifest, target));
  await writeFileAtomically(path.join(destination, 'NOTICE-CURL.txt'), notice);
  fileDigests['NOTICE-CURL.txt'] = sha256(notice);
  await writeFileAtomically(path.join(destination, 'curl-metadata.json'), Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    name: manifest.name,
    version: manifest.version,
    build: manifest.build,
    tlsBackend: 'LibreSSL',
    trustMode: 'windows-native+mozilla-bundle',
    source: target.url,
    archiveSize: target.archiveSize,
    archiveSha256: target.archiveSha256,
    files: fileDigests,
  }, null, 2)}\n`));

  await verifyPreparedSandboxCurl({
    destination,
    execute: options.verifyExecutable ?? isHostTarget(target),
    manifest,
  });
  return { archivePath, binaryPath: path.join(destination, 'curl.exe'), destination, target };
}

export async function verifyPreparedSandboxCurl(options = {}) {
  const manifest = options.manifest ?? await loadSandboxCurlManifest();
  const target = targetForPlatform(manifest, 'win32', 'x64');
  const destination = path.resolve(options.destination ?? preparedSandboxCurlDirectory(
    path.resolve(options.projectDir ?? defaultProjectDir),
  ));
  const metadata = JSON.parse(await readFile(path.join(destination, 'curl-metadata.json'), 'utf8'));
  if (
    metadata?.schemaVersion !== 1
    || metadata?.name !== manifest.name
    || metadata?.version !== manifest.version
    || metadata?.build !== manifest.build
    || metadata?.tlsBackend !== 'LibreSSL'
    || metadata?.trustMode !== 'windows-native+mozilla-bundle'
    || metadata?.source !== target.url
    || metadata?.archiveSize !== target.archiveSize
    || metadata?.archiveSha256 !== target.archiveSha256
  ) {
    throw new Error('Prepared sandbox curl metadata is invalid.');
  }
  if (
    !metadata.files
    || REQUIRED_FILES.some((name) => typeof metadata.files[name] !== 'string')
    || Object.keys(metadata.files).some((name) => !REQUIRED_FILES.includes(name))
  ) {
    throw new Error('Prepared sandbox curl file manifest is invalid.');
  }
  for (const [name, expectedDigest] of Object.entries(metadata.files)) {
    const actual = await readFile(path.join(destination, name));
    if (sha256(actual) !== expectedDigest) {
      throw new Error(`Prepared sandbox curl file failed verification: ${name}`);
    }
  }
  const defaultConfig = await readFile(path.join(destination, '_curlrc'));
  if (!defaultConfig.equals(DEFAULT_CONFIG)) {
    throw new Error('Prepared sandbox curl must enable the Windows native CA store.');
  }
  const binaryPath = path.join(destination, 'curl.exe');
  await access(binaryPath);
  if (options.execute !== false) await verifySandboxCurlVersion(binaryPath, manifest.version);
  return { binaryPath, destination, version: manifest.version };
}

export function preparedSandboxCurlDirectory(projectDir = defaultProjectDir) {
  return path.join(path.resolve(projectDir), '.cache', 'sandbox-curl', TARGET_KEY);
}

export async function verifySandboxCurlVersion(binaryPath, expectedVersion) {
  const { stdout } = await execFileAsync(binaryPath, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  const output = String(stdout);
  const firstLine = output.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  if (!firstLine.startsWith(`curl ${expectedVersion} `)) {
    throw new Error(`Unexpected bundled curl version: ${firstLine || '(no output)'}`);
  }
  if (!firstLine.includes('LibreSSL/') || firstLine.includes('Schannel')) {
    throw new Error(`Bundled sandbox curl must use LibreSSL instead of Schannel: ${firstLine}`);
  }
}

function targetForPlatform(manifest, platform, arch) {
  const target = Object.values(manifest.packages).find((candidate) => (
    candidate.platform === platform && candidate.arch === arch
  ));
  if (!target) throw new Error(`No pinned sandbox curl package for ${platform}-${arch}.`);
  return target;
}

function cachedArchivePath(projectDir, target) {
  return path.join(projectDir, '.cache', 'sandbox-curl', 'downloads', `${target.archiveSha256}.zip`);
}

export async function downloadSandboxCurlArchive(target, options = {}) {
  const retryDelaysMs = options.retryDelaysMs ?? DOWNLOAD_RETRY_DELAYS_MS;
  const totalAttempts = retryDelaysMs.length + 1;
  const logger = options.logger ?? console;
  let lastError;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    logger.info(`[sandbox-curl] Downloading ${target.url} (attempt ${attempt}/${totalAttempts})...`);
    try {
      return await downloadArchiveAttempt(target, options.fetchImpl, options.timeoutMs);
    } catch (error) {
      lastError = error;
      const retryDelayMs = retryDelaysMs[attempt - 1];
      if (retryDelayMs === undefined) break;
      logger.warn(
        `[sandbox-curl] Download attempt ${attempt}/${totalAttempts} failed: ${errorMessage(error)}. `
        + `Retrying in ${retryDelayMs} ms...`,
      );
      await (options.delayImpl ?? delay)(retryDelayMs);
    }
  }

  throw new Error(
    `Failed to download sandbox curl from ${target.url} after ${totalAttempts} attempts: ${errorMessage(lastError)}`,
    { cause: lastError },
  );
}

async function downloadArchiveAttempt(target, fetchImpl, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
  const abort = new globalThis.AbortController();
  const proxyAgent = fetchImpl ? null : new EnvHttpProxyAgent();
  const timer = setTimeout(() => {
    abort.abort(new Error(`Sandbox curl download timed out after ${timeoutMs} ms.`));
  }, timeoutMs);
  try {
    const response = await (fetchImpl ?? undiciFetch)(target.url, {
      signal: abort.signal,
      ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
    });
    if (!response.ok) throw new Error(`Failed to download sandbox curl: HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (!archiveMatchesTarget(archive, target)) {
      throw new Error('Downloaded sandbox curl archive failed size or SHA-256 verification.');
    }
    return archive;
  } finally {
    clearTimeout(timer);
    await proxyAgent?.close();
  }
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function archiveMatchesTarget(archive, target) {
  return archive.length === target.archiveSize && sha256(archive) === target.archiveSha256;
}

function requiredMember(members, memberPath) {
  const content = members.get(memberPath);
  if (!content) throw new Error(`Sandbox curl archive member was not extracted: ${memberPath}`);
  return content;
}

function combinedThirdPartyLicenses(target, members) {
  const entries = Object.entries(target.members)
    .filter(([key]) => !Object.hasOwn(DIRECT_OUTPUTS, key))
    .map(([key, memberPath]) => {
      const content = requiredMember(members, memberPath).toString('utf8').trimEnd();
      return `===== ${key}: ${memberPath} =====\n${content}`;
    });
  return Buffer.from(`${entries.join('\n\n')}\n`);
}

function sandboxCurlNotice(manifest, target) {
  return [
    `${manifest.name} ${manifest.build}`,
    `Source: ${target.url}`,
    'TLS backend: LibreSSL (selected because Windows Schannel cannot acquire default credentials under the restricted sandbox token).',
    'Trust: Windows ROOT/CA stores plus the bundled Mozilla CA file (configured by _curlrc).',
    '',
    'The curl license and bundled dependency licenses are included beside this file.',
    '',
  ].join('\n');
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

function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1
    || !manifest.name
    || !manifest.version
    || !manifest.build
    || !manifest.license
  ) {
    throw new Error('Sandbox curl manifest header is invalid.');
  }
  const target = manifest.packages?.[TARGET_KEY];
  if (
    !target
    || target.platform !== 'win32'
    || target.arch !== 'x64'
    || target.archiveFormat !== 'zip'
    || !target.url
    || !Number.isSafeInteger(target.archiveSize)
    || target.archiveSize <= 0
    || !/^[a-f0-9]{64}$/u.test(target.archiveSha256)
  ) {
    throw new Error('Sandbox curl win-x64 target is invalid.');
  }
  for (const key of [...Object.keys(DIRECT_OUTPUTS), 'brotliLicense', 'certdataLicense', 'libpslLicense',
    'libresslLicense', 'libssh2License', 'nghttp2License', 'nghttp3License', 'ngtcp2License',
    'pslLicense', 'zlibngLicense', 'zstdLicense']) {
    if (!target.members?.[key]) throw new Error(`Sandbox curl manifest is missing ${key}.`);
  }
}

function cliValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareSandboxCurl({
    arch: cliValue('--arch'),
    platform: cliValue('--platform'),
    projectDir: cliValue('--project-dir'),
    verifyExecutable: process.argv.includes('--skip-execute') ? false : undefined,
  });
  console.log(JSON.stringify({ binaryPath: result.binaryPath, target: TARGET_KEY }));
}
