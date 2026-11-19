import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { maxDesignScriptBytes, type DesignDocument, type DesignDocumentRef, type DesignScriptInputs, type DesignSnapshot } from '@setsuna-desktop/feature-design/contracts';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

it('keeps script parameters with the draft and passes only declared inputs into the sandbox', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const source = path.join(harness.runtimeDataDir, 'source');
    const target = path.join(harness.runtimeDataDir, 'target');
    const outside = path.join(harness.runtimeDataDir, 'outside');
    await Promise.all([source, target, outside].map((directory) => mkdir(directory)));
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(input) });
    const from: WorkspaceProject = await post('/v1/projects', { name: 'Source', path: source });
    const to: WorkspaceProject = await post('/v1/projects', { name: 'Target', path: target });
    const documents = '/v1/features/design/documents';
    const ref = { projectId: from.id, path: 'draft.design.json' };
    const script = `/**
      * @input fraction: number = 0.5
      * @input label: string = "Bar"
      * @input tint: color = #2563eb
      * @input tall: boolean = true
      */
      if (typeof process !== 'undefined' || typeof fetch !== 'undefined' || typeof require !== 'undefined') {
        throw new Error('Unexpected host capability');
      }
      if (!Object.isFrozen(canvas.input) || Object.hasOwn(canvas.input, 'unknown')) throw new Error('Unexpected input');
      console.log('Rendering chart', canvas.input.label);
      return [{ kind: 'frame', x: 0, y: 0, width: canvas.width, height: canvas.height, children: [
        { kind: 'rectangle', name: canvas.input.label, x: 12, y: 12, width: canvas.width * canvas.input.fraction,
          height: canvas.input.tall ? 20 : 8, cornerRadius: 3, fills: [{ color: canvas.input.tint }] }
      ] }];`;
    await Promise.all([
      writeFile(path.join(outside, 'bars.js'), script),
      symlink(outside, path.join(source, 'outside'), process.platform === 'win32' ? 'junction' : 'dir'),
      post(documents, { projectId: from.id, parentPath: '.', name: ref.path }),
    ]);
    const importScript = (name: string, source: string): Promise<string> => post('/v1/features/design/scripts', { ref, name, source });
    const replacement = 'return [];';
    const [scriptPath, otherPath] = await Promise.all([importScript('bars.js', script), importScript('bars.js', replacement)]);
    expect([scriptPath, otherPath].sort()).toEqual(['design-assets/bars-2.js', 'design-assets/bars.js']);
    expect(await readFile(path.join(source, scriptPath), 'utf8')).toBe(script);
    expect(await readFile(path.join(source, otherPath), 'utf8')).toBe(replacement);
    await expect(importScript('../bars.js', script)).rejects.toThrow('INVALID_INPUT');
    await expect(importScript('oversized.js', `// ${'图'.repeat(Math.ceil(maxDesignScriptBytes / 3))}`)).rejects.toThrow('INVALID_INPUT');
    const { revision }: DesignSnapshot = await harness.runtimeFetch(`${documents}?${new URLSearchParams(ref)}`);
    const inputs = { fraction: 0.25, label: '新版 "A"\n系列', tint: '#ff770080', tall: false, unknown: 'not declared' };
    await post(`${documents}/edits`, { ref, expectedRevision: revision, edits: [{ kind: 'insert', nodeId: 'chart', parentId: null,
      node: { kind: 'script', scriptPath, scriptInputs: inputs, x: 0, y: 0, width: 180, height: 80 } }] });

    const render = (address: DesignDocumentRef, scriptPath: string, inputs?: DesignScriptInputs) =>
      post('/v1/features/design/scripts/render', { ref: address, scriptPath, width: 180, height: 80, inputs });
    await expect(render(ref, otherPath)).resolves.toMatchObject({ rootIds: [], nodes: {} });
    const drawing: DesignDocument = await render(ref, scriptPath);
    expect(drawing.nodes[drawing.rootIds[0]]).toMatchObject({ kind: 'frame', width: 180, height: 80, childIds: ['layer-2'] });
    expect(drawing.nodes['layer-2']).toMatchObject({ kind: 'rectangle', name: 'Bar', width: 90 });
    const customized: DesignDocument = await render(ref, scriptPath, inputs);
    expect(customized.nodes['layer-2']).toMatchObject({ name: inputs.label, width: 45, height: 8, fills: [{ color: inputs.tint }] });
    await expect(render(ref, scriptPath, { fraction: 'old type' })).resolves.toEqual(drawing);
    await expect(render(ref, scriptPath, { fraction: -1 })).rejects.toThrow('DESIGN_SCRIPT_FAILED');
    const parameters = (scriptPath: string) => harness.runtimeFetch(`/v1/features/design/scripts/parameters?${new URLSearchParams({ ...ref, scriptPath })}`);
    await expect(parameters(scriptPath)).resolves.toEqual([
      { name: 'fraction', type: 'number', defaultValue: 0.5 }, { name: 'label', type: 'string', defaultValue: 'Bar' },
      { name: 'tint', type: 'color', defaultValue: '#2563eb' }, { name: 'tall', type: 'boolean', defaultValue: true },
    ]);
    await expect(parameters('outside/bars.js')).rejects.toThrow('DESIGN_SCRIPT_FAILED');
    await expect(render(ref, 'outside/bars.js')).rejects.toThrow('DESIGN_SCRIPT_FAILED');
    await expect(render(ref, '../outside/bars.js')).rejects.toThrow('INVALID_INPUT');

    const moved: DesignDocumentRef = await post(`${documents}/move`, { ref, destination: { projectId: to.id } });
    expect(await readFile(path.join(target, scriptPath), 'utf8')).toBe(script);
    const reopened: DesignSnapshot = await harness.runtimeFetch(`${documents}?${new URLSearchParams(moved)}`);
    const chart = reopened.document.nodes.chart;
    if (chart.kind !== 'script' || !chart.scriptPath) throw new Error('Expected the moved script layer.');
    expect(chart.scriptInputs).toEqual(inputs);
    await expect(render(moved, chart.scriptPath, chart.scriptInputs)).resolves.toEqual(customized);
  } finally { await harness.close(); }
});
