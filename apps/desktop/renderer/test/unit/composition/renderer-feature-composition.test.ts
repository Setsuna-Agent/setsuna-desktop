// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateBuiltinRendererFeatures } from '../../../src/composition/renderer-feature-composition.js';
import type { RendererSlotInspectionNode } from '../../../src/kernel/renderer-plugins/runtime.js';
import { chatToolResultResolverSlot } from '@setsuna-desktop/renderer-contracts/chat';
import { settingsPageExtensionSlot } from '@setsuna-desktop/renderer-contracts/settings';
import { appReadySlot, shellRouteSlot } from '@setsuna-desktop/renderer-contracts/shell';

describe('renderer feature composition', () => {
  afterEach(() => {
    Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
  });

  it('activates the built-in feature graph with the desktop host bridges', async () => {
    const request = vi.fn(async ({ path }: { path: string }) => {
      if (path === '/v1/features/plugin-management/installed') {
        return { ok: true as const, value: { plugins: [] } };
      }
      throw new Error(`Unexpected Feature operation: ${path}`);
    });
    Object.defineProperty(window, 'setsunaDesktop', {
      configurable: true,
      value: {
        desktop: {
          platform: 'darwin',
          copyImageToClipboard: vi.fn(),
          readImageAsset: vi.fn(),
          revealImageInFolder: vi.fn(),
        },
        links: { openExternal: vi.fn().mockResolvedValue(true) },
        runtime: {
          cancelRequest: vi.fn(),
          linkAttachment: vi.fn(),
          readAttachmentImage: vi.fn(),
          request,
          startSse: vi.fn(() => vi.fn()),
          uploadAttachment: vi.fn(),
        },
      },
    });

    const features = await activateBuiltinRendererFeatures();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      path: '/v1/features/plugin-management/installed',
    }));

    expect(features.services.mcp.getSnapshot()).toBeNull();
    expect(features.services.skills.getSnapshot()).toEqual({ extraRoots: [], skills: [] });
    expect(features.services.networkProxy.available).toBe(false);
    expect(features.services.sideConversation.available).toBe(true);
    const snapshot = features.rendererPlugins.getSnapshot();
    const inspection = snapshot.inspect();
    expect(findSlot(inspection.roots, 'renderer.app.ready')).toMatchObject({
      activeEntryIds: ['app-shell.default'],
    });
    expect(findSlot(inspection.roots, 'renderer.shell.route')).toMatchObject({
      activeEntryIds: ['routes.chat', 'routes.settings', 'routes.capabilities'],
    });
    expect(findSlot(inspection.roots, 'renderer.chat.composer.status')).toMatchObject({
      activeEntryIds: ['goal.composer-status'],
    });
    expect(findSlot(inspection.roots, 'renderer.settings.page')?.activeEntryIds).toContain(
      'settings.general',
    );
    const [appReadyEntry] = snapshot.resolveSingle(appReadySlot).entries;
    if (!appReadyEntry) throw new Error('Expected the built-in app shell entry.');
    const [settingsRouteEntry] = snapshot.resolveKeyed(shellRouteSlot, 'settings', appReadyEntry).entries;
    if (!settingsRouteEntry) throw new Error('Expected the built-in settings route entry.');
    const layoutPreferences = snapshot
      .resolveKeyedEntries(settingsPageExtensionSlot, settingsRouteEntry)
      .find((entry) => entry.metadata.id === 'layout-preferences');
    expect(layoutPreferences?.metadata.targetSectionId).toBe('runtime');
    const artifact = {
      id: 'artifact_legacy',
      kind: 'file' as const,
      name: 'report.pdf',
      projectId: 'project_1',
      workspaceRoot: '/workspace',
      path: 'output/report.pdf',
      mimeType: 'application/pdf',
      size: 128,
    };
    const persistedResults = [
      { artifact },
      { resultKind: 'artifact.file', resultMajor: 1, payload: artifact },
    ];
    for (const persistedResult of persistedResults) {
      expect(features.rendererPlugins.getSnapshot().resolveChain(chatToolResultResolverSlot, {
        value: persistedResult,
        toolName: 'extension_publish_lookalike',
      })).toBeNull();
      expect(features.rendererPlugins.getSnapshot().resolveChain(chatToolResultResolverSlot, {
        value: persistedResult,
        toolName: 'publish_artifact',
      })).toMatchObject({
        featureId: 'artifact',
        contribution: {
          placement: 'assistant-tail',
          resultKind: 'artifact.file',
          sourceToolNames: ['publish_artifact'],
        },
        payload: { path: 'output/report.pdf' },
      });
    }
    await features.composition.dispose();
  });
});

function findSlot(
  nodes: readonly RendererSlotInspectionNode[],
  slotId: string,
): RendererSlotInspectionNode | undefined {
  for (const node of nodes) {
    if (node.slotId === slotId) return node;
    const nested = findSlot(node.children, slotId);
    if (nested) return nested;
  }
  return undefined;
}
