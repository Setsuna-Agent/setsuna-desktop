import { createHash } from 'node:crypto';
import { unzip } from 'fflate';
import type { GitHubCliInstallationHost } from '../contracts/index.js';

type Asset = { name: string; size: number };
const releaseApi = 'https://api.github.com/repos/cli/cli/releases/latest';
const maxArchiveBytes = 64 * 1024 * 1024;

export function cliReleaseTarget(platform: string, arch: string) {
  const os = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'windows' : null;
  const architecture = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : null;
  if (!os || !architecture) throw new Error(`GitHub CLI installation is unavailable for ${platform}/${arch}.`);
  return { suffix: `${os}_${architecture}.zip`, executable: platform === 'win32' ? 'gh.exe' : 'gh' };
}

/** Only official release URLs may redirect to GitHub's release asset storage. */
async function download(host: GitHubCliInstallationHost, url: string, signal: AbortSignal, limit: number, progress?: (bytes: number) => void): Promise<Buffer> {
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password
      || !['api.github.com', 'github.com', 'release-assets.githubusercontent.com'].includes(target.hostname)) throw new Error('Unexpected GitHub CLI download URL.');
    const response = await host.fetch(url, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
      await response.body?.cancel();
      url = new URL(response.headers.get('location')!, url).href;
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`GitHub CLI download failed (HTTP ${response.status}).`); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > limit) throw new Error('GitHub CLI download exceeded its expected size.');
        chunks.push(chunk.value);
        progress?.(size);
      }
      return Buffer.concat(chunks);
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  throw new Error('Too many GitHub CLI download redirects.');
}

export async function downloadGitHubCli(host: GitHubCliInstallationHost, platform: string, arch: string, signal: AbortSignal,
  progress: (phase: 'downloading' | 'verifying', receivedBytes: number, totalBytes: number) => void) {
  const target = cliReleaseTarget(platform, arch);
  const release = JSON.parse((await download(host, releaseApi, signal, 2_000_000)).toString('utf8')) as { tag_name: string; assets: Asset[] };
  if (!/^v\d+\.\d+\.\d+$/u.test(release.tag_name)) throw new Error('GitHub returned an invalid CLI release.');
  const prefix = `gh_${release.tag_name.slice(1)}`;
  const name = `${prefix}_${target.suffix}`;
  const asset = release.assets.find((entry) => entry.name === name);
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxArchiveBytes) throw new Error('GitHub CLI release is missing a supported download.');
  const base = `https://github.com/cli/cli/releases/download/${release.tag_name}/`;
  const checksums = (await download(host, `${base}${prefix}_checksums.txt`, signal, 100_000)).toString('utf8');
  const expected = checksums.split(/\r?\n/u).map((line) => /^([a-fA-F0-9]{64})\s+\*?(.+)$/u.exec(line)).find((entry) => entry?.[2] === name)?.[1];
  if (!expected) throw new Error('GitHub CLI release is missing its checksum.');
  progress('downloading', 0, asset.size);
  const archive = await download(host, `${base}${name}`, signal, asset.size, (bytes) => progress('downloading', bytes, asset.size));
  progress('verifying', archive.length, asset.size);
  if (archive.length !== asset.size || createHash('sha256').update(archive).digest('hex') !== expected.toLowerCase()) throw new Error('GitHub CLI download checksum does not match. Please try again.');
  // Extract selected files into memory, never materialize archive-controlled paths or links.
  const directory = platform === 'darwin' ? `${name.slice(0, -4)}/` : '';
  const binaryPath = `${directory}bin/${target.executable}`;
  const licensePath = `${directory}LICENSE`;
  const allowed = new Set([binaryPath, licensePath]);
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(archive, { filter: (file) => allowed.has(file.name) && file.originalSize <= 128 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
  });
  signal.throwIfAborted();
  const binary = files[binaryPath];
  if (!binary?.length || !files[licensePath]?.length) throw new Error('GitHub CLI archive is missing its executable or license.');
  return { binary, license: files[licensePath], version: release.tag_name.slice(1) };
}
