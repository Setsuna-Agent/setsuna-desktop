import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type BundledManifest = {
  id?: unknown;
  schemaVersion?: unknown;
  extension?: unknown;
};

describe('bundled plugin manifests', () => {
  it('uses Bundle v2 for every plugin shipped with the application', async () => {
    const pluginsRoot = path.resolve('plugins');
    const entries = await readdir(pluginsRoot, { withFileTypes: true });
    const manifests = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        directory: entry.name,
        manifest: JSON.parse(await readFile(
          path.join(pluginsRoot, entry.name, '.setsuna-plugin', 'plugin.json'),
          'utf8',
        )) as BundledManifest,
      })));

    const invalid = manifests.filter(({ directory, manifest }) => (
      manifest.id !== directory || manifest.schemaVersion !== 2
    ));
    expect(invalid).toEqual([]);
    expect(manifests.some(({ manifest }) => manifest.extension === undefined)).toBe(true);
    expect(manifests.some(({ manifest }) => manifest.extension !== undefined)).toBe(true);
  });
});
