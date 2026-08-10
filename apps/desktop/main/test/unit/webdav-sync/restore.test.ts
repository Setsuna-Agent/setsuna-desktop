import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebDavSnapshotManifest } from '../../../src/webdav-sync/model.js';
import { snapshotSummary } from '../../../src/webdav-sync/repository.js';
import {
  applyRestoredSnapshot,
  assertRestorePlanCurrent,
  buildWebDavRestorePlan,
} from '../../../src/webdav-sync/restore.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WebDAV restore planning and commit', () => {
  it('makes overwrite and local-loss entries explicit and rejects stale plans', () => {
    const manifest = fixtureManifest();
    const snapshot = { manifest, summary: snapshotSummary(manifest) };
    const localItems = [
      inventory('preferences', 'runtime/config.json', 'local-config', 'Current config'),
      inventory('model_credentials', 'model-credentials/providers/openai', 'same-key', 'OpenAI'),
      inventory('model_credentials', 'model-credentials/providers/local-only', 'local-key', 'Local only'),
      inventory('user_skills', 'runtime/user-skills/local/SKILL.md', 'local-skill', 'Local Skill'),
    ];
    const plan = buildWebDavRestorePlan({
      snapshot,
      categories: ['preferences', 'model_credentials', 'user_skills'],
      localItems,
      now: new Date('2026-08-10T10:30:00.000Z'),
    });

    expect(plan.publicPlan.overwrittenCount).toBe(1);
    expect(plan.publicPlan.removedCount).toBe(1);
    expect(plan.publicPlan.diffs.find((diff) => diff.category === 'preferences')?.overwritten)
      .toEqual([expect.objectContaining({ id: 'runtime/config.json' })]);
    expect(plan.publicPlan.diffs.find((diff) => diff.category === 'model_credentials')?.removed)
      .toEqual([]);
    expect(plan.publicPlan.diffs.find((diff) => diff.category === 'model_credentials')?.preserved)
      .toContainEqual(expect.objectContaining({ label: 'Local only' }));
    expect(plan.publicPlan.diffs.find((diff) => diff.category === 'user_skills')?.removed)
      .toEqual([expect.objectContaining({ label: 'Local Skill' })]);
    expect(() => assertRestorePlanCurrent(plan, localItems, new Date('2026-08-10T10:31:00.000Z')))
      .not.toThrow();
    expect(() => assertRestorePlanCurrent(
      plan,
      localItems.map((item) => item.logicalPath === 'runtime/config.json'
        ? { ...item, sha256: 'newer-local-config' }
        : item),
      new Date('2026-08-10T10:31:00.000Z'),
    )).not.toThrow();
    expect(() => assertRestorePlanCurrent(
      plan,
      localItems.map((item) => item.logicalPath === 'model-credentials/providers/openai'
        ? { ...item, sha256: 'newer-local-key' }
        : item),
      new Date('2026-08-10T10:31:00.000Z'),
    )).toThrow('会被覆盖或删除的本地内容发生了变化');
    expect(() => assertRestorePlanCurrent(
      plan,
      [...localItems, inventory('preferences', 'runtime/extra', 'new', 'Changed')],
      new Date('2026-08-10T10:31:00.000Z'),
    )).toThrow('会被覆盖或删除的本地内容发生了变化');
  });

  it('merges portable config and API keys while preserving device-local security state', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-restore-'));
    temporaryRoots.push(dataRoot);
    const stagingRoot = path.join(dataRoot, '.webdav-sync-work', 'restored');
    await mkdir(path.join(dataRoot, 'runtime', 'memories'), { recursive: true });
    await mkdir(path.join(dataRoot, 'runtime', 'user-skills', 'local-skill'), { recursive: true });
    await mkdir(path.join(stagingRoot, 'runtime'), { recursive: true });
    await writeFile(path.join(dataRoot, 'runtime', 'config.json'), JSON.stringify({
      schemaVersion: 7,
      globalPrompt: 'local prompt',
      approvalPolicy: 'full',
      permissionProfile: 'danger-full-access',
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'local-hook' }] }] },
      desktopSettings: { interfaceLanguage: 'en-US', workspaceDependenciesEnabled: false },
      providers: [
        {
          id: 'openai',
          name: 'Local OpenAI',
          proxyRoute: { mode: 'proxy', proxyServerId: 'local-proxy' },
          models: [],
        },
        { id: 'local-only', name: 'Local only', models: [] },
      ],
    }));
    await writeFile(path.join(dataRoot, 'runtime', 'secrets.json'), JSON.stringify({
      providerApiKeys: { old: 'old-key', openai: 'local-openai-key' },
      imageGenerationApiKey: 'local-image-key',
    }));
    await writeFile(path.join(dataRoot, 'runtime', 'memories', 'keep.md'), 'keep me');
    await writeFile(path.join(dataRoot, 'runtime', 'skills.json'), JSON.stringify({
      version: 1,
      states: {
        'local-skill': { enabled: false },
        'bundled-skill': { selected: true },
      },
    }));
    await mkdir(path.join(stagingRoot, 'runtime', 'user-skills', 'backup-skill'), { recursive: true });
    await writeFile(path.join(stagingRoot, 'runtime', 'skills.json'), JSON.stringify({
      version: 1,
      states: { 'backup-skill': { enabled: true } },
    }));
    await writeFile(
      path.join(stagingRoot, 'runtime', 'config.json'),
      JSON.stringify({
        schemaVersion: 5,
        globalPrompt: 'restored prompt',
        approvalPolicy: 'strict',
        hooks: {},
        desktopSettings: { interfaceLanguage: 'zh-CN', workspaceDependenciesEnabled: true },
        providers: [
          {
            id: 'openai',
            name: 'Backup OpenAI',
            proxyRoute: { mode: 'direct' },
            models: [],
          },
          { id: 'backup-only', name: 'Backup only', models: [] },
        ],
      }),
    );
    const secrets = Buffer.from('{"providerApiKeys":{"openai":"sk-restored"}}\n');

    await applyRestoredSnapshot({
      dataRoot,
      stagingRoot,
      sourceDataRoot: '/different/device/root',
      categories: ['preferences', 'model_credentials', 'user_skills'],
      secretsBuffer: secrets,
    });

    const restoredConfig = JSON.parse(
      await readFile(path.join(dataRoot, 'runtime', 'config.json'), 'utf8'),
    ) as {
      providers: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    expect(restoredConfig).toMatchObject({
      schemaVersion: 7,
      globalPrompt: 'restored prompt',
      approvalPolicy: 'full',
      permissionProfile: 'danger-full-access',
      hooks: { PreToolUse: [{ hooks: [{ command: 'local-hook' }] }] },
      desktopSettings: { interfaceLanguage: 'zh-CN', workspaceDependenciesEnabled: false },
    });
    expect(restoredConfig.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openai',
        name: 'Backup OpenAI',
        proxyRoute: { mode: 'proxy', proxyServerId: 'local-proxy' },
      }),
      expect.objectContaining({ id: 'local-only' }),
      expect.objectContaining({ id: 'backup-only' }),
    ]));
    const restoredSecrets = JSON.parse(
      await readFile(path.join(dataRoot, 'runtime', 'secrets.json'), 'utf8'),
    ) as { providerApiKeys: Record<string, string>; imageGenerationApiKey?: string };
    expect(restoredSecrets.providerApiKeys).toEqual({
      old: 'old-key',
      openai: 'sk-restored',
    });
    expect(restoredSecrets.imageGenerationApiKey).toBe('local-image-key');
    expect(JSON.parse(await readFile(path.join(dataRoot, 'runtime', 'skills.json'), 'utf8')))
      .toEqual({
        version: 1,
        states: {
          'bundled-skill': { selected: true },
          'backup-skill': { enabled: true },
        },
      });
    if (process.platform !== 'win32') {
      expect((await stat(path.join(dataRoot, 'runtime', 'secrets.json'))).mode & 0o777).toBe(0o600);
    }
    expect(await readFile(path.join(dataRoot, 'runtime', 'memories', 'keep.md'), 'utf8')).toBe('keep me');
  });
});

function fixtureManifest(): WebDavSnapshotManifest {
  return {
    formatVersion: 1,
    repositoryId: '1455a7df-11ca-4b40-9fd8-f65e3a8846f0',
    id: '20260810T102030123Z-1234abcd',
    deviceId: '55bc8840-ac7a-435a-b5a7-88c2e91e7d87',
    deviceName: 'Backup device',
    createdAt: '2026-08-10T10:20:30.123Z',
    appVersion: '0.2.1',
    sourceDataRoot: '/backup/root',
    categories: ['preferences', 'model_credentials', 'user_skills'],
    items: [
      manifestItem('preferences', 'file', 'runtime/config.json', 'backup-config', 'Config', '000001.enc'),
      manifestItem(
        'model_credentials',
        'provider-key',
        'model-credentials/providers/openai',
        'same-key',
        'OpenAI',
        '000002.enc',
        'openai',
      ),
      manifestItem(
        'user_skills',
        'file',
        'runtime/user-skills/backup/SKILL.md',
        'backup-skill',
        'Backup Skill',
        '000003.enc',
      ),
    ],
  };
}

function manifestItem(
  category: 'preferences' | 'model_credentials' | 'user_skills',
  kind: 'file' | 'provider-key',
  logicalPath: string,
  sha256: string,
  label: string,
  objectName: string,
  credentialId?: string,
) {
  return {
    category,
    kind,
    logicalPath,
    label,
    ...(credentialId ? { credentialId } : {}),
    objectName,
    sha256,
    size: 1,
  };
}

function inventory(
  category: 'preferences' | 'model_credentials' | 'user_skills',
  logicalPath: string,
  sha256: string,
  label: string,
) {
  return {
    category,
    kind: category === 'model_credentials' ? 'provider-key' as const : 'file' as const,
    logicalPath,
    label,
    ...(category === 'model_credentials' ? { credentialId: logicalPath.split('/').at(-1) } : {}),
    sha256,
    size: 1,
  };
}
