import { rm } from 'node:fs/promises';
import { parseRuntimePluginUiManifest } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { InstalledPluginRecord } from '../../src/ports/plugin-bundle-store.js';
import { extensionFixture, testManager } from './support/extension-manager-fixture.js';

describe('extension manager activation boundaries', () => {
  it('requires staged and active workers to register exactly the declared tools', async () => {
    const fixture = await extensionFixture();
    const state = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const ui = { handle: vi.fn(async () => null) };
    const manager = testManager(fixture.record, state, ui);

    try {
      await expect(manager.validatePluginActivation(fixture.record)).resolves.toBeUndefined();
      await expect(manager.listStatuses()).resolves.toMatchObject({
        extensions: [{ pluginId: 'worker-demo', state: 'stopped' }],
      });
      await expect(manager.validatePluginActivation({
        ...fixture.record,
        tools: [...(fixture.record.tools ?? []), { name: 'missing-tool' }],
      })).rejects.toThrow('did not register declared tool: missing-tool');
      const undeclaredToolRecord = {
        ...fixture.record,
        tools: fixture.record.tools?.filter((tool) => tool.name !== 'slow'),
      };
      await expect(manager.validatePluginActivation(undeclaredToolRecord))
        .rejects.toThrow('registered undeclared tool: slow');

      const activeManager = testManager(undeclaredToolRecord, state, ui);
      try {
        await expect(activeManager.listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
        await expect(activeManager.listStatuses()).resolves.toMatchObject({
          extensions: [{ pluginId: 'worker-demo', state: 'failed' }],
        });
      } finally {
        await activeManager.shutdown();
      }
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('single-flights concurrent Renderer UI trust checks for one Plugin revision', async () => {
    const fixture = await extensionFixture();
    const rendererUi = parseRuntimePluginUiManifest({
      schemaVersion: 2,
      actions: [],
      contributions: [{
        id: 'release.page',
        slot: 'renderer.plugin.page',
        navigation: { label: 'Release checker' },
        data: { stateKey: 'release.view', scope: 'global' },
        tree: { type: 'text', text: { path: 'summary.label' } },
      }],
    });
    const record: InstalledPluginRecord = {
      ...fixture.record,
      extension: { ...fixture.record.extension!, rendererUi },
    };
    let resolveFirstTrust!: (hash: string | null) => void;
    const firstTrust = new Promise<string | null>((resolve) => {
      resolveFirstTrust = resolve;
    });
    const verifyBundleTrust = vi.fn()
      .mockReturnValueOnce(firstTrust)
      .mockResolvedValue(record.extension!.trustedHash!);
    const state = {
      get: vi.fn(async () => ({ summary: { label: 'Ready' } })),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const manager = testManager(
      record,
      state,
      { handle: vi.fn(async () => null) },
      { verifyBundleTrust },
    );
    const input = {
      pluginId: 'worker-demo',
      context: { contributionId: 'release.page', surface: 'renderer.plugin.page' as const },
    };

    try {
      const reads = [manager.readRendererUiData(input), manager.readRendererUiData(input)];
      await vi.waitFor(() => expect(verifyBundleTrust).toHaveBeenCalledTimes(1));
      resolveFirstTrust(record.extension!.trustedHash!);
      await expect(Promise.all(reads)).resolves.toEqual([
        { data: { summary: { label: 'Ready' } } },
        { data: { summary: { label: 'Ready' } } },
      ]);

      await expect(manager.readRendererUiData(input)).resolves.toEqual({
        data: { summary: { label: 'Ready' } },
      });
      expect(verifyBundleTrust).toHaveBeenCalledTimes(2);
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
