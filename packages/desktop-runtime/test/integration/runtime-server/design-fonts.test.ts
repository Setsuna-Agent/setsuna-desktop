import { readFile, rename, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

it('keeps one usable copy of a font after concurrent imports and restart, and removes it by ID', async () => {
  const fontFile = new URL('../../../../renderer-ui/src/assets/fonts/figtree-latin-wght-normal.woff2', import.meta.url);
  const base64 = (await readFile(fontFile)).toString('base64');
  const harness = await createRuntimeServerTestHarness();
  const route = '/v1/features/design/fonts';
  const upload = (base64: string) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify({ base64 }) });
  try {
    await expect(upload('bm90IGEgZm9udA==')).rejects.toThrow('DESIGN_FONT_INVALID');
    await expect(harness.runtimeFetch(route)).resolves.toEqual([]);

    const [first, second] = await Promise.all([upload(base64), upload(base64)]);
    expect(first).toMatchObject({ family: 'Figtree Light', format: 'woff2', minWeight: 300, maxWeight: 900, embeddable: true });
    expect(second).toEqual(first);

    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    await expect(harness.runtimeFetch(route)).resolves.toEqual([first]);
    const query = new URLSearchParams({ id: first.id });
    await expect(harness.runtimeFetch(`${route}?${query}&sessionId=expired&commandId=old`, { method: 'DELETE' }))
      .rejects.toThrow('OPERATION_CANCELLED');
    await expect(harness.runtimeFetch(`${route}/data?${query}`)).resolves.toEqual({ base64 });
    const directory = path.join(harness.runtimeDataDir, 'runtime', 'features', 'design', 'fonts');
    const outside = path.join(harness.runtimeDataDir, 'external-fonts');
    await rename(directory, outside);
    await symlink(outside, directory, 'junction');
    await expect(harness.runtimeFetch(`${route}?${query}`, { method: 'DELETE' })).rejects.toThrow();
    expect(await readFile(path.join(outside, first.id, 'font'), 'base64')).toBe(base64);
    await unlink(directory);
    await rename(outside, directory);
    await harness.runtimeFetch(`${route}?${query}`, { method: 'DELETE' });
    await expect(harness.runtimeFetch(route)).resolves.toEqual([]);
    await expect(harness.runtimeFetch(`${route}/data?${query}`)).rejects.toThrow('DESIGN_FONT_NOT_FOUND');
  } finally { await harness.close(); }
});
