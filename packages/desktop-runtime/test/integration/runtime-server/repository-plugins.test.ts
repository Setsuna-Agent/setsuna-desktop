import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createRepositorySourceFixture } from '../../adapters/plugin/support/repository-plugin-fixture.js';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

it('refreshes and installs repository plugins through the authenticated management routes', async () => {
  const source = await createRepositorySourceFixture();
  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith('https://api.github.com/') || url.startsWith('https://codeload.github.com/')
      ? source.fetch(url) : originalFetch(input, init);
  });
  const harness = await createRuntimeServerTestHarness();
  try {
    await harness.runtimeFetch('/v1/features/plugin-management');
    expect(source.fetch).not.toHaveBeenCalled();
    const refreshed = await harness.runtimeFetch('/v1/features/plugin-management/marketplace/refresh', { method: 'POST' });
    expect(refreshed.marketplace).toEqual(expect.arrayContaining([expect.objectContaining({
      id: 'openai-plugins:github', bundleId: 'github', repository: expect.objectContaining({ revision: 'a'.repeat(40) }),
    })]));
    expect(refreshed.marketplace.filter((plugin: { id: string }) => plugin.id.startsWith('openai-plugins:')))
      .toEqual([expect.objectContaining({ id: 'openai-plugins:github' })]);
    const endpoint = '/v1/features/plugin-management/marketplace/openai-plugins%3Agithub';
    const installed = await harness.runtimeFetch(`${endpoint}/install`, { method: 'POST' });
    expect(installed.plugin).toMatchObject({ id: 'github', installationSource: 'repository' });
    expect(installed.plugin.iconImage.light).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(JSON.stringify(installed)).not.toContain(harness.runtimeDataDir);
    await writeFile(path.join(source.source, 'skills/review/SKILL.md'), '---\nname: review\ndescription: Review\n---\nUpdated from repository.\n');
    await source.publish('b'.repeat(40));
    await harness.runtimeFetch('/v1/features/plugin-management/marketplace/refresh', { method: 'POST' });
    const updated = await harness.runtimeFetch(`${endpoint}/update`, { method: 'POST' });
    expect(updated.plugin.repository.revision).toBe('b'.repeat(40));
    const content = await harness.runtimeFetch('/v1/features/plugin-management/installed/github/items/skill/github.review');
    expect(content.files[0].text).toContain('Updated from repository');
    await harness.runtimeFetch('/v1/features/plugin-management/installed/github', { method: 'DELETE' });
  } finally {
    await harness.close();
    fetchSpy.mockRestore();
  }
});
