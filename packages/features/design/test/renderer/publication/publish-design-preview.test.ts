import { expect, it, vi } from 'vitest';
import paper from 'paper';
import { designDocumentVersion, type DesignDocument, type DesignSnapshot } from '../../../src/contracts/index.js';
import { parseBeginDesignPreview, type DesignPublicationBridge } from '../../../src/contracts/design-publication.js';
import { loadDesignLayoutEngine } from '../../../src/renderer/canvas/design-layout-engine.js';
import type { DesignClient } from '../../../src/renderer/client.js';
import { publishDesignPreview } from '../../../src/renderer/publication/publish-design-preview.js';

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../../../src/renderer/export/export-design-png.js', () => ({ renderDesignPreviewPng: render }));

const ref = { storageId: 'local', path: 'screen.design.json' };
const signal = new AbortController().signal;
const translate = (key: string) => key;
const frame = { kind: 'frame' as const, x: 0, y: 0, width: 300, height: 200 };
const snapshot: DesignSnapshot = {
  revision: '0'.repeat(64), canUndo: false, canRedo: false,
  document: {
    documentId: 'screen', schemaVersion: designDocumentVersion, rootIds: ['overview', 'detail', 'draft'], prototypeStartId: 'detail',
    nodes: {
      overview: { ...frame, name: 'Overview', childIds: ['web'] },
      detail: { ...frame, name: 'Detail', x: 600, childIds: [] },
      draft: { ...frame, name: 'Private draft', hidden: true, childIds: [] },
      web: { kind: 'web', x: 0, y: 0, width: 120, height: 80, url: 'http://127.0.0.1:39999/' },
    },
  },
};

function fixture(saved: DesignSnapshot) {
  const read = vi.fn().mockResolvedValue(saved);
  const fetchWeb = vi.fn();
  const client = {
    read, resolveResourceRoot: vi.fn().mockResolvedValue(ref), renderPreviewScript: vi.fn<DesignClient['renderPreviewScript']>(),
    readShader: vi.fn(), fonts: { list: vi.fn(), read: vi.fn(), import: vi.fn(), remove: vi.fn() },
    assets: { read: vi.fn(), search: vi.fn(), readLinkedImage: vi.fn(), requestClipboardPaste: vi.fn(),
      output: { copyImageToClipboard: vi.fn(), saveImageAs: vi.fn(), saveDesignHtml: vi.fn(), saveDesignSvg: vi.fn(),
        copyDesignLayers: vi.fn(), readDesignLayers: vi.fn(), copyText: vi.fn() },
      webPreview: { partition: 'test', devices: [], configure: fetchWeb, capture: fetchWeb, onEscape: vi.fn() } },
  };
  const published = { id: 'release', designKey: 'test', documentId: saved.document.documentId, revision: saved.revision,
    urls: ['http://127.0.0.1/#test'], access: 'password' as const };
  const bridge = { beginPreview: vi.fn().mockResolvedValue('ticket'), appendPreviewBoard: vi.fn().mockResolvedValue(undefined),
    appendPreviewVariant: vi.fn<DesignPublicationBridge['appendPreviewVariant']>().mockResolvedValue(undefined),
    publishPreview: vi.fn().mockResolvedValue(published), cancelPreview: vi.fn().mockResolvedValue(undefined) };
  return { client, bridge, fetchWeb, published };
}

it('publishes all visible artboards with clipped, artboard-local layer data and keeps web sources private', async () => {
  const saved: DesignSnapshot = { ...snapshot, document: { ...snapshot.document, nodes: {
    ...snapshot.document.nodes,
    overview: { ...frame, name: 'Overview', x: 400, y: 190, rotation: 90, flipX: true, clip: false,
      childIds: ['web', 'clip', 'offboard', 'outsideShader', 'unclipped'] },
    clip: { kind: 'frame', name: 'Clip', x: 10, y: 10, width: 100, height: 50, childIds: ['part', 'hidden', 'clippedScript'] },
    part: { kind: 'rectangle', name: 'Partly visible', x: 80, y: 10, width: 60, height: 20, cornerRadius: 0,
      fills: [{ color: '#123456' }], context: 'private layer context' },
    hidden: { kind: 'rectangle', name: 'Hidden child', x: 5, y: 5, width: 30, height: 30, cornerRadius: 0, hidden: true },
    offboard: { kind: 'image', name: 'Outside artboard', x: 305, y: 0, width: 30, height: 30, assetPath: 'missing.png' },
    outsideShader: { kind: 'rectangle', x: 0, y: 205, width: 30, height: 30, cornerRadius: 0,
      fills: [{ color: '#000000', shader: { assetPath: 'missing.glsl' } }] },
    clippedScript: { kind: 'script', x: 105, y: 5, width: 30, height: 30, scriptPath: 'missing.js' },
    unclipped: { ...frame, x: 320, y: 100, width: 40, height: 40, clip: false, childIds: ['visibleScript'] },
    visibleScript: { kind: 'script', x: -60, y: 0, width: 30, height: 30, scriptPath: 'visible.js' },
  } } };
  const { client, bridge, fetchWeb, published } = fixture(saved);
  client.renderPreviewScript.mockResolvedValue({ sourceRevision: '1'.repeat(64), document: {
    documentId: 'result', schemaVersion: designDocumentVersion, rootIds: [], nodes: {},
  } });
  const layout = await loadDesignLayoutEngine();
  render.mockReset().mockResolvedValue(new Blob(['encoded image'], { type: 'image/png' }));
  const access = { kind: 'password' as const, password: 'local preview' };
  await expect(publishDesignPreview(client, bridge, ref, saved, layout, access, signal, translate)).resolves.toEqual(published);
  const release = parseBeginDesignPreview(bridge.beginPreview.mock.calls[0][0]);
  expect(release).toMatchObject({ access, start: 1 });
  expect(release.boards.map(({ name, width, height }) => ({ name, width, height })))
    .toEqual([{ name: 'Overview', width: 300, height: 200 }, { name: 'Detail', width: 300, height: 200 }]);
  expect(release.boards[0]).toMatchObject({ flipX: true, layers: { bounds: [400, 190, 300, 200], rotation: 90 } });
  const tree = release.boards[0].layers;
  expect(tree.children.map((child) => child.kind)).toEqual(['web', 'frame', 'frame']);
  expect(tree.children[1].children).toHaveLength(1);
  expect(tree.children[1].children[0]).toMatchObject({
    name: 'Partly visible', bounds: [80, 10, 60, 20], fills: ['#123456'],
    outline: expect.arrayContaining([[0.3, 0.1], [0.366667, 0.1], [0.366667, 0.2], [0.3, 0.2]]),
  });
  expect(JSON.stringify(bridge.beginPreview.mock.calls[0][0].boards)).not.toMatch(/127\.0\.0\.1|private layer context|Hidden child|Outside artboard/);
  expect(render.mock.calls.map(([selection, id]) => [selection.ids, id, selection.webImages]))
    .toEqual([[['overview'], 'overview', undefined], [['detail'], 'detail', undefined]]);
  expect(bridge.appendPreviewBoard.mock.calls.map(([, index]) => index)).toEqual([0, 1]);
  expect(fetchWeb).not.toHaveBeenCalled();
  expect(client.assets.read).not.toHaveBeenCalled();
  expect(client.readShader).not.toHaveBeenCalled();
  expect(client.renderPreviewScript).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ scriptPath: 'visible.js' }), signal);
});

it('omits layers outside nested vector masks and preserves the hole in a partially visible layer', async () => {
  const square = { x: 0, y: 0, width: 100, height: 100 };
  const rect = { kind: 'rectangle' as const, ...square, cornerRadius: 0 };
  const vectorMask = (data: string): DesignDocument['nodes'][string] => ({
    ...square, kind: 'vector', geometry: { kind: 'svg', viewBox: square, paths: [{ data, fillRule: 'evenodd' }] },
  });
  const line = (name: string, data: string): DesignDocument['nodes'][string] => ({
    ...square, kind: 'vector', name, strokes: [{ color: '#112233', width: 2 }],
    geometry: { kind: 'svg', viewBox: square, paths: [{ data }] },
  });
  const saved: DesignSnapshot = { ...snapshot, document: { ...snapshot.document, rootIds: ['board'], nodes: {
    board: { ...frame, ...square, x: 300, rotation: 90, flipX: true, maskId: 'triangle', childIds: ['group', 'triangle'] },
    triangle: vectorMask('M0 0H100L0 100Z'),
    group: { ...frame, ...square, cornerRadius: 15, maskId: 'ring', childIds: ['visible', 'outside', 'hole', 'corner', 'outsideLine', 'line', 'ring'] },
    ring: vectorMask('M0 0H100V100H0Z M20 20H40V40H20Z'),
    visible: { ...rect, name: 'Artwork' },
    outside: { ...rect, name: 'Behind triangle', x: 75, y: 75, width: 10, height: 10 },
    hole: { ...rect, name: 'Behind hole', x: 25, y: 25, width: 10, height: 10 },
    corner: { ...rect, name: 'Outside rounded frame', width: 2, height: 2 },
    outsideLine: line('Outside stroke', 'M25 100L100 25'),
    line: line('Visible stroke', 'M5 50H35'),
  } } };
  const { client, bridge } = fixture(saved);
  render.mockReset().mockResolvedValue(new Blob(['png']));
  await publishDesignPreview(client, bridge, ref, saved, await loadDesignLayoutEngine(), { kind: 'link' }, signal, translate);
  const { boards } = parseBeginDesignPreview(bridge.beginPreview.mock.calls[0][0]);
  const children = boards[0].layers.children[0].children;
  expect(children.map((layer) => layer.name)).toEqual(['Artwork', 'Visible stroke']);
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  try {
    const published = scope.PathItem.create(children[0].outlinePath!);
    expect(published.contains(new scope.Point(0.1, 0.1))).toBe(true);
    expect(published.contains(new scope.Point(0.3, 0.3))).toBe(false);
    expect(published.contains(new scope.Point(0.8, 0.8))).toBe(false);
  } finally { scope.remove(); }
});

it('captures each combination that affects an artboard, resolving linked aliases, layout and visibility from the published inputs', async () => {
  const library: DesignSnapshot = { ...snapshot, document: {
    documentId: 'palette-file', schemaVersion: designDocumentVersion, rootIds: [], nodes: {},
    variableCollections: { default: { name: 'Palette', defaultModeName: 'Light', modes: { dark: 'Dark' } } },
    styles: {
      swatch: { kind: 'color', color: '#ffffff', name: 'Canvas', modeValues: { dark: '#101010' } },
      hideBadge: { kind: 'boolean', name: 'Hide badge', value: false, modeValues: { dark: true } },
    },
  } };
  const libraryPath = 'private/palette.design.json';
  const document: DesignDocument = { ...snapshot.document, libraries: { 'palette-file': libraryPath }, rootIds: ['overview', 'detail', 'badgeBoard'],
    variableCollections: { density: { name: 'Density', defaultModeName: 'Regular', modes: { wide: 'Wide' } } },
    styles: {
      surface: { kind: 'color', name: 'Surface', color: '#dddddd', aliasId: 'palette-file:swatch' },
      boardWidth: { kind: 'number', name: 'Board width', value: 300, collectionId: 'density', modeValues: { wide: 440 } },
    },
    nodes: { ...snapshot.document.nodes,
      overview: { ...frame, name: 'Overview', childIds: ['surface', 'badge'], variableIds: { width: 'boardWidth' },
        variableModeIds: { 'palette-file': 'dark' } },
      surface: { kind: 'rectangle', x: 0, y: 0, width: 200, height: 100, cornerRadius: 0, fills: [{ color: '#dddddd', styleId: 'surface' }] },
      badge: { kind: 'rectangle', name: 'Badge', x: 20, y: 20, width: 40, height: 40, cornerRadius: 0,
        variableIds: { hidden: 'palette-file:hideBadge' } },
      badgeBoard: { ...frame, x: 1000, widthMode: 'hug', minWidth: 0,
        layout: { direction: 'horizontal', align: 'start', gap: 0 }, childIds: ['onlyBadge'] },
      onlyBadge: { kind: 'rectangle', x: 0, y: 0, width: 40, height: 40, cornerRadius: 0,
        variableIds: { hidden: 'palette-file:hideBadge' } },
    },
  };
  const saved = { ...snapshot, document };
  const { client, bridge } = fixture(saved);
  client.read.mockImplementation(async ({ path }) => path === libraryPath ? library : saved);
  render.mockReset().mockResolvedValue(new Blob(['encoded image'], { type: 'image/png' }));
  await publishDesignPreview(client, bridge, ref, saved, await loadDesignLayoutEngine(), { kind: 'link' }, signal, translate);

  const { boards, variables } = parseBeginDesignPreview(bridge.beginPreview.mock.calls[0][0]);
  expect(boards[0]).toMatchObject({ width: 300, modes: { initial: [0, 0, 1] }, layers: { children: [{ fills: ['#101010'] }] } });
  expect(boards[1].modes?.axes).toEqual([]);
  const alias = variables?.entries.find(({ name }) => name === 'Surface')?.cells[0].alias;
  expect(variables?.entries[alias!].cells.map(({ value }) => value)).toEqual(['#ffffff', '#101010']);
  expect(JSON.stringify(variables)).not.toContain(libraryPath);
  const variants = bridge.appendPreviewVariant.mock.calls.map(([, board, slot, frame]) => ({ board, slot, frame }));
  expect(variants.filter(({ board }) => board === 0)
    .map(({ board, slot, frame }) => [board, slot, frame.width, frame.layers.children[0].fills[0], frame.layers.children.length]))
    .toEqual([[0, 0, 300, '#ffffff', 2], [0, 2, 440, '#ffffff', 2], [0, 3, 440, '#101010', 1]]);
  expect(variants.find(({ board }) => board === 2)).toMatchObject({ slot: 1, frame: { hidden: true, width: 1, height: 1, layers: { children: [] } } });
  expect(variants[0].frame.layers.children[0].key).toBe(boards[0].layers.children[0].key);
  expect(render.mock.calls.filter(([, id]) => id === 'overview').map(([selection, , size]) => [size.width, selection.document.nodes.surface.fills[0].color]))
    .toEqual([[300, '#101010'], [300, '#ffffff'], [440, '#ffffff'], [440, '#101010']]);
  expect(document.nodes.overview).toMatchObject({ width: 300, variableModeIds: { 'palette-file': 'dark' } });
});

it('rejects mixed script source versions before opening a replacement preview', async () => {
  const script = { kind: 'script' as const, x: 0, y: 0, width: 80, height: 40, scriptPath: 'logo.js' };
  const document: DesignDocument = { ...snapshot.document, nodes: { ...snapshot.document.nodes,
    overview: { ...frame, childIds: ['first-script'] },
    detail: { ...frame, childIds: ['second-script'] },
    'first-script': script, 'second-script': { ...script, width: 160 },
  } };
  delete (document.nodes as Record<string, unknown>).web;
  const saved = { ...snapshot, document };
  const { client, bridge } = fixture(saved);
  const empty: DesignDocument = { documentId: 'result', schemaVersion: designDocumentVersion, rootIds: [], nodes: {} };
  client.renderPreviewScript.mockResolvedValueOnce({ document: empty, sourceRevision: '1'.repeat(64) })
    .mockResolvedValueOnce({ document: empty, sourceRevision: '2'.repeat(64) });
  await expect(publishDesignPreview(client, bridge, ref, saved, await loadDesignLayoutEngine(), { kind: 'link' }, signal, translate))
    .rejects.toThrow('feature.design.publication.changed');
  expect(bridge.beginPreview).not.toHaveBeenCalled();
});
