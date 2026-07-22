// @ts-nocheck -- Build scripts are native ESM and intentionally ship without declaration files.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';
import { extractArchiveMembers } from '../../ripgrep/archive.mjs';
import {
  loadRipgrepManifest,
  prepareRipgrep,
  verifyPreparedRipgrep,
} from '../../ripgrep/prepare-ripgrep.mjs';

describe('ripgrep packaging supply chain', () => {
  it('pins every release target to a versioned URL, byte size, SHA-256, and license members', async () => {
    const manifest = await loadRipgrepManifest();

    expect(manifest.version).toBe('15.1.0');
    expect(manifest.license).toBe('MIT OR Unlicense');
    expect(Object.keys(manifest.packages).sort()).toEqual([
      'linux-x64',
      'mac-arm64',
      'mac-x64',
      'win-x64',
    ]);
    for (const target of Object.values(manifest.packages)) {
      expect(target.url).toContain(`/releases/download/${manifest.version}/ripgrep-${manifest.version}-`);
      expect(target.archiveSize).toBeGreaterThan(1_000_000);
      expect(target.archiveSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(Object.keys(target.members).sort()).toEqual(['binary', 'copying', 'licenseMit', 'unlicense']);
    }
  });

  it('wires preparation and post-copy verification around an extraResources sidecar', () => {
    expect(packageJson.build.beforePack).toBe('scripts/before-pack.cjs');
    expect(packageJson.build.afterPack).toBe('scripts/after-pack.cjs');
    expect(packageJson.build.extraResources).toContainEqual(expect.objectContaining({
      from: '.cache/ripgrep/${os}-${arch}',
      to: 'setsuna-path',
      filter: expect.arrayContaining(['rg', 'rg.exe', 'LICENSE-MIT', 'UNLICENSE', 'COPYING', 'NOTICE.txt']),
    }));
    expect(packageJson.build.files).not.toContain(expect.stringContaining('.cache/ripgrep'));
  });

  it('downloads, verifies, and extracts only manifest-selected files', async () => {
    const archive = tarArchive({
      'fixture/rg': Buffer.from('binary'),
      'fixture/LICENSE-MIT': Buffer.from('mit'),
      'fixture/UNLICENSE': Buffer.from('unlicense'),
      'fixture/COPYING': Buffer.from('copying'),
      'fixture/not-packaged.txt': Buffer.from('nope'),
    });
    const manifest = fixtureManifest(archive);
    const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-rg-prepare-'));

    const prepared = await prepareRipgrep({
      manifest,
      platform: 'darwin',
      arch: 'arm64',
      projectDir,
      fetchImpl: async () => new Response(archive, { status: 200 }),
      verifyExecutable: false,
    });

    await expect(readFile(path.join(prepared.destination, 'rg'), 'utf8')).resolves.toBe('binary');
    await expect(readFile(path.join(prepared.destination, 'LICENSE-MIT'), 'utf8')).resolves.toBe('mit');
    await expect(readFile(path.join(prepared.destination, 'not-packaged.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(verifyPreparedRipgrep({
      manifest,
      platform: 'darwin',
      arch: 'arm64',
      projectDir,
      destination: prepared.destination,
      execute: false,
    })).resolves.toMatchObject({ binaryPath: path.join(prepared.destination, 'rg') });

    await rm(path.join(prepared.destination, 'rg'));
    await expect(verifyPreparedRipgrep({
      manifest,
      platform: 'darwin',
      arch: 'arm64',
      projectDir,
      destination: prepared.destination,
      execute: false,
    })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails preparation on a checksum mismatch or a missing binary member', async () => {
    const archive = tarArchive({
      'fixture/LICENSE-MIT': Buffer.from('mit'),
      'fixture/UNLICENSE': Buffer.from('unlicense'),
      'fixture/COPYING': Buffer.from('copying'),
    });
    const badChecksum = fixtureManifest(archive, { archiveSha256: '0'.repeat(64) });
    const missingBinary = fixtureManifest(archive);
    const checksumDir = await mkdtemp(path.join(tmpdir(), 'setsuna-rg-checksum-'));
    const missingDir = await mkdtemp(path.join(tmpdir(), 'setsuna-rg-missing-'));

    await expect(prepareRipgrep({
      manifest: badChecksum,
      platform: 'darwin',
      arch: 'arm64',
      projectDir: checksumDir,
      fetchImpl: async () => new Response(archive, { status: 200 }),
      verifyExecutable: false,
    })).rejects.toThrow('SHA-256');
    await expect(prepareRipgrep({
      manifest: missingBinary,
      platform: 'darwin',
      arch: 'arm64',
      projectDir: missingDir,
      fetchImpl: async () => new Response(archive, { status: 200 }),
      verifyExecutable: false,
    })).rejects.toThrow('missing required members');
  });

  it('extracts pinned members from the Windows zip format without external tools', () => {
    const archive = storedZip({
      'fixture/rg.exe': Buffer.from('windows-binary'),
      'fixture/LICENSE-MIT': Buffer.from('mit'),
    });

    const extracted = extractArchiveMembers(archive, 'zip', ['fixture/rg.exe', 'fixture/LICENSE-MIT']);

    expect(extracted.get('fixture/rg.exe')?.toString()).toBe('windows-binary');
    expect(extracted.get('fixture/LICENSE-MIT')?.toString()).toBe('mit');
  });
});

function fixtureManifest(archive: Buffer, overrides = {}) {
  return {
    schemaVersion: 1,
    name: 'ripgrep',
    version: '15.1.0',
    license: 'MIT OR Unlicense',
    packages: {
      'mac-arm64': {
        platform: 'darwin',
        arch: 'arm64',
        builderOs: 'mac',
        archiveFormat: 'tar.gz',
        archiveSize: archive.length,
        archiveSha256: sha256(archive),
        url: 'https://example.test/rg.tar.gz',
        members: {
          binary: 'fixture/rg',
          licenseMit: 'fixture/LICENSE-MIT',
          unlicense: 'fixture/UNLICENSE',
          copying: 'fixture/COPYING',
        },
        ...overrides,
      },
    },
  };
}

function tarArchive(entries: Record<string, Buffer>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(entries)) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write(content.length.toString(8).padStart(11, '0'), 124, 11, 'ascii');
    header[156] = 0x30;
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipTar(Buffer.concat(blocks));
}

function gzipTar(tar: Buffer): Buffer {
  return gzipSync(tar);
}

function storedZip(entries: Record<string, Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + content.length;
  }
  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralSection.length, 12);
  end.writeUInt32LE(localSection.length, 16);
  return Buffer.concat([localSection, centralSection, end]);
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
