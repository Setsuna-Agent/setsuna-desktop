import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };

const execFileAsync = promisify(execFile);
const fixtures: string[] = [];
const targets = [
  ['macos-arm64', [`Setsuna-Desktop-${packageJson.version}-mac-arm64.dmg`, `Setsuna-Desktop-${packageJson.version}-mac-arm64.zip`]],
  ['macos-x64', [`Setsuna-Desktop-${packageJson.version}-mac-x64.dmg`, `Setsuna-Desktop-${packageJson.version}-mac-x64.zip`]],
  ['windows-x64', [`Setsuna-Desktop-${packageJson.version}-windows-x64.exe`]],
] as const;
const assetNames = targets.flatMap(([, names]) => [...names]);

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-release-assets-'));
  fixtures.push(root);
  await mkdir(path.join(root, 'release-artifacts'));
  for (const name of assetNames) await writeFile(path.join(root, 'release-artifacts', name), `installer:${name}`);
  return root;
}

async function run(root: string, script: string, ...args: string[]): Promise<void> {
  await execFileAsync(process.execPath, [path.resolve(import.meta.dirname, '..', script), ...args], { cwd: root });
}

describe('public release assets', () => {
  it('publishes installers and macOS update ZIPs with matching checksums, excluding internal artifacts', async () => {
    const root = await fixture();
    const noise = ['latest-mac.yml', 'latest.yml', 'release-manifest.json', 'build-logs-v1.zip',
      `${assetNames[0]}.blockmap`, `Setsuna-Desktop-${packageJson.version}-windows-x64.zip`];
    for (const name of noise) await writeFile(path.join(root, 'release-artifacts', name), 'internal');
    for (const [job, names] of targets) {
      await run(root, 'collect-release-job-assets.mjs', job);
      expect((await readdir(path.join(root, 'release-upload', job))).sort()).toEqual([...names].sort());
    }
    // Also exercise the publication boundary with an older, noisy artifact set.
    for (const name of noise) await writeFile(path.join(root, 'release-upload', name), 'internal');
    await run(root, 'prepare-github-release-assets.mjs', 'release-upload', 'public');
    expect((await readdir(path.join(root, 'public'))).sort()).toEqual(['SHA256SUMS', ...assetNames].sort());
    const checksums = await readFile(path.join(root, 'public', 'SHA256SUMS'), 'utf8');
    for (const name of assetNames) {
      const content = await readFile(path.join(root, 'public', name));
      expect(content.toString()).toBe(`installer:${name}`);
      expect(checksums).toContain(`${createHash('sha256').update(content).digest('hex')}  ${name}\n`);
    }
    expect(checksums.trim().split('\n')).toHaveLength(5);
  });

  it('rejects missing or duplicate update ZIPs before preparing a release', async () => {
    const root = await fixture();
    const first = path.join(root, 'release-artifacts', assetNames[1]!);
    await mkdir(path.join(root, 'release-artifacts', 'duplicate'));
    const duplicate = path.join(root, 'release-artifacts', 'duplicate', assetNames[1]!);
    await copyFile(first, duplicate);
    await expect(run(root, 'prepare-github-release-assets.mjs', 'release-artifacts', 'public')).rejects.toThrow('Release asset name collision');
    await rm(duplicate);
    await rm(first);
    await expect(run(root, 'prepare-github-release-assets.mjs', 'release-artifacts', 'public')).rejects.toThrow('Missing release assets');
    await expect(readdir(path.join(root, 'public'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
