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
const installers = [
  ['macos-arm64', `Setsuna-Desktop-${packageJson.version}-mac-arm64.dmg`],
  ['macos-x64', `Setsuna-Desktop-${packageJson.version}-mac-x64.dmg`],
  ['windows-x64', `Setsuna-Desktop-${packageJson.version}-windows-x64.exe`],
] as const;

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-release-assets-'));
  fixtures.push(root);
  await mkdir(path.join(root, 'release-artifacts'));
  for (const [, name] of installers) await writeFile(path.join(root, 'release-artifacts', name), `installer:${name}`);
  return root;
}

async function run(root: string, script: string, ...args: string[]): Promise<void> {
  await execFileAsync(process.execPath, [path.resolve(import.meta.dirname, '..', script), ...args], { cwd: root });
}

describe('public release assets', () => {
  it('collects only installers and publishes matching checksums without internal build artifacts', async () => {
    const root = await fixture();
    const noise = ['latest-mac.yml', 'latest.yml', 'release-manifest.json', 'build-logs-v1.zip',
      `${installers[0][1]}.blockmap`, installers[0][1].replace('.dmg', '.zip')];
    for (const name of noise) await writeFile(path.join(root, 'release-artifacts', name), 'internal');
    for (const [job, name] of installers) {
      await run(root, 'collect-release-job-assets.mjs', job);
      expect(await readdir(path.join(root, 'release-upload', job))).toEqual([name]);
    }
    // Also exercise the publication boundary with an older, noisy artifact set.
    for (const name of noise) await writeFile(path.join(root, 'release-upload', name), 'internal');
    await run(root, 'prepare-github-release-assets.mjs', 'release-upload', 'public');
    expect((await readdir(path.join(root, 'public'))).sort()).toEqual(['SHA256SUMS', ...installers.map(([, name]) => name)].sort());
    const checksums = await readFile(path.join(root, 'public', 'SHA256SUMS'), 'utf8');
    for (const [, name] of installers) {
      const content = await readFile(path.join(root, 'public', name));
      expect(content.toString()).toBe(`installer:${name}`);
      expect(checksums).toContain(`${createHash('sha256').update(content).digest('hex')}  ${name}\n`);
    }
    expect(checksums.trim().split('\n')).toHaveLength(3);
  });

  it('rejects missing or duplicate installers before preparing a release', async () => {
    const root = await fixture();
    const first = path.join(root, 'release-artifacts', installers[0][1]);
    await mkdir(path.join(root, 'release-artifacts', 'duplicate'));
    const duplicate = path.join(root, 'release-artifacts', 'duplicate', installers[0][1]);
    await copyFile(first, duplicate);
    await expect(run(root, 'prepare-github-release-assets.mjs', 'release-artifacts', 'public')).rejects.toThrow('Release asset name collision');
    await rm(duplicate);
    await rm(first);
    await expect(run(root, 'prepare-github-release-assets.mjs', 'release-artifacts', 'public')).rejects.toThrow('Missing release installers');
    await expect(readdir(path.join(root, 'public'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
