import { DatabaseSync } from 'node:sqlite';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  categoryTargetPaths,
  createSqliteSnapshot,
  inventorySnapshotSources,
  prepareLocalSnapshotSources,
  summarizeLocalSnapshotCategories,
} from '../../../src/webdav-sync/snapshot-data.js';
import { parsePortableProjectCatalog } from '../../../src/webdav-sync/portable-projects.js';

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
    const skillFile = sources.find((source) => (
      source.logicalPath === 'runtime/user-skills/demo/SKILL.md'
    ));

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
      states: { demo: { enabled: true } },
    });
    expect(skillFile?.sourcePath).not.toBe(path.join(root, 'runtime', 'user-skills', 'demo', 'SKILL.md'));
    await writeFile(path.join(root, 'runtime', 'user-skills', 'demo', 'SKILL.md'), '# Changed', 'utf8');
    expect(await readFile(skillFile!.sourcePath!, 'utf8')).toBe('# Demo');
    const inventory = await inventorySnapshotSources(sources);
    expect(inventory.find((item) => item.credentialId === 'provider-openai')).toMatchObject({
      size: Buffer.byteLength('sk-provider-secret'),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(providerKey?.data?.every((byte) => byte === 0)).toBe(true);
    expect(imageKey?.data?.every((byte) => byte === 0)).toBe(true);
  });

  it('records user Skill executables while keeping the plaintext staging copy private', async () => {
    if (process.platform === 'win32') return;
    const root = await createDataRoot();
    const scriptPath = path.join(root, 'runtime', 'user-skills', 'demo', 'scripts', 'run.sh');
    await mkdir(path.dirname(scriptPath), { recursive: true });
    await writeFile(scriptPath, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(scriptPath, 0o755);

    const sources = await prepareLocalSnapshotSources({
      dataRoot: root,
      stagingRoot: path.join(root, '.webdav-sync-work', 'executable'),
      categories: ['user_skills'],
    });
    const script = sources.find((source) => (
      source.logicalPath === 'runtime/user-skills/demo/scripts/run.sh'
    ));

    expect(script).toMatchObject({ executable: true });
    expect((await stat(script!.sourcePath!)).mode & 0o111).toBe(0);
    const inventory = await inventorySnapshotSources(sources);
    expect(inventory.find((item) => item.logicalPath.endsWith('/scripts/run.sh')))
      .toMatchObject({ executable: true });
  });

  it('copies conversation storage consistently and rejects symlinks in managed directories', async () => {
    const root = await createDataRoot();
    const firstStaging = path.join(root, '.webdav-sync-work', 'conversation');
    const sources = await prepareLocalSnapshotSources({
      dataRoot: root,
      stagingRoot: firstStaging,
      categories: ['conversations'],
    });
    const databaseSource = sources.find((source) => source.logicalPath === 'runtime/threads.sqlite');
    const toolResultIndex = sources.find((source) => source.logicalPath === 'runtime/tool-results/index.json');
    const toolResultPayload = sources.find((source) => (
      source.logicalPath === 'runtime/tool-results/files/tool_result_saved'
    ));
    expect(databaseSource?.sourcePath).not.toBe(path.join(root, 'runtime', 'threads.sqlite'));
    expect(toolResultIndex?.sourcePath).not.toBe(path.join(root, 'runtime', 'tool-results', 'index.json'));
    expect(await readFile(toolResultIndex!.sourcePath!, 'utf8')).toContain('tool_result_saved');
    expect(await readFile(toolResultPayload!.sourcePath!, 'utf8')).toBe('complete tool output');
    expect(categoryTargetPaths(root, ['conversations']))
      .toContain(path.join(root, 'runtime', 'tool-results'));
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

  it('keeps device-local attachment links out of portable conversation snapshots', async () => {
    const root = await createDataRoot();
    const localPath = path.join(root, 'private', 'notes.txt');
    const indexPath = path.join(root, 'runtime', 'attachments', 'index.json');
    await writeFile(indexPath, JSON.stringify({
      version: 1,
      attachments: [
        { id: 'attachment_link', storage: 'linked', absolutePath: localPath },
        { id: 'attachment_managed', storage: 'managed', fileName: 'image.png' },
      ],
    }));

    const sources = await prepareLocalSnapshotSources({
      dataRoot: root,
      stagingRoot: path.join(root, '.webdav-sync-work', 'portable-attachments'),
      categories: ['conversations'],
    });
    const portableIndex = sources.find((source) => (
      source.logicalPath === 'runtime/attachments/index.json'
    ));
    const restored = JSON.parse(await readFile(portableIndex!.sourcePath!, 'utf8')) as {
      attachments: Array<{ id: string }>;
    };

    expect(restored.attachments).toEqual([{ id: 'attachment_managed', storage: 'managed', fileName: 'image.png' }]);
    expect(await readFile(portableIndex!.sourcePath!, 'utf8')).not.toContain(localPath);
  });

  it('interrupts an in-progress SQLite backup when snapshot creation is cancelled', async () => {
    const root = await createDataRoot();
    const sourcePath = path.join(root, 'runtime', 'threads.sqlite');
    const source = new DatabaseSync(sourcePath);
    source.exec('CREATE TABLE cancellation_payload (data BLOB); INSERT INTO cancellation_payload VALUES (zeroblob(2097152));');
    source.close();
    const destinationPath = path.join(root, '.webdav-sync-work', 'cancelled.sqlite');
    const abort = new AbortController();

    await expect(createSqliteSnapshot(
      sourcePath,
      destinationPath,
      {
        signal: abort.signal,
        onProgress: () => abort.abort(new Error('cancel sqlite snapshot')),
      },
    )).rejects.toThrow('cancel sqlite snapshot');
    await expect(stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('summarizes the current local size of every sync category', async () => {
    const root = await createDataRoot();
    const summaries = await summarizeLocalSnapshotCategories({
      dataRoot: root,
      stagingRoot: path.join(root, '.webdav-sync-work', 'summary'),
      categories: [
        'conversations',
        'memories',
        'preferences',
        'model_credentials',
        'user_skills',
        'usage',
      ],
    });
    const byCategory = new Map(summaries.map((summary) => [summary.id, summary]));

    expect(summaries.map((summary) => summary.id)).toEqual([
      'conversations',
      'memories',
      'preferences',
      'model_credentials',
      'user_skills',
      'usage',
    ]);
    expect(byCategory.get('conversations')).toEqual(expect.objectContaining({
      itemCount: 4,
      totalBytes: expect.any(Number),
    }));
    expect(byCategory.get('preferences')).toEqual(expect.objectContaining({
      itemCount: 1,
      totalBytes: expect.any(Number),
    }));
    expect(byCategory.get('model_credentials')).toEqual({
      id: 'model_credentials',
      itemCount: 2,
      totalBytes: Buffer.byteLength('sk-provider-secret') + Buffer.byteLength('sk-image-secret'),
    });
    expect(byCategory.get('user_skills')?.itemCount).toBe(2);
    expect(byCategory.get('memories')).toEqual({ id: 'memories', itemCount: 0, totalBytes: 0 });
    expect(byCategory.get('usage')).toEqual({ id: 'usage', itemCount: 0, totalBytes: 0 });
  });

  it('backs up project identity without leaking the device-local folder binding', async () => {
    const root = await createDataRoot();
    const localWorkspace = path.join(root, 'private', 'workspace');
    await mkdir(localWorkspace, { recursive: true });
    await writeFile(path.join(root, 'runtime', 'projects.json'), JSON.stringify({
      version: 1,
      projects: [{
        id: 'project_portable',
        name: 'Portable',
        path: localWorkspace,
        gitRoot: localWorkspace,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      }],
    }));

    const sources = await prepareLocalSnapshotSources({
      dataRoot: root,
      stagingRoot: path.join(root, '.webdav-sync-work', 'projects'),
      categories: ['conversations'],
    });
    const catalog = sources.find((source) => source.kind === 'project-catalog');
    expect(catalog).toMatchObject({
      category: 'conversations',
      logicalPath: 'portable/projects.json',
      label: '项目关联',
    });
    expect(catalog?.data?.toString('utf8')).not.toContain(localWorkspace);
    expect(parsePortableProjectCatalog(catalog!.data!)).toEqual([{
      id: 'project_portable',
      name: 'Portable',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    }]);
  });
});

async function createDataRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-data-'));
  temporaryRoots.push(root);
  const runtimeRoot = path.join(root, 'runtime');
  await mkdir(path.join(runtimeRoot, 'attachments'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'tool-results', 'files'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'user-skills', 'demo'), { recursive: true });
  await writeFile(path.join(runtimeRoot, 'attachments', 'note.txt'), 'attachment', 'utf8');
  await writeFile(path.join(runtimeRoot, 'tool-results', 'index.json'), JSON.stringify({
    version: 1,
    results: [{ resultId: 'tool_result_saved', threadIds: ['thread_saved'] }],
  }), 'utf8');
  await writeFile(
    path.join(runtimeRoot, 'tool-results', 'files', 'tool_result_saved'),
    'complete tool output',
    'utf8',
  );
  await writeFile(path.join(runtimeRoot, 'user-skills', 'demo', 'SKILL.md'), '# Demo', 'utf8');
  await writeFile(path.join(runtimeRoot, 'skills.json'), JSON.stringify({
    version: 1,
    states: {
      demo: { enabled: true },
      'bundled-skill': { enabled: false },
      'plugin-skill': { enabled: true },
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
