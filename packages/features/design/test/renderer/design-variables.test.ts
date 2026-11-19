import { expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { designDocumentCodec, designDocumentVersion, type DesignFrame } from '../../src/contracts/index.js';
import { createDesignVariableResolver } from '../../src/contracts/design-variable-aliases.js';
import { planDesignVariableMove } from '../../src/contracts/design-variable-collections.js';
import { detachDesignInstance, projectDesignComponents } from '../../src/renderer/components/design-components.js';
import { buildDesignLibraryResources } from '../../src/renderer/components/design-library-resources.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { designExportBounds } from '../../src/renderer/export/design-export-scene.js';
import { renderDesignHtml } from '../../src/renderer/export/export-design-html.js';

it('combines modes from independent collections on each instance board and exports color alpha', async () => {
  const schemaVersion = designDocumentVersion;
  const frame = { kind: 'frame', x: 0, y: 0, width: 140, height: 80, childIds: [] } satisfies DesignFrame;
  const library = designDocumentCodec.parse({
    schemaVersion, documentId: 'library', rootIds: ['button'],
    variableCollections: { appearance: { name: 'Appearance', modes: { dark: 'Dark' } }, density: { name: 'Density', modes: { compact: 'Compact' } } },
    styles: {
      space: { kind: 'number', name: 'Spacing', collectionId: 'density', value: 12, modeValues: { compact: 0 } },
      size: { kind: 'number', name: 'Font size', collectionId: 'density', value: 16, modeValues: { compact: 13 } },
      accent: { kind: 'color', name: 'Accent', collectionId: 'appearance', color: '#e2e9ff', modeValues: { dark: '#29459999' } },
      caption: { kind: 'string', name: 'Caption', collectionId: 'appearance', value: 'Continue', modeValues: { dark: 'Proceed' } },
      hideIcon: { kind: 'boolean', name: 'Hide icon', collectionId: 'appearance', value: false, modeValues: { dark: true } },
      label: { kind: 'text', name: 'Label', typography: { fontSize: 14, variableIds: { fontSize: 'size' } } },
    },
    nodes: {
      button: { ...frame, component: true, childIds: ['caption', 'icon'], fills: [{ color: '#ffffff', opacity: 0.5, styleId: 'accent' }],
        layout: { direction: 'horizontal', gap: 4, padding: 8, align: 'start', variableIds: { gap: 'space', paddingX: 'space' } } },
      caption: { kind: 'text', x: 0, y: 0, width: 80, fontSize: 14, text: 'Fallback',
        textStyleId: 'label', variableIds: { text: 'caption' } },
      icon: { kind: 'ellipse', x: 0, y: 0, width: 16, height: 16, name: 'Leading icon', variableIds: { hidden: 'hideIcon' } },
    },
  });
  const instance = { ...frame, instanceOf: 'library:button' };
  const draft = designDocumentCodec.parse({
    schemaVersion, documentId: 'draft', rootIds: ['defaultBoard', 'darkBoard'],
    libraries: { library: 'library.design.json' },
    nodes: {
      defaultBoard: { ...frame, width: 320, childIds: ['defaultButton'] },
      darkBoard: { ...frame, x: 400, width: 320, childIds: ['darkButton'],
        variableModeIds: { 'library:appearance': 'dark', 'library:density': 'compact' } },
      defaultButton: instance,
      darkButton: { ...instance, contentOverrides: { 'library:caption': { kind: 'text', text: 'Checkout' } } },
    },
  });
  const resources = buildDesignLibraryResources(draft.documentId, [library]);
  const document = projectDesignComponents(draft, resources);
  expect(document.nodes.defaultButton).toMatchObject({ layout: { gap: 12, paddingX: 12 }, fills: [{ color: '#e2e9ff' }] });
  expect(document.nodes.darkButton).toMatchObject({ layout: { gap: 0, paddingX: 0 }, fills: [{ color: '#29459999' }] });
  expect(document.nodes['defaultButton/library:caption']).toMatchObject({ text: 'Continue', fontSize: 16 });
  expect(document.nodes['darkButton/library:caption']).toMatchObject({ text: 'Checkout', fontSize: 13 });

  const scene = resolveDesignScene(await loadYoga(), document, () => ({ width: 75, height: 20 }));
  expect(scene['defaultButton/library:icon'].visible).toBe(true);
  expect(scene['darkButton/library:icon'].visible).toBe(false);
  const selection = { document, scene, ids: ['darkBoard'] };
  const output = renderDesignHtml(selection, designExportBounds(selection)!, new Map(), 'Example', 'html');
  expect(output).toContain('Checkout');
  expect(output).toContain('rgba(41, 69, 153, 0.3)');
  expect(output).not.toContain('Leading icon');

  const detached = applyDesignEdits(draft, detachDesignInstance(document, 'darkButton'));
  const button = projectDesignComponents(detached, resources).nodes.darkButton as DesignFrame;
  expect(button.childIds.map((id) => detached.nodes[id])).toContainEqual(
    expect.objectContaining({ kind: 'text', text: 'Checkout', variableIds: undefined }),
  );
});

it('keeps aliases live across saved mode overrides and linked variable collections', () => {
  const schemaVersion = designDocumentVersion;
  const palette = designDocumentCodec.parse({
    schemaVersion, documentId: 'palette', rootIds: [], nodes: {},
    variableCollections: { default: { modes: { night: 'Night' } } },
    styles: {
      source: { kind: 'color', name: 'Blue', color: '#88bbee', modeValues: { night: '#336699' } },
      accent: { kind: 'color', name: 'Accent', color: '#000000', aliasId: 'source' },
    },
  });
  const frame = { kind: 'frame', x: 0, y: 0, width: 160, height: 90, childIds: [], fills: [{ color: '#000000', styleId: 'surface' }] };
  const authored = designDocumentCodec.parse({
    schemaVersion, documentId: 'draft', rootIds: ['day', 'night', 'muted'],
    libraries: { palette: 'palette.design.json' },
    variableCollections: { default: { modes: { muted: 'Muted' } } },
    nodes: {
      day: frame,
      night: { ...frame, variableModeIds: { palette: 'night' } },
      muted: { ...frame, variableModeIds: { palette: 'night', draft: 'muted' } },
    },
    styles: { source: { kind: 'color', name: 'Muted', color: '#aabbcc' } },
  });
  const next = applyDesignEdits(authored, [{ kind: 'setStyle', styleId: 'surface', style: {
    kind: 'color', name: 'Surface', color: '#f1f1f1', aliasId: 'palette:accent',
    modeValues: { muted: '#eeeeee' }, modeAliasIds: { muted: 'source' },
  } }]);
  const saved = designDocumentCodec.parse(JSON.parse(JSON.stringify(next)));
  const project = (draft: typeof saved) => projectDesignComponents(draft, buildDesignLibraryResources(draft.documentId, [palette])).nodes;
  expect(project(saved)).toMatchObject({
    day: { fills: [{ color: '#88bbee' }] }, night: { fills: [{ color: '#336699' }] }, muted: { fills: [{ color: '#aabbcc' }] },
  });

  const removedMode = applyDesignEdits(saved, [{ kind: 'setVariableCollection', collectionId: 'default', collection: {} }]);
  expect(removedMode.styles?.surface?.kind === 'color' && removedMode.styles.surface.modeAliasIds).toBeUndefined();
  expect(project(removedMode).muted).toMatchObject({ fills: [{ color: '#336699' }] });
  expect(projectDesignComponents(saved).nodes.day).toMatchObject({ fills: [{ color: '#f1f1f1' }] });
});

it('uses individual fallbacks for cyclic aliases and preserves false and zero through references', () => {
  const resolve = createDesignVariableResolver({
    fromOutside: { kind: 'number', name: 'Outside cycle', value: 19, aliasId: 'first' },
    first: { kind: 'number', name: 'First', value: 0, aliasId: 'second' },
    second: { kind: 'number', name: 'Second', value: 6, aliasId: 'first' },
    mismatched: { kind: 'boolean', name: 'Mismatch', value: false, aliasId: 'first' },
    flag: { kind: 'boolean', name: 'Flag', value: true, aliasId: 'mismatched' },
  }, 'draft');
  expect(resolve('fromOutside')).toBe(0);
  expect(resolve('second')).toBe(6);
  expect(resolve('flag')).toBe(false);
});

it('resolves both width limits together and keeps the saved range when a mode crosses them', () => {
  const draft = designDocumentCodec.parse({ schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: ['board'],
    variableCollections: { default: { modes: { wide: 'Wide', crossed: 'Crossed' } } }, styles: {
      minimum: { kind: 'number', name: 'Minimum', value: 30, modeValues: { wide: 160, crossed: 160 } },
      maximum: { kind: 'number', name: 'Maximum', value: 100, modeValues: { wide: 240, crossed: 60 } },
    }, nodes: {
      board: { kind: 'frame', x: 0, y: 0, width: 320, height: 200, childIds: ['tile'] },
      tile: { kind: 'rectangle', x: 0, y: 0, width: 80, height: 30, cornerRadius: 0, minWidth: 20, maxWidth: 75,
        variableIds: { minWidth: 'minimum', maxWidth: 'maximum' } },
    },
  });
  const board = draft.nodes.board as DesignFrame;
  function inMode(mode: string) {
    const next = applyDesignEdits(draft, [{ kind: 'update', nodeId: 'board', node: { ...board, variableModeIds: { draft: mode } } }]);
    return projectDesignComponents(next).nodes.tile;
  }
  expect(inMode('wide')).toMatchObject({ minWidth: 160, maxWidth: 240 });
  expect(inMode('crossed')).toMatchObject({ minWidth: 20, maxWidth: 75, variableIds: { minWidth: 'minimum', maxWidth: 'maximum' } });
});

it('moves a variable without losing its ID, mode overrides, or aliases when destination mode IDs differ', () => {
  const source = { modes: { dark: 'Dark', compact: 'Compact' } };
  const destination = { id: 'theme', collection: { modes: { night: 'Dark', compact: 'Spacious' } } };
  const variable = { kind: 'number', name: 'Radius', value: 8,
    modeValues: { dark: 0, compact: 4 }, modeAliasIds: { compact: 'radiusSmall' } } as const;
  const authored = designDocumentCodec.parse({
    schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: ['board'],
    variableCollections: { default: source, theme: destination.collection },
    styles: { radius: variable, radiusSmall: { kind: 'number', name: 'Small radius', value: 2 } },
    nodes: { board: { kind: 'frame', x: 0, y: 0, width: 160, height: 90, childIds: [],
      cornerRadius: 8, variableIds: { cornerRadius: 'radius' }, variableModeIds: { 'draft:theme': 'night' } } },
  });
  const moved = applyDesignEdits(authored, planDesignVariableMove('radius', variable, source, destination));
  const modes = moved.variableCollections?.theme.modes;
  const added = Object.keys(modes ?? {}).find((id) => modes?.[id] === 'Compact')!;
  expect(modes).toEqual({ night: 'Dark', compact: 'Spacious', [added]: 'Compact' });
  expect(moved.variableCollections?.default).toEqual(source);
  expect(moved.styles?.radius).toMatchObject({ collectionId: 'theme', value: 8,
    modeValues: { night: 0, [added]: 4 }, modeAliasIds: { [added]: 'radiusSmall' } });
  expect(projectDesignComponents(moved).nodes.board).toMatchObject({ cornerRadius: 0, variableIds: { cornerRadius: 'radius' } });
});
