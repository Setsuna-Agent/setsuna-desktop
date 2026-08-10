import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inventorySnapshotSources,
  prepareLocalSnapshotSources,
} from '../../../src/webdav-sync/snapshot-data.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WebDAV portable snapshot data', () => {
  it('exports model keys in memory and keeps device-local security settings out of preferences', async () => {
    const root = await createDataRoot();
    const stagingRoot = path.join(root, '.webdav-sync-work', 'snapshot');
    const sources = await prepareLocalSnapshotSources({
      dataRoot: root,
      stagingRoot,
      categories: ['preferences', 'model_credentials', 'user_skills'],
    });
    const providerKey = sources.find((source) => source.kind === 'provider-key');
    const imageKey = sources.find((source) => source.kind === 'image-generation-key');
    const config = sources.find((source) => source.logicalPath === 'runtime/config.json');
    const skillState = sources.find((source) => source.logicalPath === 'runtime/skills.json');

    expect(providerKey).toMatchObject({
      category: 'model_credentials',
      credentialId: 'provider-openai',
      label: 'OpenAI',
    });
    expect(providerKey?.sourcePath).toBeUndefined();
    expect(providerKey?.data?.toString('utf8')).toBe('sk-provider-secret');
    expect(imageKey?.data?.toString('utf8')).toBe('sk-image-secret');
    expect(sources.some((source) => source.sourcePath?.endsWith('secrets.json'))).toBe(false);
    const portableConfig = JSON.parse(await readFile(config!.sourcePath!, 'utf8')) as {
      approvalPolicy?: string;
      hooks?: unknown;
      storagePath?: string;
      providers: Array<{ proxyRoute?: { mode: string } }>;
    };
    expect(portableConfig.storagePath).toBeUndefined();
    expect(portableConfig.approvalPolicy).toBeUndefined();
    expect(portableConfig.hooks).toBeUndefined();
    expect(portableConfig.providers[0]?.proxyRoute).toBeUndefined();
    expect(JSON.parse(await readFile(skillState!.sourcePath!, 'utf8'))).toEqual({
      version: 1,
      states: { demo: { enabled: true, selected: true } },
    });
    const inventory = await inventorySnapshotSources(sources);
    expect(inventory.find((item) => item.credentialId === 'provider-openai')).toMatchObject({
      size: Buffer.byteLength('sk-provider-secret'),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(providerKey?.data?.every((byte) => byte === 0)).toBe(true);
    expect(imageKey?.data?.every((byte) => byte === 0)).toBe(true);
  });

  it('creates a consistent SQLite copy and rejects symlinks in managed directories', async () => {
    const root = await createDataRoot();
    const firstStaging = path.join(root, '.webdav-sync-work', 'conversation');
    const sources = await prepareLocalSnapshotSources({
      dataRoot: root,
      stagingRoot: firstStaging,
      categories: ['conversations'],
    });
    const databaseSource = sources.find((source) => source.logicalPath === 'runtime/threads.sqlite');
    expect(databaseSource?.sourcePath).not.toBe(path.join(root, 'runtime', 'threads.sqlite'));
    const snapshot = new DatabaseSync(databaseSource!.sourcePath!, { readOnly: true });
    try {
      expect(snapshot.prepare('SELECT value FROM sample').get()).toEqual({ value: 'saved' });
    } finally {
      snapshot.close();
    }

    await symlink(
      path.join(root, 'runtime', 'config.json'),
      path.join(root, 'runtime', 'attachments', 'unsafe-link'),
    );
    await expect(prepareLocalSnapshotSources({
      dataRoot: root,
      stagingRoot: path.join(root, '.webdav-sync-work', 'unsafe'),
      categories: ['conversations'],
    })).rejects.toThrow('符号链接');
  });
});

async function createDataRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-data-'));
  temporaryRoots.push(root);
  const runtimeRoot = path.join(root, 'runtime');
  await mkdir(path.join(runtimeRoot, 'attachments'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'user-skills', 'demo'), { recursive: true });
  await writeFile(path.join(runtimeRoot, 'attachments', 'note.txt'), 'attachment', 'utf8');
  await writeFile(path.join(runtimeRoot, 'user-skills', 'demo', 'SKILL.md'), '# Demo', 'utf8');
  await writeFile(path.join(runtimeRoot, 'skills.json'), JSON.stringify({
    version: 1,
    states: {
      demo: { enabled: true, selected: true },
      'bundled-skill': { enabled: false },
      'plugin-skill': { selected: true },
    },
  }), 'utf8');
  await writeFile(path.join(runtimeRoot, 'config.json'), JSON.stringify({
    schemaVersion: 5,
    storagePath: '/legacy-memory',
    approvalPolicy: 'full',
    permissionProfile: 'danger-full-access',
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'unsafe-local-hook' }] }] },
    providers: [{
      id: 'provider-openai',
      name: 'OpenAI',
      proxyRoute: { mode: 'proxy', proxyServerId: 'proxy-local' },
    }],
  }), 'utf8');
  await writeFile(path.join(runtimeRoot, 'secrets.json'), JSON.stringify({
    providerApiKeys: { 'provider-openai': 'sk-provider-secret' },
    imageGenerationApiKey: 'sk-image-secret',
  }), { encoding: 'utf8', mode: 0o600 });
  const database = new DatabaseSync(path.join(runtimeRoot, 'threads.sqlite'));
  database.exec('CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES (\'saved\');');
  database.close();
  return root;
}
