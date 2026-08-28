// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateBuiltinRendererFeatures } from '../../../src/composition/renderer-feature-composition.js';

describe('renderer feature composition', () => {
  afterEach(() => {
    Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
  });

  it('activates the built-in feature graph with the desktop host bridges', async () => {
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
          request: vi.fn(),
          startSse: vi.fn(() => vi.fn()),
          uploadAttachment: vi.fn(),
        },
      },
    });

    const features = await activateBuiltinRendererFeatures();

    expect(features.mcp.getSnapshot()).toBeNull();
    expect(features.skills.getSnapshot()).toEqual({ extraRoots: [], skills: [] });
    expect(features.networkProxy.available).toBe(false);
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
      expect(features.views.toolResults.resolve(
        persistedResult,
        { toolName: 'extension_publish_lookalike' },
      )).toBeNull();
      expect(features.views.toolResults.resolve(
        persistedResult,
        { toolName: 'publish_artifact' },
      )).toMatchObject({
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
