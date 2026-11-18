// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/index.js';
import type { DesignAssets } from '../../src/renderer/client.js';
import { useDesignImageLoader, type WatchDesignDirectories } from '../../src/renderer/design-images.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { designExportBounds, loadExportImages } from '../../src/renderer/export/design-export-scene.js';
import { renderDesignHtml } from '../../src/renderer/export/export-design-html.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('exports replaced bytes before the filesystem notification and refreshes the canvas loader on changes', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(async function (this: HTMLImageElement) {
    Object.defineProperties(this, { naturalWidth: { value: 32 }, naturalHeight: { value: 24 } });
  });
  const ref = { projectId: 'project', path: 'screen.design.json' };
  const assetPath = 'design-assets/photo.png';
  const document: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'screen', rootIds: ['photo'], nodes: {
    photo: { kind: 'image', x: 0, y: 0, width: 32, height: 24, assetPath },
  } };
  let base64 = 'Zmlyc3Q=';
  const read = vi.fn<DesignAssets['read']>(async () => ({ kind: 'image', mimeType: 'image/png', base64 }));
  const assets = { read };
  const unwatch = vi.fn();
  const watch = vi.fn<WatchDesignDirectories>(() => unwatch);
  const scene = resolveDesignScene(await loadYoga(), document, () => ({ width: 0, height: 0 }));
  const selection = { document, scene, ids: document.rootIds };
  const editor = renderHook(() => useDesignImageLoader(assets, ref, document, watch));
  const first = await editor.result.current(assetPath);
  expect(first.src).toBe('data:image/png;base64,Zmlyc3Q=');
  expect(read).toHaveBeenCalledOnce();

  base64 = 'c2Vjb25k';
  const images = await loadExportImages(selection, editor.result.current);
  const html = renderDesignHtml(selection, designExportBounds(selection)!, images, 'Screen', 'html');
  expect(html).toContain('src="data:image/png;base64,c2Vjb25k"');

  base64 = 'dGhpcmQ=';
  const [[directories, changed]] = watch.mock.calls;
  expect(directories).toEqual(['design-assets']);
  act(changed);
  expect((await editor.result.current(assetPath)).src).toBe('data:image/png;base64,dGhpcmQ=');
  editor.unmount();
  expect(unwatch).toHaveBeenCalledOnce();
});
