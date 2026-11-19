// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { designDocumentCodec, type DesignDocumentRef, type DesignFrame, type DesignSnapshot } from '../../src/contracts/index.js';
import type { DesignClient } from '../../src/renderer/client.js';
import { projectDesignComponents, withDesignInstanceContent } from '../../src/renderer/components/design-components.js';
import { useDesignLibraryResources } from '../../src/renderer/components/use-design-library-resources.js';
import type { WatchDesignDirectories } from '../../src/renderer/design-images.js';

afterEach(cleanup);

it('refreshes linked component and style definitions on source changes while preserving instance content in the target', async () => {
  const themePath = 'shared/brand.design.json';
  const libraryPath = 'shared/components.design.json';
  const ref = { projectId: 'project', rootId: 'root', path: 'screen.design.json' } satisfies DesignDocumentRef;
  const theme = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'theme', rootIds: [], nodes: {}, styles: {
    brand: { kind: 'color', name: 'Brand', color: '#113355' },
  } });
  const frame = { kind: 'frame', x: 0, y: 0, width: 120, height: 40, childIds: [] } satisfies DesignFrame;
  const library = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'library', rootIds: ['card'],
    libraries: { theme: themePath }, styles: { label: { kind: 'text', name: 'Label', typography: { fontSize: 16 } } }, nodes: {
      card: { ...frame, component: true, childIds: ['title', 'photo'], fills: [{ color: '#ffffff', styleId: 'theme:brand' }] },
      title: { kind: 'text', x: 8, y: 8, width: 80, fontSize: 16, text: 'Original' },
      photo: { kind: 'image', x: 80, y: 4, width: 32, height: 32, assetPath: 'assets/original.png' },
    },
  });
  const instance = { ...frame, instanceOf: 'library:card' };
  const labeled = withDesignInstanceContent(instance, 'library:title', { kind: 'text', text: 'Local caption' });
  const customized = withDesignInstanceContent(labeled, 'library:photo', { kind: 'image', assetPath: 'assets/local.png' });
  const target = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'screen', libraries: { library: libraryPath },
    rootIds: ['custom', 'default', 'caption'], nodes: { custom: customized, default: instance,
      caption: { ...library.nodes.title, text: 'Caption', textStyleId: 'library:label' },
    },
  });
  const saved = JSON.stringify(target);

  const files = new Map<string, DesignSnapshot>();
  function save(path: string, document: typeof library, revision: string) {
    files.set(path, { document: designDocumentCodec.parse(JSON.parse(JSON.stringify(document))), revision, canUndo: revision !== '0', canRedo: false });
  }
  save(libraryPath, library, '0');
  save(themePath, theme, '0');
  const read = vi.fn<DesignClient['read']>(async ({ projectId, rootId, path }) => {
    if (projectId !== ref.projectId || rootId !== ref.rootId || !files.has(path)) throw new Error('Draft unavailable in this root.');
    return files.get(path)!;
  });
  let changed: (() => void) | undefined;
  const watch: WatchDesignDirectories = (_directories, callback) => {
    changed = callback;
    return () => { changed = undefined; };
  };
  const client = { read };
  const editor = renderHook(() => projectDesignComponents(target, useDesignLibraryResources(client, ref, target, watch)));
  await waitFor(() => expect(editor.result.current.nodes.custom).toMatchObject({ fills: [{ color: '#113355' }] }));

  const updatedTheme = applyDesignEdits(theme, [{ kind: 'setStyle', styleId: 'brand', style: { kind: 'color', name: 'Brand', color: '#126858' } }]);
  const updatedSource = applyDesignEdits(library, [
    { kind: 'update', nodeId: 'card', node: { ...library.nodes.card, width: 170 } },
    { kind: 'reorder', nodeId: 'photo', beforeId: 'title' },
    { kind: 'updateText', nodeId: 'title', text: 'New default' },
    { kind: 'update', nodeId: 'photo', node: { ...library.nodes.photo, assetPath: 'assets/new.png' } },
    { kind: 'setStyle', styleId: 'label', style: { kind: 'text', name: 'Label', typography: { fontSize: 22 } } },
  ]);
  save(themePath, updatedTheme, '1');
  save(libraryPath, updatedSource, '1');
  act(() => changed!());
  await waitFor(() => expect(editor.result.current.nodes.custom).toMatchObject({ width: 170, fills: [{ color: '#126858' }] }));
  const nodes = editor.result.current.nodes;
  expect(nodes['custom/library:title']).toMatchObject({ text: 'Local caption' });
  expect(nodes['custom/library:photo']).toMatchObject({ assetPath: 'assets/local.png' });
  expect(nodes['default/library:title']).toMatchObject({ text: 'New default' });
  expect(nodes['default/library:photo']).toMatchObject({ assetPath: 'assets/new.png' });
  expect(nodes.caption).toMatchObject({ fontSize: 22 });
  expect(JSON.stringify(target)).toBe(saved);

  save(libraryPath, { ...updatedSource, documentId: 'replacement' }, '2');
  act(() => changed!());
  await waitFor(() => expect(editor.result.current.nodes['custom/library:title']).toBeUndefined());
  save(libraryPath, updatedSource, '1');
  act(() => changed!());
  await waitFor(() => expect(editor.result.current.nodes['custom/library:title']).toMatchObject({ text: 'Local caption' }));
});
