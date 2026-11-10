// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateBuiltinRendererFeatures } from '../../../src/composition/renderer-feature-composition.js';
import { chatToolResultResolverSlot } from '@setsuna-desktop/renderer-contracts/chat';

describe('renderer feature composition', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
  });

  it.each([true, false])('activates the built-in feature graph with the desktop host bridges (development: %s)', async (development) => {
    vi.stubEnv('DEV', development);
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
        diagnostics: { getLogDirectory: vi.fn(), openLogDirectory: vi.fn() },
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
    expect(window.setsunaDesktop!.diagnostics.getLogDirectory).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      path: '/v1/features/plugin-management/installed',
    }));

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
    expect(features.rendererPlugins.getSnapshot().resolveChain(chatToolResultResolverSlot, {
      plugin: { id: 'weather-card', name: 'Weather Card' },
      toolName: 'weather_today',
      value: {
        resultKind: 'plugin.ui-card',
        resultMajor: 1,
        payload: {
          id: 'weather.hangzhou.today',
          pluginId: 'weather-card',
          html: '<main>28°C</main>',
          permissions: { network: false, hostActions: [] },
        },
      },
    })).toMatchObject({
      featureId: 'ui-card',
      contribution: { placement: 'assistant-timeline' },
      payload: { id: 'weather.hangzhou.today', pluginId: 'weather-card' },
    });
    await features.composition.dispose();
  });
});
