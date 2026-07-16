import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileSkillRegistry } from '../skill/file-skill-registry.js';
import { FileConfigStore } from '../store/file-config-store.js';
import { FileMcpStore } from '../store/file-mcp-store.js';
import { InMemoryDesktopNativeBridge } from '../store/in-memory-secret-store.js';
import { FilePluginBundleStore } from './file-plugin-bundle-store.js';
import { FilePluginMarketplace } from './file-plugin-marketplace.js';

describe('file plugin marketplace', () => {
  it('lists curated plugins and installs them by id without exposing a source path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-marketplace-'));
    const catalogDir = path.join(root, 'catalog');
    await createCatalogPlugin(catalogDir, 'docs', {
      name: 'Docs Helper',
      publisher: 'Setsuna',
      tags: ['文档'],
      featured: true,
    });
    const runtime = await createPluginRuntime(root);
    const marketplace = new FilePluginMarketplace(catalogDir, runtime.plugins);

    await expect(marketplace.listPlugins()).resolves.toEqual({
      errors: [],
      plugins: [{
        id: 'docs',
        name: 'Docs Helper',
        version: '1.0.0',
        publisher: 'Setsuna',
        tags: ['文档'],
        featured: true,
        capabilities: { skills: 0, mcpServers: 0, hooks: 0, resources: 0 },
        installed: false,
      }],
    });

    const installed = await marketplace.installPlugin('docs');
    expect(installed.plugin).toMatchObject({ id: 'docs', name: 'Docs Helper', publisher: 'Setsuna' });
    await expect(marketplace.listPlugins()).resolves.toMatchObject({
      plugins: [{ id: 'docs', installed: true, installedVersion: '1.0.0' }],
    });
  });

  it('reports invalid bundled entries independently and rejects unknown ids', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-marketplace-invalid-'));
    const catalogDir = path.join(root, 'catalog');
    await createCatalogPlugin(catalogDir, 'valid', { name: 'Valid Plugin' });
    await mkdir(path.join(catalogDir, 'broken'), { recursive: true });
    const runtime = await createPluginRuntime(root);
    const marketplace = new FilePluginMarketplace(catalogDir, runtime.plugins);

    const catalog = await marketplace.listPlugins();
    expect(catalog.plugins).toHaveLength(1);
    expect(catalog.errors).toEqual([expect.stringContaining('broken: Plugin manifest not found')]);
    await expect(marketplace.installPlugin('missing')).rejects.toThrow('Marketplace plugin not found');
  });
});

async function createPluginRuntime(root: string) {
  const dataDir = path.join(root, 'runtime');
  const builtinDir = path.join(root, 'builtin-skills');
  await mkdir(builtinDir, { recursive: true });
  const skills = new FileSkillRegistry(builtinDir, dataDir);
  const mcp = new FileMcpStore(dataDir, new InMemoryDesktopNativeBridge());
  const config = new FileConfigStore(dataDir);
  const plugins = new FilePluginBundleStore(
    dataDir,
    skills,
    mcp,
    { invalidateServer: vi.fn(async () => undefined) },
    config,
    systemClock,
  );
  return { plugins };
}

async function createCatalogPlugin(
  catalogDir: string,
  id: string,
  metadata: { name: string; publisher?: string; tags?: string[]; featured?: boolean },
): Promise<void> {
  const manifestDir = path.join(catalogDir, id, '.setsuna-plugin');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(manifestDir, 'plugin.json'), JSON.stringify({
    schemaVersion: 1,
    id,
    name: metadata.name,
    version: '1.0.0',
    publisher: metadata.publisher,
    tags: metadata.tags,
    featured: metadata.featured,
  }, null, 2));
}
