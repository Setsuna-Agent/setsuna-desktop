import { expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { designDocumentVersion, type DesignDocument, type DesignFrame } from '../../src/contracts/index.js';
import { resolveDesignInsertion } from '../../src/renderer/design-insertion.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';

it('uses an editable artboard in view and prioritizes the frame of the active selection', async () => {
  const frame = { kind: 'frame', x: 0, y: 0, width: 80, height: 100, childIds: [] } satisfies DesignFrame;
  const document: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'insertion', rootIds: ['visible', 'nearby', 'locked'],
    nodes: {
      visible: frame,
      nearby: { ...frame, x: 160, y: 110, childIds: ['tile'] },
      locked: { ...frame, x: 160, locked: true },
      tile: { kind: 'rectangle', x: 5, y: 5, width: 20, height: 20, cornerRadius: 0 },
    },
  };
  const scene = resolveDesignScene(await loadYoga(), document, () => ({ width: 1, height: 1 }));
  const area = { x: 0, y: 0, width: 400, height: 100 };
  expect(resolveDesignInsertion(document, scene, area, null)).toEqual({ parentId: 'visible', center: { x: 40, y: 50 } });
  expect(resolveDesignInsertion(document, scene, area, 'tile')).toEqual({ parentId: 'nearby', center: { x: 200, y: 160 } });
});
