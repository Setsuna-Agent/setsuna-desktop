import { expect, it } from 'vitest';
import { commitDesignEdits, designDocumentCodec, type DesignFrame } from '../../src/contracts/index.js';
import { designInstanceContents, detachDesignInstance, projectDesignComponents, withDesignInstanceContent } from '../../src/renderer/components/design-components.js';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { changeDesignVariant, createDesignVariant, designComponentVariants } from '../../src/renderer/components/design-library.js';
import { buildDesignLibraryResources } from '../../src/renderer/components/design-library-resources.js';

it('keeps nested instances linked until they are detached and rejects edits that break those links', () => {
  const frame = { kind: 'frame', x: 0, y: 0, width: 160, height: 80, childIds: [] } satisfies DesignFrame;
  const authored = designDocumentCodec.parse({
    schemaVersion: 4, documentId: 'main', rootIds: ['label', 'card', 'example'],
    nodes: {
      label: { ...frame, component: true, childIds: ['text'] },
      text: { kind: 'text', x: 8, y: 8, width: 100, fontSize: 16, text: 'Draft' },
      card: { ...frame, component: true, childIds: ['nested'] },
      nested: { ...frame, instanceOf: 'label' },
      example: { ...frame, width: 200, widthMode: 'fixed', instanceOf: 'card' },
    },
  });
  const edited = applyDesignEdits(authored, [{ kind: 'updateText', nodeId: 'text', text: 'Ready' }]);
  const projected = projectDesignComponents(edited);
  const example = projected.nodes.example as DesignFrame;
  const nested = projected.nodes[example.childIds[0]] as DesignFrame;
  expect(projected.nodes[nested.childIds[0]]).toMatchObject({ text: 'Ready' });
  expect(edited.nodes.example).toMatchObject({ childIds: [] });

  expect(() => applyDesignEdits(edited, [{ kind: 'reparent', nodeId: 'example', parentId: 'label', beforeId: null }]))
    .toThrow('Invalid component nesting');
  expect(() => applyDesignEdits(edited, [{ kind: 'remove', nodeId: 'card' }]))
    .toThrow('requires an existing source');

  const detached = applyDesignEdits(edited, [
    ...detachDesignInstance(projected, 'example'), { kind: 'remove', nodeId: 'card' },
    { kind: 'updateText', nodeId: 'text', text: 'Next iteration' },
  ]);
  const reopened = designDocumentCodec.parse(JSON.parse(JSON.stringify(detached)));
  const detachedExample = reopened.nodes.example as DesignFrame;
  const detachedNested = reopened.nodes[detachedExample.childIds[0]] as DesignFrame;
  expect(detachedExample).toMatchObject({ width: 200, instanceOf: undefined });
  expect(detachedNested.instanceOf).toBeUndefined();
  expect(reopened.nodes[detachedNested.childIds[0]]).toMatchObject({ text: 'Ready' });
});

it('switches between source variants in another draft without dropping compatible overrides', () => {
  const frame = { kind: 'frame', x: 0, y: 0, width: 120, height: 40, childIds: [] } satisfies DesignFrame;
  const library = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'brand', rootIds: ['button'], styles: {
    brand: { kind: 'color', name: 'Brand', color: '#6300a0' },
    label: { kind: 'text', name: 'Label', typography: { fontFamily: 'Avenir Next', fontSize: 16, fontWeight: 600 } },
  }, nodes: {
    button: { ...frame, component: true, childIds: ['text'], fills: [{ color: '#ffffff', styleId: 'brand' }] },
    text: { kind: 'text', x: 12, y: 10, width: 96, fontSize: 14, text: 'Save', textStyleId: 'label' },
  } });
  const loading = createDesignVariant(library, 'button', 'Loading', { x: 140, y: 0 })!;
  const withLoading = applyDesignEdits(library, loading.edits);
  const disabled = createDesignVariant(withLoading, loading.id, 'Disabled', { x: 280, y: 0 })!;
  const source = applyDesignEdits(withLoading, disabled.edits);
  const target = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'screen', rootIds: [], nodes: {} });
  const sourceId = 'brand:button';
  const draft = applyDesignEdits(target, [
    { kind: 'linkLibrary', documentId: 'brand', path: 'library.design.json' },
    { kind: 'insert', nodeId: 'instance', parentId: null, node: { ...frame, instanceOf: sourceId } },
  ]);
  const resources = buildDesignLibraryResources(draft.documentId, [source]);
  const [initial, loadingVariant, disabledVariant] = designComponentVariants(draft, sourceId, resources);
  expect([initial.node.variantName, loadingVariant.node.variantName, disabledVariant.node.variantName]).toEqual([undefined, 'Loading', 'Disabled']);
  const withOverride = applyDesignEdits(draft, [{ kind: 'update', nodeId: 'instance', node: withDesignInstanceContent(
    draft.nodes.instance as DesignFrame, initial.node.childIds[0], { kind: 'text', text: 'Publish' },
  ) }]);
  const switched = changeDesignVariant(withOverride, projectDesignComponents(withOverride, resources), 'instance', disabledVariant.id, resources)!;
  const updated = applyDesignEdits(withOverride, [
    { kind: 'update', nodeId: 'instance', node: switched },
  ]);
  const reopened = designDocumentCodec.parse(JSON.parse(JSON.stringify(updated)));
  const projected = projectDesignComponents(reopened, resources);
  expect(reopened.nodes.instance).toMatchObject({ instanceOf: disabledVariant.id, childIds: [] });
  expect(projected.nodes.instance).toMatchObject({ fills: [{ color: '#6300a0' }] });
  expect(designInstanceContents(projected, 'instance')).toMatchObject([
    { node: { text: 'Publish', fontFamily: 'Avenir Next', fontSize: 16, fontWeight: 600 } },
  ]);
  const detached = applyDesignEdits(reopened, detachDesignInstance(projected, 'instance'));
  expect(detached.nodes.instance).toMatchObject({ instanceOf: undefined, fills: [{ color: '#6300a0', styleId: 'brand:brand' }] });
});

it('keeps text and image overrides local to a nested instance through reload, reset and detach', () => {
  const frame = { kind: 'frame', x: 0, y: 0, width: 160, height: 80, childIds: [] } satisfies DesignFrame;
  const title = { kind: 'text', x: 0, y: 0, width: 100, fontSize: 16, text: 'Source title' } as const;
  const authored = designDocumentCodec.parse({
    schemaVersion: 4, documentId: 'overrides', rootIds: ['label', 'card', 'example', 'other'],
    nodes: {
      label: { ...frame, component: true, childIds: ['title', 'photo'] },
      title,
      photo: { kind: 'image', x: 0, y: 20, width: 40, height: 32, assetPath: 'assets/source.png', fit: 'contain' },
      card: { ...frame, component: true, childIds: ['nested'] },
      nested: { ...frame, instanceOf: 'label', contentOverrides: { title: { kind: 'text', text: 'Nested title' } } },
      example: { ...frame, instanceOf: 'card' },
      other: { ...frame, instanceOf: 'card' },
    },
  });
  const instance = authored.nodes.example as DesignFrame;
  const withText = withDesignInstanceContent(instance, 'nested/title', { kind: 'text', text: 'Local title' });
  const updated = applyDesignEdits(authored, [{ kind: 'update', nodeId: 'example',
    node: withDesignInstanceContent(withText, 'nested/photo', { kind: 'image', assetPath: 'assets/local.png' }) }]);
  const reopened = designDocumentCodec.parse(JSON.parse(JSON.stringify(updated)));
  const changedSource = applyDesignEdits(reopened, [{ kind: 'update', nodeId: 'title', node: { ...title, fontSize: 24 } }]);
  const projected = projectDesignComponents(changedSource);
  expect(designInstanceContents(projected, 'example')).toMatchObject([
    { path: 'nested/title', node: { text: 'Local title', fontSize: 24 } },
    { path: 'nested/photo', node: { assetPath: 'assets/local.png', fit: 'contain' } },
  ]);
  expect(projected.nodes['other/nested/title']).toMatchObject({ text: 'Nested title', fontSize: 24 });
  expect(projected.nodes['other/nested/photo']).toMatchObject({ assetPath: 'assets/source.png' });

  const reset = withDesignInstanceContent(reopened.nodes.example as DesignFrame, 'nested/title', undefined);
  const restored = projectDesignComponents(applyDesignEdits(changedSource, [{ kind: 'update', nodeId: 'example', node: reset }]));
  expect(restored.nodes['example/nested/title']).toMatchObject({ text: 'Nested title', fontSize: 24 });
  expect(restored.nodes['example/nested/photo']).toMatchObject({ assetPath: 'assets/local.png' });

  const detached = applyDesignEdits(changedSource, detachDesignInstance(projected, 'example'));
  const root = detached.nodes.example as DesignFrame;
  const child = detached.nodes[root.childIds[0]] as DesignFrame;
  expect(root).toMatchObject({ instanceOf: undefined, contentOverrides: undefined });
  expect(child.childIds.map((id) => detached.nodes[id])).toMatchObject([
    { kind: 'text', text: 'Local title' }, { kind: 'image', assetPath: 'assets/local.png' },
  ]);
  const unsafe = withDesignInstanceContent(instance, 'nested/photo', { kind: 'image', assetPath: '../outside.png' });
  expect(() => commitDesignEdits.input.parse({
    ref: { projectId: 'project', rootId: 'root', path: 'test.design.json' }, expectedRevision: '0',
    edits: [{ kind: 'update', nodeId: 'example', node: unsafe }],
  })).toThrow(/within the project root/u);
});
