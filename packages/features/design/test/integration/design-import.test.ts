import { expect, it } from 'vitest';
import { WORKSPACE_ENTRY_EXISTS_ERROR_CODE } from '@setsuna-desktop/contracts';
import { createRuntimeServerTestHarness } from '../../../../desktop-runtime/test/support/runtime-server/harness.js';
import type { DesignSnapshot } from '../../src/contracts/index.js';
import { designImportSource } from '../../src/renderer/import/design-import.js';

it('saves PEN layers as an editable draft without activating linked content or overwriting a previous import', async () => {
  const source = `// A Pencil design draft\n${JSON.stringify({
    version: '2.25', fileToken: 'source-file-token',
    themes: { mode: ['light', 'dark'] },
    variables: { label: { type: 'string', value: [{ value: 'Draft', theme: { mode: 'light' } }, { value: 'Night', theme: { mode: 'dark' } }] } },
    children: [
      { type: 'frame', id: 'board', layout: 'vertical', width: 320, theme: { mode: 'dark' }, children: [
        { type: 'ref', id: 'instance', ref: 'cards', width: 'fill_container(120)', descendants: { title: { content: '$label' } } },
        { type: 'ref', id: 'wide-instance', ref: 'cards', variant: { size: 'wide' }, theme: { mode: 'light' } },
        { type: 'browser', id: 'web', width: 240, height: 160, url: 'https://example.test/private-preview' },
        { type: 'script', id: 'script', width: 160, height: 120, scriptUri: './private-canvas.js' },
      ] },
      { type: 'variants', id: 'cards', reusable: { size: ['compact', 'wide'] }, children: [
        { type: 'ref', id: 'wide', ref: 'wide-cards', reusable: { size: 'wide' }, descendants: { 'wide-title': { content: '$label' } } },
        { type: 'frame', id: 'card', reusable: { size: 'compact' }, width: 160,
          children: [{ type: 'text', id: 'title', content: 'Component title' }] },
      ] },
      { type: 'variants', id: 'wide-cards', children: [
        { type: 'frame', id: 'wide-card', reusable: true, width: 280,
          children: [{ type: 'text', id: 'wide-title', content: 'Wide card title' }] },
      ] },
    ],
  })}\n/* End of draft */`;
  const imported = designImportSource(new File([source], 'Imported.pen'));
  if (!imported) throw new Error('Expected a supported design file.');
  const initialLayers = await imported.read();
  const harness = await createRuntimeServerTestHarness();
  const route = '/v1/features/design/documents';
  const destination = { storageId: 'local', parentPath: '.', name: 'Imported.design.json', initialLayers };
  const post = (path: string, input: unknown) => harness.runtimeFetch(path, { method: 'POST', body: JSON.stringify(input) });
  try {
    await post(route, destination);
    const ref = { storageId: 'local', path: destination.name };
    const read = (): Promise<DesignSnapshot> => harness.runtimeFetch(route + '?' + new URLSearchParams(ref));
    const { document, revision } = await read();
    const [boardId, cardsId] = document.rootIds;
    const board = document.nodes[boardId];
    const cards = document.nodes[cardsId];
    if (board.kind !== 'frame' || cards.kind !== 'frame') throw new Error('Expected two frames.');
    const card = document.nodes[cards.childIds[1]];
    const [instanceId, wideId, webId, scriptId] = board.childIds;
    const instance = document.nodes[instanceId];
    const wide = document.nodes[wideId];
    if (instance.kind !== 'frame' || wide.kind !== 'frame' || card.kind !== 'frame') {
      throw new Error('Expected editable layers for the imported variants.');
    }
    const [textId] = instance.childIds;
    expect(instance.widthMode).toBe('fill');
    expect(document.nodes[textId]).toMatchObject({ kind: 'text', text: 'Night' });
    expect(wide.width).toBe(280);
    expect(document.nodes[wide.childIds[0]]).toMatchObject({ kind: 'text', text: 'Draft' });
    expect(document.nodes[card.childIds[0]]).toMatchObject({ kind: 'text', text: 'Component title' });
    expect(document.nodes[webId]).toMatchObject({ kind: 'web' });
    expect(document.nodes[scriptId]).toMatchObject({ kind: 'script' });
    expect(JSON.stringify(document)).not.toMatch(/private-preview|private-canvas\.js|source-file-token/u);

    await post(route + '/edits', { ref, expectedRevision: revision, edits: [{ kind: 'updateText', nodeId: textId, text: 'Edited' }] });
    await expect(post(route, destination)).rejects.toThrow(WORKSPACE_ENTRY_EXISTS_ERROR_CODE);
    expect((await read()).document.nodes[textId]).toMatchObject({ text: 'Edited' });
  } finally {
    await harness.close();
  }
});
