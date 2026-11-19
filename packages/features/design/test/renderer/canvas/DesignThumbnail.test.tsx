// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { designDocumentVersion, type DesignDocument } from '../../../src/contracts/index.js';
import { DesignThumbnail, useDesignThumbnails } from '../../../src/renderer/canvas/DesignThumbnail.js';
import type { LoadDesignImage } from '../../../src/renderer/design-images.js';
import { resolveDesignScene } from '../../../src/renderer/design-layout.js';

const renderPng = vi.hoisted(() => vi.fn().mockReturnValue('data:image/png;base64,preview'));
vi.mock('../../../src/renderer/export/export-design-png.js', () => ({ renderDesignPng: renderPng }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('reads images for nearby layers and discards an unfinished preview when the layer panel closes', async () => {
  let intersect!: (id: string) => void;
  vi.stubGlobal('IntersectionObserver', class {
    private readonly elements = new Set<Element>();
    constructor(notify: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
      intersect = (id) => {
        const target = [...this.elements].find((element) => element.getAttribute('data-design-thumbnail') === id);
        if (!target) throw new Error(`No observed thumbnail for ${id}`);
        notify([{ target, isIntersecting: true }]);
      };
    }
    observe(element: Element) { this.elements.add(element); }
    unobserve(element: Element) { this.elements.delete(element); }
    disconnect() { this.elements.clear(); }
  });
  const dimensions = { x: 0, y: 0, width: 80, height: 60 };
  const source: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'test', rootIds: ['board', 'other'], nodes: {
    board: { ...dimensions, kind: 'frame', childIds: ['first', 'second'] },
    first: { ...dimensions, kind: 'image', assetPath: 'first.png' },
    second: { ...dimensions, kind: 'image', assetPath: 'second.png' },
    other: { ...dimensions, kind: 'image', assetPath: 'other.png' },
  } };
  const scene = resolveDesignScene(await loadYoga(), source, () => ({ width: 0, height: 0 }));
  const select = (id: string) => ({ document: source, scene, ids: [id] });
  const image = document.createElement('img');
  let finishFirst!: (image: HTMLImageElement) => void;
  const firstRead = new Promise<HTMLImageElement>((resolve) => { finishFirst = resolve; });
  const loadImage = vi.fn<LoadDesignImage>((path) => path === 'first.png' ? firstRead : Promise.resolve(image));

  function List({ open }: { open: boolean }) {
    const list = useRef<HTMLDivElement>(null);
    const observe = useDesignThumbnails(list, select, loadImage, { open });
    return <div ref={list}>{open && source.rootIds.map((id) => <DesignThumbnail key={id} id={id} observe={observe} />)}</div>;
  }

  const view = render(<List open />);
  try {
    act(() => intersect('board'));
    await waitFor(() => expect(loadImage).toHaveBeenCalledExactlyOnceWith('first.png'));
    view.rerender(<List open={false} />);
    await act(async () => { finishFirst(image); await firstRead; });

    view.rerender(<List open />);
    act(() => intersect('other'));
    await waitFor(() => expect(renderPng).toHaveBeenCalledOnce());
    expect(renderPng.mock.lastCall?.[0]).toMatchObject({ ids: ['other'] });
    expect(loadImage.mock.calls).toEqual([['first.png'], ['other.png']]);
  } finally {
    finishFirst(image);
  }
});
