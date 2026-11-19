import { expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { designDocumentCodec, type DesignInteraction } from '../../src/contracts/index.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { advanceDesignPrototype, designPrototypeBoards, designPrototypeHotspots, type PrototypeState } from '../../src/renderer/prototype/design-prototype.js';

it('plays a reopened edit flow with an overlay, nested dismissal, navigation and back', async () => {
  const frame = { kind: 'frame', width: 320, height: 480, x: 0, y: 0 };
  const button = { kind: 'rectangle', x: 16, y: 16, width: 64, height: 24, cornerRadius: 0 };
  const document = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'edit-flow', rootIds: ['list', 'edit', 'confirm', 'done'], nodes: {
    list: { ...frame, childIds: ['openEdit'] }, edit: { ...frame, childIds: ['openConfirm', 'save'] },
    confirm: { ...frame, childIds: ['close'] }, done: { ...frame, childIds: ['back', 'hidden'] },
    openEdit: { ...button, interaction: { kind: 'overlay', targetId: 'edit' } },
    openConfirm: { ...button, interaction: { kind: 'overlay', targetId: 'confirm' } },
    save: { ...button, y: 56, interaction: { kind: 'navigate', targetId: 'done' } },
    close: { ...button, interaction: { kind: 'close' } },
    back: { ...button, interaction: { kind: 'back' } },
    hidden: { ...button, hidden: true, interaction: { kind: 'navigate', targetId: 'list' } },
  } });
  const scene = resolveDesignScene(await loadYoga(), document, () => ({ width: 1, height: 1 }));
  const boards = designPrototypeBoards(document, scene);
  let state: PrototypeState = { board: 'list', history: [], overlays: [] };
  const click = (id: string) => {
    const active = state.overlays.at(-1) ?? state.board;
    expect(designPrototypeHotspots(document, scene, active).map((hit) => hit.id)).toContain(id);
    state = advanceDesignPrototype(state, document.nodes[id].interaction as DesignInteraction, boards);
  };
  click('openEdit');
  click('openConfirm');
  expect(state.overlays).toEqual(['edit', 'confirm']);
  click('close');
  expect(state.overlays).toEqual(['edit']);
  click('save');
  expect(state).toEqual({ board: 'done', history: ['list'], overlays: [] });
  expect(designPrototypeHotspots(document, scene, 'done').map((hit) => hit.id)).toEqual(['back']);
  click('back');
  expect(state).toEqual({ board: 'list', history: [], overlays: [] });
  expect(advanceDesignPrototype(state, { kind: 'navigate', targetId: 'deleted' }, boards)).toBe(state);
});

it('keeps an overflowing button interactive only within its board and shape mask', async () => {
  const frame = { kind: 'frame', x: 0, y: 0, width: 160, height: 120 };
  const document = designDocumentCodec.parse({ schemaVersion: 5, documentId: 'masked-flow', rootIds: ['board'], nodes: {
    board: { ...frame, childIds: ['group'] },
    group: { ...frame, x: 220, clip: false, maskId: 'circle', childIds: ['circle', 'button'] },
    circle: { kind: 'ellipse', x: -180, y: 10, width: 50, height: 50 },
    button: { kind: 'rectangle', x: -210, y: 0, width: 100, height: 80, cornerRadius: 0, interaction: { kind: 'back' } },
  } });
  const scene = resolveDesignScene(await loadYoga(), document, () => ({ width: 1, height: 1 }));
  expect(scene.group.visibleBounds).toBeNull();
  expect(designPrototypeHotspots(document, scene, 'board')).toEqual([{ id: 'button', clips: ['board', 'circle'], interaction: { kind: 'back' } }]);
});
