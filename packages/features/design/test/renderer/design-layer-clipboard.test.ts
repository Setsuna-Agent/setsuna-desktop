// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { designDocumentCodec, resolveDesignStyles, type DesignDocument } from '../../src/contracts/index.js';
import { copyDesignBranches, parseDesignClipboard, pasteDesignBranches } from '../../src/renderer/context/design-layer-clipboard.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';

it('pastes the resolved appearance and reconnects only styles and prototype targets owned by the destination', async () => {
  const ref = { projectId: 'project', path: 'source.design.json' };
  const first = designDocumentCodec.parse({ schemaVersion: 5, documentId: 'source', rootIds: ['button', 'layer-1'],
    styles: { accent: { kind: 'color', name: 'Accent', color: '#aa2244' } }, nodes: {
      button: { kind: 'rectangle', x: 0, y: 0, width: 100, height: 40, cornerRadius: 4,
        fills: [{ color: '#000000', styleId: 'accent' }], interaction: { kind: 'navigate', targetId: 'layer-1' } },
      'layer-1': { kind: 'frame', x: 0, y: 80, width: 200, height: 160, childIds: [] },
    } });
  const other = designDocumentCodec.parse({ ...first, documentId: 'other',
    styles: { accent: { kind: 'color', name: 'Accent', color: '#1122aa' } } });
  const projected = resolveDesignStyles(first);
  const scene = resolveDesignScene(await loadYoga(), projected, () => ({ width: 1, height: 1 }));
  function paste(destination: DesignDocument, path: string, roots = ['button']) {
    const clip = parseDesignClipboard(copyDesignBranches(ref, projected, scene, roots, { x: 0, y: 0 }));
    const { ids, edits } = pasteDesignBranches(clip, destination, { ...ref, path }, { parentId: null, beforeId: null, origin: { x: 120, y: 0 } });
    const saved = designDocumentCodec.parse(JSON.parse(JSON.stringify(applyDesignEdits(destination, edits))));
    return { button: resolveDesignStyles(saved).nodes[ids[0]], ids };
  }
  expect(paste(first, ref.path).button).toMatchObject({ fills: [{ styleId: 'accent' }], interaction: { targetId: 'layer-1' } });
  expect(paste(other, 'other.design.json').button).toMatchObject({ fills: [{ color: '#aa2244', styleId: undefined }], interaction: undefined });
  const linked = paste({ ...other, libraries: { source: ref.path } }, 'other.design.json', ['button', 'layer-1']);
  expect(linked.button).toMatchObject({ fills: [{ color: '#aa2244', styleId: 'source:accent' }], interaction: { targetId: linked.ids[1] } });
});
