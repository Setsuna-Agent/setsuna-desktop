import { expect, it } from 'vitest';
import { importPencilLayers } from '../../../../src/renderer/import/pencil/document.js';

it('fits single and nested PEN sheets to their clipping frames while preserving intentionally partial overlays', async () => {
  const backdrop = (id: string, y: number, height: number) => ({
    id, name: id, type: 'rectangle', layoutPosition: 'absolute', x: 0, y, width: 200, height, fill: '#00000080',
  });
  const sheet = (id: string, y: number, children: readonly unknown[]) => ({
    id, name: id, type: 'frame', layout: 'vertical', layoutPosition: 'absolute', x: 0, y, width: 200,
    cornerRadius: [12, 12, 0, 0], clip: true, children,
  });
  const content = (id: string, height: number) => ({ id, type: 'rectangle', width: 200, height });
  const { nodes } = await importPencilLayers(JSON.stringify({ version: '2.22', children: [
    { id: 'screen', name: 'screen', type: 'frame', width: 200, layout: 'vertical', clip: true, children: [
      content('body', 260), content('footer', 40),
      backdrop('overlay', 0, 275), sheet('sheet', 215, [
        content('sheet-body', 80), backdrop('nested-overlay', -215, 490), sheet('nested-sheet', 50, [content('nested-body', 40)]),
      ]),
      backdrop('partial-overlay', 0, 100), sheet('partial-sheet', 60, [content('partial-body', 30)]),
    ] },
    { id: 'fixed-screen', type: 'frame', width: 200, height: 300, layout: 'vertical', clip: true, children: [
      backdrop('fixed-overlay', 0, 300), sheet('positioned-panel', 160, [content('panel-body', 70)]),
    ] },
  ] }));
  const layer = (name: string) => Object.values(nodes).find((node) => node.name === name);
  expect(layer('overlay')).toMatchObject({ height: 300 });
  expect(layer('sheet')).toMatchObject({ y: 220, heightMode: 'hug' });
  expect(layer('nested-overlay')).toMatchObject({ height: 295 });
  expect(layer('nested-sheet')).toMatchObject({ y: 40 });
  expect(layer('partial-overlay')).toMatchObject({ height: 100 });
  expect(layer('partial-sheet')).toMatchObject({ y: 60 });
  expect(layer('positioned-panel')).toMatchObject({ y: 160 });
});
