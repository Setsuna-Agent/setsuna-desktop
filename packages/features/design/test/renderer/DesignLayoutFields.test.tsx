// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it } from 'vitest';
import { loadYoga, type Yoga } from 'yoga-layout/load';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designDocumentCodec, type DesignDocument, type DesignEdit } from '../../src/contracts/index.js';
import { DesignLayoutFields, DesignSizeFields } from '../../src/renderer/inspector/DesignLayoutFields.js';
import { projectDesignComponents } from '../../src/renderer/components/design-components.js';
import { changeDesignLayout } from '../../src/renderer/design-canvas-edits.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';

afterEach(cleanup);

const frame = { kind: 'frame', x: 0, y: 0, width: 200, height: 100, childIds: [] } as const;
const rectangle = { kind: 'rectangle', x: 0, y: 0, width: 20, height: 20, cornerRadius: 0 } as const;
const layout = { direction: 'horizontal', padding: 10, gap: 10, align: 'start' } as const;
const t: RendererTranslate = (key, params) => params?.axis ? `${key} ${params.axis}` : key;

async function chooseOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
}

function mountFields(initial: DesignDocument, id: string, yoga: Yoga) {
  let document = initial;
  function project() {
    const projected = projectDesignComponents(document);
    return { projected, scene: resolveDesignScene(yoga, projected, () => ({ width: 1, height: 1 })) };
  }
  function save(edits: readonly DesignEdit[]) {
    document = applyDesignEdits(document, edits);
    view.rerender(panel());
    return Promise.resolve(true);
  }
  function panel() {
    const { projected, scene } = project();
    const node = document.nodes[id];
    const box = scene[id];
    const parent = box.parentId ? projected.nodes[box.parentId] : undefined;
    const fieldEdits: ComponentProps<typeof DesignSizeFields>['fieldEdits'] = {
      onFieldSave: (apply) => save([{ kind: 'update', nodeId: id, node: apply(document.nodes[id]) }]),
      onFieldPreview: () => {},
    };
    const sizes = <DesignSizeFields node={node} projectedNode={projected.nodes[id]} box={box}
      parent={parent?.kind === 'frame' ? parent : undefined} translate={t} disabled={false} fieldEdits={fieldEdits}
      onSave={(next) => save([{ kind: 'update', nodeId: id, node: next }])} />;
    return node.kind === 'frame' && !node.instanceOf ? <DesignLayoutFields frame={node} sizeControls={sizes}
      translate={t} disabled={false} fieldEdits={fieldEdits}
      onLayoutChange={(next) => save(changeDesignLayout(document, scene, id, node, next))} /> : sizes;
  }
  const view = render(panel());
  return { node: () => document.nodes[id], scene: () => project().scene };
}

it('keeps automatic distribution while aligning children and applying independent padding', async () => {
  const document = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'auto', rootIds: ['frame'], nodes: {
    frame: { ...frame, layout, childIds: ['first', 'last'] }, first: rectangle, last: rectangle,
  } });
  const panel = mountFields(document, 'frame', await loadYoga());
  const positions = () => {
    const scene = panel.scene();
    return [scene.first, scene.last].map(({ x, y }) => [x, y]);
  };

  await chooseOption('feature.design.distribution', 'feature.design.justify.space-between');
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.align.bottom' }));
  expect(positions()).toEqual([[10, 70], [170, 70]]);
  await chooseOption('feature.design.distribution', 'feature.design.justify.space-around');
  expect(positions()).toEqual([[42.5, 70], [137.5, 70]]);

  fireEvent.click(screen.getByRole('button', { name: 'feature.design.padding.independent' }));
  const left = screen.getByRole('spinbutton', { name: 'feature.design.padding.left' });
  await act(async () => {
    fireEvent.change(left, { target: { value: '30' } });
    fireEvent.blur(left);
  });
  expect(panel.node()).toMatchObject({ layout: { justify: 'space-around', paddingSides: [10, 10, 10, 30] } });
  expect(positions()).toEqual([[57.5, 70], [142.5, 70]]);

  await chooseOption('feature.design.distribution', 'feature.design.gap.fixed');
  expect(positions()).toEqual([[30, 70], [60, 70]]);
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.layout.free' }));
  expect(positions()).toEqual([[30, 70], [60, 70]]);
});

it('changes the width mode of a linked instance independently of its inherited height', async () => {
  const document = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'sizes', rootIds: ['source', 'parent'], nodes: {
    source: { ...frame, component: true, layout, widthMode: 'hug', heightMode: 'hug', childIds: ['content'] },
    content: { ...rectangle, width: 46, height: 18 },
    parent: { ...frame, layout, childIds: ['instance'] },
    instance: { ...frame, instanceOf: 'source' },
  } });
  const panel = mountFields(document, 'instance', await loadYoga());
  const setWidthMode = (mode: string) => chooseOption(t('feature.design.sizeMode', { axis: t('feature.design.width') }), `feature.design.sizeMode.${mode}`);

  await setWidthMode('fill');
  expect(panel.scene().instance).toMatchObject({ width: 180, height: 38 });
  await setWidthMode('hug');
  expect(panel.scene().instance).toMatchObject({ width: 66, height: 38 });
  await setWidthMode('fill');
  await setWidthMode('fixed');
  expect(panel.node()).toMatchObject({ instanceOf: 'source', widthMode: 'fixed', width: 180 });
  expect(panel.scene().instance).toMatchObject({ width: 180, height: 38 });
});
