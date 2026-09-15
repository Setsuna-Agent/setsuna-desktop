import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { GitHubCliInstaller } from '../../src/runtime/github-cli-installation.js';
import type { GitHubCliInstallationHost } from '../../src/contracts/index.js';

const roots: string[] = [];
const installers: GitHubCliInstaller[] = [];
afterEach(async () => {
  await Promise.all(installers.splice(0).map((installer) => installer.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(platform = 'darwin', arch = 'arm64', checksumMatches = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-cli-install-'));
  roots.push(root);
  const suffix = `${platform === 'darwin' ? 'macOS' : 'windows'}_${arch === 'x64' ? 'amd64' : 'arm64'}`;
  const prefix = `gh_2.100.0_${suffix}`;
  const folder = platform === 'darwin' ? `${prefix}/` : '';
  const executable = platform === 'win32' ? 'gh.exe' : 'gh';
  const archive = zipSync({
    [`${folder}bin/${executable}`]: strToU8('fixture binary'), [`${folder}LICENSE`]: strToU8('fixture license'),
    '../../outside': strToU8('must not be extracted'),
  });
  const checksum = checksumMatches ? createHash('sha256').update(archive).digest('hex') : '0'.repeat(64);
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/latest')) return Response.json({ tag_name: 'v2.100.0', assets: [{ name: `${prefix}.zip`, size: archive.length }] });
    if (url.endsWith('_checksums.txt')) return new Response(`${checksum}  ${prefix}.zip\n`);
    return new Response(archive);
  });
  const host: GitHubCliInstallationHost = { dataDir: root, fetch };
  const isInstalled = vi.fn(async () => false);
  const verify = vi.fn(async (file: string) => { expect(await readFile(file, 'utf8')).toBe('fixture binary'); });
  const installer = new GitHubCliInstaller(host, { platform, arch, isInstalled, verify });
  installers.push(installer);
  return { installer, root, fetch, isInstalled, verify };
}
const settled = async (installer: GitHubCliInstaller) => {
  await vi.waitFor(() => expect(['complete', 'error']).toContain(installer.read().phase));
  return installer.read();
};

describe('GitHub CLI installation', () => {
  it.each([['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'arm64'], ['win32', 'x64']])('installs the official %s/%s layout after checksum and execution verification', async (platform, arch) => {
    const { installer, root, fetch, verify } = await fixture(platform, arch);
    expect(installer.start().phase).toBe('checking');
    expect((await settled(installer)).phase).toBe('complete');
    expect(await readFile(installer.executable, 'utf8')).toBe('fixture binary');
    expect(await readdir(root)).toEqual(['github-cli']);
    expect(await readdir(path.join(root, 'github-cli'))).toEqual(['bin']);
    expect(verify).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(installer.read().receivedBytes).toBe(installer.read().totalBytes);
  });

  it('coalesces repeated clicks and skips downloads for an existing CLI', async () => {
    const { installer, fetch, isInstalled } = await fixture();
    let finish!: (value: boolean) => void;
    isInstalled.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    installer.start(); installer.start();
    expect(isInstalled).toHaveBeenCalledOnce();
    finish(true);
    expect((await settled(installer)).phase).toBe('complete');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a tampered archive before extracting or executing it', async () => {
    const { installer, root, verify } = await fixture('darwin', 'arm64', false);
    installer.start();
    expect((await settled(installer)).error).toContain('checksum');
    expect(verify).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it('cleans a failed verification and can retry without exposing a partial installation', async () => {
    const { installer, root, verify } = await fixture();
    verify.mockRejectedValueOnce(new Error('Cannot run executable'));
    installer.start();
    expect((await settled(installer)).error).toBe('Cannot run executable');
    expect(await readdir(path.join(root, 'github-cli'))).toEqual([]);
    installer.start();
    expect((await settled(installer)).phase).toBe('complete');
  });

  it('refuses redirects outside official GitHub asset hosts', async () => {
    const { installer, fetch } = await fixture();
    fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://untrusted.example/archive.zip' } }));
    installer.start();
    expect((await settled(installer)).error).toContain('Unexpected');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
