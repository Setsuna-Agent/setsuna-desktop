// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Util } from 'konva/lib/Util.js';
import { expect, it, vi } from 'vitest';
import { designDocumentVersion } from '../../src/contracts/index.js';
import type { DesignChatBinding } from '../../src/renderer/agent/DesignChatBridge.js';
import { DesignTasks } from '../../src/runtime/design-tasks.js';
import { mountEditor } from './support/mount-design-editor.js';

it('predicts the committed card sizes and independent clipping causes without saving or expanding the selection', async () => {
  const metrics = { save() {}, restore() {}, measureText: (text: string) => ({ width: text.length * 8 }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(metrics as unknown as CanvasRenderingContext2D);
  vi.spyOn(Util, 'isCanvasFarblingActive').mockReturnValue(false);
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'candidate', rootIds: ['board', 'private'], nodes: {
    board: { kind: 'frame', name: 'Board', x: 0, y: 0, width: 300, height: 400, childIds: [],
      layout: { direction: 'vertical', align: 'start', padding: 10, gap: 0 } },
    private: { kind: 'frame', x: 320, y: 0, width: 40, height: 40, childIds: ['outside'] },
    outside: { kind: 'rectangle', x: 50, y: 50, width: 10, height: 10, cornerRadius: 0 },
  } }, undefined, {
    renderChat: (bridge) => { chat = bridge; return null; },
    tasks(service) { return tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service); },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'feature.design.layers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Board' }));
  await act(() => chat.bind('preflight'));
  const signal = new AbortController().signal;
  const call = async (name: Parameters<typeof tasks.execute>[1], args: Record<string, unknown>) =>
    JSON.parse((await tasks.execute('preflight', name, args, signal)).content);
  try {
    await act(async () => {
      const original = await read();
      const insert = { revision: original.revision, action: 'insert', fields: {
        kind: 'frame', name: 'row', widthMode: 'fill', heightMode: 'hug',
        layout: { direction: 'horizontal', align: 'start', padding: 0, gap: 0 }, children: [
          { kind: 'frame', name: 'card.left', widthMode: 'fill', heightMode: 'fill', children: [
            { kind: 'frame', name: 'legend', y: 155, width: 60, height: 80, children: [
              { kind: 'rectangle', name: 'key', y: 10, width: 8, height: 8 },
              { kind: 'text', name: 'label', y: 12, width: 1, fontSize: 12, text: 'M' },
              ...[1, 2].map((n) => ({ kind: 'rectangle', name: 'overflow.' + n, x: 65, y: 1, width: 2, height: 2 })),
            ] },
          ] },
          { kind: 'frame', name: 'card.right', widthMode: 'fill', height: 160, children: [
            { kind: 'frame', name: 'plot', width: 80, height: 20, children: [
              { kind: 'rectangle', name: 'point.1', y: 30, width: 4, height: 4 },
              { kind: 'rectangle', name: 'point.2', y: 32, width: 4, height: 4 },
            ] },
          ] },
        ],
      } };
      const trial = await call('design_edit', { ...insert, dryRun: true });
      expect(trial).toMatchObject({ revision: original.revision, applied: false, validated: true, ids: [],
        layout: { checked: 12, summary: { clipped: 3, fillInHug: 1, textOverflow: 1 } } });
      const card = trial.layout.layers.find((entry: { name: string }) => entry.name === 'card.left');
      expect(card).toMatchObject({ width: 140, height: 160, temporary: true });
      expect(trial.layout.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'fillInHug', id: card.id, axes: ['height'], height: 160 }),
        expect.objectContaining({ kind: 'clipped', clipperId: card.id, affectedCount: 3, path: ['Board', 'row', 'card.left', 'legend'] }),
        expect.objectContaining({ kind: 'clipped', affectedCount: 2, path: ['Board', 'row', 'card.right', 'plot'] }),
        expect.objectContaining({ kind: 'textOverflow', reason: 'glyphOverflow', path: ['Board', 'row', 'card.left', 'legend', 'label'] }),
      ]));
      expect(await read()).toEqual(original);
      await expect(call('design_inspect', { ids: [card.id] })).rejects.toThrow('Unknown layer');
      const saved = await call('design_edit', insert);
      for (const layer of trial.layout.layers) {
        expect(saved.inserted).toContainEqual(expect.objectContaining({ name: layer.name, bounds: layer.bounds }));
      }
      const audit = await call('design_inspect', { mode: 'audit', ids: ['board'], checks: ['outOfBounds', 'textOverflow', 'fillInHug'] });
      expect(audit.summary).toEqual(trial.layout.summary);
      expect(audit.issues.map((issue: { path: string[] }) => issue.path)).toEqual(trial.layout.issues.map((issue: { path: string[] }) => issue.path));
      // The legend is clipped by the card and independently clips two markers on its right.
      const legend = saved.inserted.find((layer: { name: string }) => layer.name === 'legend');
      const branch = await call('design_inspect', { mode: 'audit', ids: [legend.id], checks: ['outOfBounds'] });
      expect(branch.issues).toHaveLength(2);
      expect(branch.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: legend.id, affectedCount: 3 }),
        expect.objectContaining({ id: legend.id, clipperId: legend.id, affectedCount: 2 }),
      ]));
      await expect(call('design_edit', { ...insert, dryRun: true })).rejects.toThrow('REVISION_CONFLICT');
      expect((await read()).revision).toBe(saved.revision);
    });
  } finally { await act(() => chat.release()); }
});

it('creates peer boards from a nested selection and promotes an existing board in one undoable edit', async () => {
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const frame = { kind: 'frame', x: 0, y: 0, width: 390, height: 844 } as const;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'responsive', rootIds: ['desktop'], nodes: {
    desktop: { ...frame, x: 100, y: 200, width: 1440, height: 960, childIds: ['section'] },
    section: { ...frame, x: 20, y: 30, childIds: ['phone'] },
    phone: { ...frame, y: 1040, childIds: ['menu'] },
    menu: { kind: 'rectangle', x: 8, y: 12, width: 24, height: 24, cornerRadius: 0 },
  } }, undefined, {
    renderChat: (binding) => { chat = binding; return null; },
    tasks(service) { return tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service); },
  });
  await screen.findByRole('region', { name: 'feature.design.canvas' });
  await act(() => chat.bind('responsive', ['section']));
  const signal = new AbortController().signal;
  const edit = async (args: Record<string, unknown>) => JSON.parse((await tasks.execute('responsive', 'design_edit', args, signal)).content);
  const beforePromotion = await act(async () => {
    try {
      const original = await read();
      const insert = { action: 'insert', revision: original.revision, ids: [], fields: {
        ...frame, name: 'Tablet', x: 1600, width: 768, children: [{ kind: 'rectangle', name: 'Header' }],
      } };
      const trial = await edit({ ...insert, dryRun: true });
      expect(trial).toMatchObject({ applied: false, validated: true, layout: {
        layers: expect.arrayContaining([expect.objectContaining({ name: 'Tablet', parentId: null, temporary: true })]),
      } });
      expect(await read()).toEqual(original);
      const created = await edit(insert);
      const [tablet] = created.ids;
      const header = created.inserted.find((layer: { parentId: string | null }) => layer.parentId === tablet);
      expect((await read()).document.rootIds).toEqual(['desktop', tablet]);
      const updated = await edit({ action: 'update', revision: created.revision, ids: [header.id], fields: { width: 360 } });
      const saved = (await read()).document;
      expect(saved.nodes[header.id]).toMatchObject({ width: 360 });
      await expect(edit({ action: 'update', revision: updated.revision, ids: ['desktop'], fields: { name: 'Outside' } })).rejects.toThrow('Select the target');
      await edit({ action: 'reparent', revision: updated.revision, ids: ['phone'], fields: { parentId: null } });
      expect((await read()).document).toMatchObject({ rootIds: ['desktop', tablet, 'phone'], nodes: {
        section: { childIds: [] }, phone: { x: 120, y: 1270, width: 390, height: 844, childIds: ['menu'] }, menu: saved.nodes.menu,
      } });
      return saved;
    } finally { await chat.release(); }
  });
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  await waitFor(() => expect(undo.disabled).toBe(false));
  fireEvent.click(undo);
  await waitFor(async () => expect((await read()).document).toEqual(beforePromotion));
});

it('honors the instance destination in a whole-document task, including when the manual insertion planner falls back to the root', async () => {
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const frame = { kind: 'frame', x: 0, y: 0, width: 100, height: 100, childIds: [] } as const;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'instances', rootIds: ['master', 'small', 'large'], nodes: {
    master: { ...frame, component: true }, small: { ...frame, x: 150, width: 20, height: 20, clip: true },
    large: { ...frame, x: 250, width: 200, height: 200 },
  } }, undefined, { renderChat(binding) { chat = binding; return null; },
    tasks(service) { return tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: vi.fn() }, service); } });
  await screen.findByRole('region', { name: 'feature.design.canvas' });
  await act(() => chat.bind('instances'));
  try {
    await act(async () => {
      const original = await read();
      const insert = (target: string, dryRun = false) => tasks.execute('instances', 'design_edit', {
        action: 'insertInstance', mode: 'master', ids: [target], revision: original.revision, dryRun,
      }, new AbortController().signal);
      for (const dryRun of [true, false]) await expect(insert('small', dryRun)).rejects.toThrow('Component does not fit');
      expect(await read()).toEqual(original);
      const { ids } = JSON.parse((await insert('large')).content);
      const { document } = await read();
      expect(document.nodes.large).toMatchObject({ childIds: ids });
      expect(document.rootIds).toEqual(original.document.rootIds);
    });
  } finally { await act(() => chat.release()); }
});

it('refuses a networked layer anywhere in a restricted batch and a fresh web capture without saving partial edits', async () => {
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const configure = vi.fn();
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'offline', rootIds: ['master'], nodes: {
    master: { kind: 'frame', x: 4000, y: 4000, width: 200, height: 100, childIds: ['page'], component: true },
    page: { kind: 'web', x: 0, y: 0, width: 200, height: 100, url: 'https://example.test/existing' },
  } }, undefined, {
    webPreview: { partition: 'preview', devices: [], configure, capture: vi.fn(), onEscape: () => () => {} },
    renderChat(binding) { chat = binding; return null; },
    tasks(service) { return tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: vi.fn() }, service); },
  });
  await screen.findByRole('region', { name: 'feature.design.canvas' });
  await act(() => chat.bind('offline'));
  const signal = new AbortController().signal;
  try {
    await act(async () => {
      const original = await read();
      const call = (args: Record<string, unknown>, networkAccess = false) =>
        tasks.execute('offline', 'design_edit', { revision: original.revision, ...args }, signal, 'turn', { networkAccess });
      const url = 'https://example.test/next';
      await expect(call({ action: 'insert', ids: [], fields: { kind: 'frame', children: [{ kind: 'rectangle' }, { kind: 'web', url }] } }))
        .rejects.toThrow('Network access');
      await expect(call({ action: 'update', ids: ['page'], fields: { url } })).rejects.toThrow('Network access');
      await expect(call({ action: 'insertInstance', ids: [], mode: 'master' })).rejects.toThrow('Network access');
      await expect(tasks.execute('offline', 'design_preview', { ids: ['page'] }, signal, 'turn', { networkAccess: false }))
        .rejects.toThrow('Network access');
      expect(configure).not.toHaveBeenCalled();
      expect(await read()).toEqual(original);
      await call({ action: 'update', ids: ['page'], fields: { name: 'Embedded report', locked: true } });
      const renamed = await read();
      expect(renamed.document.nodes.page).toMatchObject({ name: 'Embedded report', locked: true, url: 'https://example.test/existing' });
      expect(configure).not.toHaveBeenCalled();
      await call({ revision: renamed.revision, action: 'update', ids: ['page'], fields: { locked: false } });
      await call({ revision: (await read()).revision, action: 'update', ids: ['page'], fields: { url } }, true);
      expect((await read()).document.nodes.page).toMatchObject({ url });
    });
  } finally { await act(() => chat.release()); }
});
