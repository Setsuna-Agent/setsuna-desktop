import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GITHUB_DIRECT_DOWNLOAD_SOURCE_ID,
  normalizeDownloadSourceTemplate,
  resolveUpdateDownloadUrl,
  UpdateDownloadSourceStore,
} from './update-download-sources.js';

describe('desktop update download sources', () => {
  it('turns a proxy base URL into a raw GitHub URL template', () => {
    const template = normalizeDownloadSourceTemplate('https://mirror.example.com/');
    const resolved = resolveUpdateDownloadUrl(
      { id: 'mirror', name: 'Mirror', urlTemplate: template, builtIn: false },
      'https://github.com/setsuna/repo/releases/download/v1/app.dmg',
    );

    expect(template).toBe('https://mirror.example.com/{url}');
    expect(resolved).toBe('https://mirror.example.com/https://github.com/setsuna/repo/releases/download/v1/app.dmg');
  });

  it('supports templates that need an encoded original URL', () => {
    const resolved = resolveUpdateDownloadUrl(
      { id: 'mirror', name: 'Mirror', urlTemplate: 'https://mirror.example.com/download?url={encodedUrl}', builtIn: false },
      'https://github.com/setsuna/repo/releases/download/v1/app.dmg',
    );

    expect(resolved).toContain('url=https%3A%2F%2Fgithub.com%2Fsetsuna%2Frepo%2Freleases%2Fdownload%2Fv1%2Fapp.dmg');
  });

  it('rejects unsupported source protocols and template variables', () => {
    expect(() => normalizeDownloadSourceTemplate('file:///tmp/{url}')).toThrow('HTTP');
    expect(() => normalizeDownloadSourceTemplate('https://mirror.example.com/{asset}')).toThrow('{asset}');
  });

  it('persists custom sources, activates a new source, and falls back when it is removed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-update-sources-'));
    const configPath = path.join(root, 'update-download-sources.json');
    const store = new UpdateDownloadSourceStore(configPath);
    await store.load();

    const added = await store.add({ name: '公司镜像', urlTemplate: 'https://mirror.example.com/' });
    const customSource = added.sources.find((source) => !source.builtIn);
    expect(added.activeSourceId).toBe(customSource?.id);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({ activeSourceId: customSource?.id });

    const reloaded = new UpdateDownloadSourceStore(configPath);
    await reloaded.load();
    expect(reloaded.getActiveSource()).toMatchObject({ name: '公司镜像' });

    const removed = await reloaded.remove(customSource?.id ?? '');
    expect(removed.activeSourceId).toBe(GITHUB_DIRECT_DOWNLOAD_SOURCE_ID);
    expect(removed.sources).toHaveLength(1);
  });
});
