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

    expect(features.networkProxy.available).toBe(false);
    await features.composition.dispose();
  });
});
