import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDataMigrationManifest,
  inspectDataMigrationTarget,
  migrationCategory,
} from '../../../src/data-root/manifest.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('desktop data migration manifest', () => {
  it('classifies durable files and skips rebuildable desktop caches', async () => {
    const root = await temporaryRoot();
    await Promise.all([
      writeFixture(root, 'runtime/threads.sqlite', 'sqlite'),
      writeFixture(root, 'runtime/memories/memories.json', '{"version":1,"memories":[]}'),
      writeFixture(root, 'runtime/.memories-before-unification-1/MEMORY.md', 'backup'),
      writeFixture(root, 'runtime/attachments/index.json', '{"attachments":[]}'),
      writeFixture(root, 'runtime/workspace-dependencies/bin/tool', 'tool'),
      writeFixture(root, 'runtime/plugins.json', '{}'),
      writeFixture(root, 'secure-credentials.json', '{}'),
      writeFixture(root, 'runtime/user-skills/demo/cache/notes.log', 'user-authored'),
      writeFixture(root, 'Local Storage/leveldb/000003.log', 'leveldb-data'),
      writeFixture(root, 'Preferences', '{}'),
      writeFixture(root, 'GPUCache/cache.bin', 'cache'),
      writeFixture(root, 'runtime/logs/runtime.log', 'log'),
    ]);

    const { manifest, blockers } = await buildDataMigrationManifest(root);
    const paths = manifest.entries.map((entry) => entry.relativePath.replaceAll(path.sep, '/'));

    expect(blockers).toEqual([]);
    expect(paths).toEqual(expect.arrayContaining([
      'Preferences',
      'Local Storage/leveldb/000003.log',
      'secure-credentials.json',
      'runtime/.memories-before-unification-1/MEMORY.md',
      'runtime/attachments/index.json',
      'runtime/memories/memories.json',
      'runtime/plugins.json',
      'runtime/threads.sqlite',
      'runtime/user-skills/demo/cache/notes.log',
      'runtime/workspace-dependencies/bin/tool',
    ]));
    expect(paths).not.toContain('GPUCache/cache.bin');
    expect(paths).not.toContain('runtime/logs/runtime.log');
    expect(manifest.entries.find((entry) => entry.relativePath === 'secure-credentials.json')?.category)
      .toBe('settings_credentials');
    expect(migrationCategory('runtime/.memories-before-unification-1/MEMORY.md')).toBe('memories');
  });

  it.skipIf(process.platform === 'win32')('blocks external symlinks and makes confined absolute symlinks portable', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await writeFixture(root, 'runtime/file.txt', 'inside');
    await writeFixture(
      root,
      'runtime/workspace-dependencies/toolchain/python/bin/python3.12',
      'managed-python',
    );
    await writeFixture(outside, 'outside.txt', 'outside');
    await symlink('file.txt', path.join(root, 'runtime', 'inside-link'));
    const managedPython = path.join(
      root,
      'runtime/workspace-dependencies/toolchain/python/bin/python3.12',
    );
    const virtualEnvironmentPython = path.join(
      root,
      'runtime/temporary-workspace/.venv/bin/python',
    );
    await mkdir(path.dirname(virtualEnvironmentPython), { recursive: true });
    await symlink(managedPython, virtualEnvironmentPython);
    await symlink(path.join(outside, 'outside.txt'), path.join(root, 'runtime', 'outside-link'));

    const { manifest, blockers } = await buildDataMigrationManifest(root);

    expect(manifest.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symlink',
        relativePath: path.join('runtime', 'inside-link'),
        linkTarget: 'file.txt',
      }),
    ]));
    expect(manifest.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symlink',
        relativePath: path.join('runtime', 'temporary-workspace', '.venv', 'bin', 'python'),
        sourceLinkTarget: managedPython,
        linkTarget: path.relative(path.dirname(virtualEnvironmentPython), managedPython),
      }),
    ]));
    expect(blockers).toEqual([
      expect.objectContaining({
        code: 'symlink_not_supported',
        path: path.join(root, 'runtime', 'outside-link'),
      }),
    ]);
  });

  it('blocks nested and non-empty targets before migration starts', async () => {
    const sourceRoot = await temporaryRoot();
    await writeFixture(sourceRoot, 'runtime/config.json', '{}');
    const nestedTarget = path.join(sourceRoot, 'nested-target');

    const nested = await inspectDataMigrationTarget({
      sourceRoot,
      targetRoot: nestedTarget,
      totalBytes: 2,
    });
    expect(nested.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source_target_nested' }),
    ]));

    const nonEmptyTarget = await temporaryRoot();
    await writeFixture(nonEmptyTarget, 'unrelated.txt', 'occupied');
    const occupied = await inspectDataMigrationTarget({
      sourceRoot,
      targetRoot: nonEmptyTarget,
      totalBytes: 2,
    });
    expect(occupied.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'target_not_empty' }),
    ]));
  });

  it('blocks targets that overlap bootstrap control files', async () => {
    const sourceRoot = await temporaryRoot();
    const controlRoot = await temporaryRoot();
    const targetRoot = path.join(controlRoot, 'selected-data');

    const inspection = await inspectDataMigrationTarget({
      sourceRoot,
      targetRoot,
      totalBytes: 0,
      reservedRoots: [controlRoot],
    });

    expect(inspection.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_target', path: targetRoot }),
    ]));
  });

  it('detects when the selected target volume identity changes before restart', async () => {
    const sourceRoot = await temporaryRoot();
    const targetRoot = await temporaryRoot();

    const inspection = await inspectDataMigrationTarget({
      sourceRoot,
      targetRoot,
      totalBytes: 0,
      expectedTargetDeviceId: 'a-different-device',
    });

    expect(inspection.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'target_unavailable', path: targetRoot }),
    ]));
  });

  it('warns when mount metadata identifies a network volume without path keywords', async () => {
    const sourceRoot = await temporaryRoot();
    const targetRoot = await temporaryRoot();

    const inspection = await inspectDataMigrationTarget({
      sourceRoot,
      targetRoot,
      totalBytes: 0,
      networkVolumeDetector: async () => true,
    });

    expect(inspection.warnings).toEqual([
      expect.objectContaining({
        code: 'network_or_cloud_location',
        path: targetRoot,
      }),
    ]);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-data-root-manifest-test-'));
  temporaryRoots.push(root);
  return root;
}

async function writeFixture(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}
