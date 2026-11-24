import { expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { designDocumentVersion, type DesignDocument } from '../../../src/contracts/index.js';
import { auditDesignBoard } from '../../../src/renderer/agent/design-board-audit.js';
import { resolveDesignScene } from '../../../src/renderer/design-layout.js';

it('measures contrast inside a round avatar and leaves text crossing its stroke for review', async () => {
  const yoga = await loadYoga();
  function inspect(x: number, y: number, color: string) {
    const projected: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'avatar', rootIds: ['badge'], nodes: {
      badge: { kind: 'frame', x: 0, y: 0, width: 24, height: 24, cornerRadius: 99, childIds: ['initial'],
        fills: [{ color: '#ffffff' }], strokes: [{ width: 2, alignment: 'inside', color: '#000000' }] },
      initial: { kind: 'text', text: 'A', x, y, width: 8, fontSize: 10, fills: [{ color }] },
    } };
    const scene = resolveDesignScene(yoga, projected, () => ({ width: 8, height: 12 }));
    return auditDesignBoard({ projected, scene }, projected.rootIds, 'current', ['lowContrast']).issues;
  }
  expect(inspect(8, 6, '#000000')).toEqual([]);
  expect(inspect(8, 6, '#ffffff')).toMatchObject([{ kind: 'lowContrast', id: 'initial', ratio: 1 }]);
  expect(inspect(5, 4, '#ffffff')).toMatchObject([{ kind: 'unverifiedContrast', id: 'initial' }]);
});
