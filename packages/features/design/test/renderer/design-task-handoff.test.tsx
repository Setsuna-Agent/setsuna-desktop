// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Util } from 'konva/lib/Util.js';
import { expect, it, vi } from 'vitest';
import { chatDesignResult, designDocumentVersion } from '../../src/contracts/index.js';
import { designSelectionMentionText, type DesignSelectionReference } from '../../src/contracts/design-selection-mention.js';
import { createChatDesignTools } from '../../src/runtime/chat-design-tools.js';
import type { DesignChatBinding } from '../../src/renderer/agent/DesignChatBridge.js';
import { projectDesignComponents } from '../../src/renderer/components/design-components.js';
import type { DesignTaskStart } from '../../src/contracts/design-task.js';
import { DesignTasks } from '../../src/runtime/design-tasks.js';
import { drawing, mountEditor } from './support/mount-design-editor.js';

function mockTextMetrics() {
  const metrics = { save() {}, restore() {}, measureText: (text: string) => ({ width: text.length * 8 }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(metrics as unknown as CanvasRenderingContext2D);
  vi.spyOn(Util, 'isCanvasFarblingActive').mockReturnValue(false);
}

it('keeps the selected-layer task and its draft through fullscreen and sidebar navigation, then hands the saved edit back for undo', async () => {
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const preview = vi.fn();
  let binding: DesignTaskStart | undefined;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'handoff', rootIds: ['board'],
    nodes: { board: { kind: 'frame', name: 'Card', x: 0, y: 0, width: 200, height: 100, childIds: [] } } }, undefined, {
    renderChat: (bridge) => { chat = bridge; return <textarea aria-label="Draft" />; },
    tasks(service) {
      tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service);
      return { bindInput: (input) => tasks.bindInput(input), watchCommand: (input, signal) => tasks.watchCommand(input, signal), start: (input, signal) => { binding = input; return tasks.start(input, signal); },
        reply: (reply, signal) => tasks.reply(reply, signal), stop: (id) => tasks.stop(id) };
    },
  });
  const draft = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Draft' });
  fireEvent.change(draft, { target: { value: 'Tighten the spacing' } });
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.layers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Card' }));
  const chatTab = screen.getByRole('button', { name: 'feature.design.chat.tab' });
  fireEvent.click(chatTab);
  fireEvent.keyDown(chatTab, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.chat.maximize' }));
  const restoreChat = screen.getByRole('button', { name: 'feature.design.chat.restore' });
  fireEvent.keyDown(restoreChat, { key: 'Delete' });
  await act(() => chat.bind('turn'));
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  fireEvent.click(restoreChat);
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.layers' }));
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.collapseSidebar' }));
  const canvas = screen.getByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  const start = { button: 0, buttons: 1, pointerId: 1, clientX: 400, clientY: 300 };
  const end = { ...start, clientX: 500, clientY: 360, buttons: 0 };
  fireEvent.keyDown(canvas, { key: 'Delete' });
  fireEvent.keyDown(canvas, { key: 'H', code: 'KeyH', shiftKey: true });
  fireEvent.keyDown(canvas, { key: 'h', code: 'KeyH' });
  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerMove(canvas, { ...start, clientX: 420, clientY: 320 });
  const signal = new AbortController().signal;
  await act(async () => {
    const inspect = await tasks.execute('turn', 'design_inspect', {}, signal);
    const { revision } = JSON.parse(inspect.content);
    await tasks.execute('turn', 'design_edit', { action: 'update', revision, fields: { name: 'Revised card', width: 240 } }, signal);
    preview(await tasks.execute('turn', 'design_preview', {}, signal));
  });
  // The agent's commit occurs between pointer down and up. Keep the user's entire pan.
  fireEvent.pointerUp(canvas, end);
  await waitFor(() => expect(preview).toHaveBeenCalledOnce());
  expect(binding).toMatchObject({ documentId: 'handoff', selection: ['board'] });
  const result = preview.mock.calls[0][0];
  expect(JSON.parse(result.content)).toMatchObject({ bounds: { width: 240, height: 100 } });
  expect(result.attachments[0].url).toMatch(/^data:image\/png;base64,/u);
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.expandSidebar' }));
  expect(screen.getByRole('button', { name: 'Revised card' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.chat.tab' }));
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Draft' }).value).toBe('Tighten the spacing');
  await act(() => chat.release());
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  await waitFor(() => expect(undo.disabled).toBe(false));
  fireEvent.click(undo);
  await waitFor(async () => expect(await read()).toMatchObject({ canUndo: false, document: { nodes: { board: { name: 'Card', width: 200 } } } }));
  fireEvent.keyDown(canvas, { key: 'r' });
  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerUp(canvas, end);
  await waitFor(async () => {
    const { document } = await read();
    expect(document.nodes[document.rootIds[1]]).toMatchObject({ kind: 'rectangle', x: 232, y: 172, width: 100, height: 60 });
  });
});

it('edits only the board picked in main chat and hands the saved edit back for manual undo', async () => {
  const threadId = 'main-chat';
  const turnId = 'design-turn';
  const cancel = vi.fn();
  let tasks!: DesignTasks;
  let launcher!: ReturnType<typeof createChatDesignTools>;
  const board = { kind: 'frame', name: 'Original', x: 0, y: 0, width: 160, height: 100, childIds: [] } as const;
  const editor = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'live', rootIds: ['board', 'copy'],
    nodes: { board, copy: { ...board, x: 200 } } }, undefined, { tasks(service) {
      tasks = new DesignTasks({ resolveOwnedRoot: async () => undefined, cancel }, service);
      launcher = createChatDesignTools({ projectDesigns: vi.fn(), resolveResourceRoot: async (ref) => ref }, service, tasks);
      return tasks;
    } });
  const signal = new AbortController().signal;
  try {
    let pick: DesignSelectionReference | null = null;
    editor.showChatCanvas({ networkAccess: false, connectSelection: (canvas) => canvas.subscribePicks(() => (value) => { pick = value; }) });
    const surface = await screen.findByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
    surface.setPointerCapture = () => undefined;
    drawing.hit = 'board';
    const click = { button: 0, pointerId: 1, clientX: 40, clientY: 40 };
    fireEvent.pointerDown(surface, click);
    fireEvent.pointerUp(surface, click);
    const reference = designSelectionMentionText({ ...pick!, ref: editor.documentRef });
    drawing.hit = 'copy';
    fireEvent.pointerDown(surface, click);
    fireEvent.pointerUp(surface, click);
    const opened = await launcher.execute({ action: 'open', reference }, { threadId, turnId, projectId: editor.documentRef.projectId },
      { writable: true, networkAccess: false }, signal);
    const id = chatDesignResult(opened.data)!.canvasRequestId!;
    editor.showChatCanvas({ request: { threadId, id }, networkAccess: false });
    const undo = await screen.findByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
    await act(async () => {
      const edit = await tasks.execute(threadId, 'design_edit', { action: 'update',
        revision: (await editor.read()).revision, fields: { name: 'Revised' } }, signal, turnId);
      expect(JSON.parse(edit.content)).toMatchObject({ applied: true, refreshed: true });
    });
    expect((await editor.read()).document.nodes).toMatchObject({ board: { name: 'Revised' }, copy: { name: 'Original' } });
    await act(() => tasks.leave(threadId, turnId));
    editor.showChatCanvas({ networkAccess: false });
    await waitFor(() => expect(undo.disabled).toBe(false));
    fireEvent.click(undo);
    await waitFor(async () => expect((await editor.read()).document.nodes.board.name).toBe('Original'));
    expect(cancel).not.toHaveBeenCalled();
  } finally { await tasks.dispose(); }
});

it('binds a canvas reference after the user selects a different board with a similarly named layer', async () => {
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const frame = { kind: 'frame', x: 0, y: 0, width: 100, height: 100 } as const;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  const rail = { kind: 'rectangle', name: 'Active', x: 4, y: 6, width: 2, height: 20, cornerRadius: 0 } as const;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'pick', rootIds: ['a', 'b'], nodes: {
    a: { ...frame, name: 'Left', childIds: ['a-rail'] }, b: { ...frame, name: 'Right', x: 160, childIds: ['b-rail'] },
    'a-rail': rail, 'b-rail': rail,
  } }, undefined, {
    renderChat: (binding) => { chat = binding; return null; },
    tasks(service) { return tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service); },
  });
  const canvas = await screen.findByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  const picked = vi.fn();
  const draftFocus = screen.getByRole('button', { name: 'feature.design.chat.tab' });
  draftFocus.focus();
  const begin = vi.fn(() => picked).mockImplementationOnce(() => { expect(document.activeElement).toBe(draftFocus); return picked; });
  const unsubscribe = chat.subscribePicks!(begin);
  drawing.hit = 'a-rail';
  const click = { button: 0, pointerId: 1, clientX: 40, clientY: 40 };
  fireEvent.pointerDown(canvas, click);
  fireEvent.pointerUp(canvas, click);
  expect(picked).toHaveBeenCalledExactlyOnceWith({ documentId: 'pick', boards: ['a'], ids: ['a-rail'], label: 'Active' });
  const shiftClick = (id: string) => {
    drawing.hit = id;
    fireEvent.pointerDown(canvas, { ...click, shiftKey: true });
    fireEvent.pointerUp(canvas, { ...click, shiftKey: true });
  };
  shiftClick('b-rail');
  expect(picked).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['a-rail', 'b-rail'], boards: ['a', 'b'] }));
  shiftClick('a-rail');
  expect(picked).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['b-rail'] }));
  shiftClick('b-rail');
  expect(picked).toHaveBeenLastCalledWith(null);
  unsubscribe();
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.layers' }));
  expect(chat.subscribePicks).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Right' }));
  await act(() => chat.bind('pick-thread', picked.mock.calls[0][0].ids));
  try {
    await act(() => chat.bind('pick-thread', ['b-rail'], 'queued'));
    await act(async () => {
      const { revision } = await read();
      await tasks.execute('pick-thread', 'design_edit', { action: 'update', revision, fields: { width: 3 } }, new AbortController().signal);
    });
    const { document } = await read();
    expect(document.nodes['a-rail']).toMatchObject({ width: 3 });
    expect(document.nodes['b-rail']).toEqual(rail);
    await act(async () => {
      const { revision } = await read();
      await tasks.execute('pick-thread', 'design_edit', { action: 'update', revision, fields: { width: 5 } },
        new AbortController().signal, 'next-turn', { networkAccess: false, inputClientId: 'queued' });
    });
    expect((await read()).document.nodes).toMatchObject({ 'a-rail': { width: 3 }, 'b-rail': { width: 5 } });
  } finally { await act(() => chat.release()); }
});

it('keeps the design chat live when inspecting a component instance child and then overriding its text', async () => {
  mockTextMetrics();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const frame = { kind: 'frame', x: 0, y: 0, width: 120, height: 80 } as const;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'cards', rootIds: ['card', 'copy'], nodes: {
    card: { ...frame, component: true, childIds: ['label'] },
    label: { kind: 'text', x: 8, y: 8, width: 80, fontSize: 16, text: 'Original' },
    copy: { ...frame, x: 140, instanceOf: 'card', childIds: [] },
  } }, undefined, {
    renderChat: (bridge) => { chat = bridge; return null; },
    tasks(service) { return tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service); },
  });
  await waitFor(() => expect(chat).toBeDefined());
  await act(() => chat.bind('design-chat'));
  const signal = new AbortController().signal;
  try {
    const inspection = await act(async () => JSON.parse((await tasks.execute('design-chat', 'design_inspect',
      { ids: ['label', 'copy/label'] }, signal)).content));
    expect(inspection.layers).toMatchObject([{ id: 'label', projected: false }, { id: 'copy/label', projected: true }]);
    await act(() => tasks.execute('design-chat', 'design_edit', { action: 'override', ids: ['copy'], revision: inspection.revision,
      fields: { path: 'label', text: 'Revised' } }, signal));
    const { document } = await read();
    expect(document.nodes.label).toMatchObject({ text: 'Original' });
    expect(projectDesignComponents(document).nodes['copy/label']).toMatchObject({ text: 'Revised' });
  } finally { await act(() => chat.release()); }
});

it('finds and selects sidebar indicators from a chart selection, then deletes just those layers in one undoable edit', async () => {
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const frame = { kind: 'frame', x: 0, y: 0, width: 200, height: 200 } as const;
  const rect = { kind: 'rectangle', x: 4, y: 8, width: 2, height: 16, cornerRadius: 0 } as const;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'retarget', rootIds: ['chart', 'nav'], nodes: {
    chart: { ...frame, name: 'Trend', childIds: [] }, nav: { ...frame, name: 'Navigation', x: 240, childIds: ['rail1', 'rail2', 'icon'] },
    rail1: { ...rect, name: 'nav.indicator' }, rail2: { ...rect, name: 'nav.indicator', y: 40 }, icon: { ...rect, width: 16 },
  } }, undefined, {
    renderChat: (bridge) => { chat = bridge; return null; },
    tasks(service) { return tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service); },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'feature.design.layers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trend' }));
  await act(() => chat.bind('retarget'));
  const signal = new AbortController().signal;
  const call = async (name: Parameters<typeof tasks.execute>[1], args: Record<string, unknown>) =>
    JSON.parse((await tasks.execute('retarget', name, args, signal)).content);
  const original = await read();
  try {
    await act(async () => {
      const index = await call('design_inspect', { mode: 'index', scope: 'document' });
      expect(index).toMatchObject({ selection: ['chart'], boardCount: 2 });
      const found = await call('design_inspect', { mode: 'index', name: 'nav.indicator' });
      const ids = found.layers.map((layer: { id: string }) => layer.id);
      expect(ids).toEqual(['rail1', 'rail2']);
      await call('design_view', { action: 'select', ids });
      await expect(call('design_view', { action: 'select', ids: ['chart', 'missing'] })).rejects.toThrow();
      expect((await call('design_preview', {})).ids).toEqual(ids);
      expect(await read()).toEqual(original);
      await call('design_edit', { action: 'delete', revision: found.revision });
      const { document } = await read();
      expect(document.nodes.chart).toEqual(original.document.nodes.chart);
      expect(document.nodes.nav).toMatchObject({ childIds: ['icon'] });
      expect(document.nodes.rail1).toBeUndefined();
      expect(document.nodes.rail2).toBeUndefined();
    });
  } finally { await act(() => chat.release()); }
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.undo' }));
  await waitFor(async () => expect((await read()).document).toEqual(original.document));
});

it('atomically inserts board trees, chains a hotspot and styled icon, and hands each undo step back to the editor', async () => {
  mockTextMetrics();
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const copied = vi.fn().mockResolvedValue(undefined);
  let failNextRefresh = true;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'blank', rootIds: [], nodes: {} }, undefined, {
    output: { copyDesignLayers: copied },
    renderChat: (bridge) => { chat = bridge; return null; },
    tasks(service) {
      tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service);
      return { bindInput: (input) => tasks.bindInput(input), watchCommand: (input, signal) => tasks.watchCommand(input, signal), start: (input, signal) => tasks.start(input, signal), stop: (id) => tasks.stop(id), reply(reply, signal) {
        if (failNextRefresh && !reply.result.failed && JSON.parse(reply.result.content || '{}').refreshed) {
          failNextRefresh = false;
          return tasks.reply({ ...reply, result: { failed: true, content: 'Canvas refresh failed.' } }, signal);
        }
        return tasks.reply(reply, signal);
      } };
    },
  });
  await waitFor(() => expect(chat).toBeDefined());
  const thread = 'prototype';
  const signal = new AbortController().signal;
  await act(() => chat.bind(thread));
  await act(async () => {
    const execute = async (name: Parameters<typeof tasks.execute>[1], args: Record<string, unknown>) => (await tasks.execute(thread, name, args, signal)).content;
    const { revision } = JSON.parse(await execute('design_inspect', {}));
    const invalid = { layers: [
      { kind: 'frame', name: 'Orders', layout: { direction: 'vertical', gap: -4 }, children: [
        { kind: 'text', name: 'Badge', text: 'Paid', fontWeight: 650, textAlign: 'middle' },
      ] }, { kind: 'rectangle', name: 'Backdrop', width: -1, strokes: [
        { width: -1, color: 'blue' }, { width: 1, color: '#ffffff', alignment: 'outer' },
      ] },
    ] };
    for (const dryRun of [true, false]) {
      const error = await execute('design_edit', { revision, action: 'insert', dryRun, fields: invalid }).catch((reason: Error) => reason);
      expect(error).toBeInstanceOf(Error);
      expect(JSON.parse((error as Error).message)).toMatchObject({ code: 'INVALID_LAYERS', applied: false, issues: expect.arrayContaining([
        expect.objectContaining({ path: 'fields.layers[0].layout.align', layer: 'Orders', suggestedValue: 'start' }),
        expect.objectContaining({ path: 'fields.layers[0].layout.padding', suggestedValue: 16 }),
        expect.objectContaining({ path: 'fields.layers[0].layout.gap' }),
        expect.objectContaining({ path: 'fields.layers[0].children[0].fontWeight', layer: 'Badge', message: expect.stringMatching(/650.*600/u) }),
        expect.objectContaining({ path: 'fields.layers[0].children[0].textAlign', message: expect.stringContaining('center') }),
        expect.objectContaining({ path: 'fields.layers[1].width', layer: 'Backdrop' }),
        expect.objectContaining({ path: 'fields.layers[1].strokes[0].width' }),
        expect.objectContaining({ path: 'fields.layers[1].strokes[0].color' }),
        expect.objectContaining({ path: 'fields.layers[1].strokes[1].alignment', message: expect.stringContaining('outside') }),
      ]) });
    }
    await expect(execute('design_edit', { revision, action: 'insert', fields: { layers: [], ids: [] } })).rejects.toThrow(/ids outside fields/u);
    await expect(execute('design_edit', { revision, ids: [], action: 'insert', fields: { layers: [
      { kind: 'frame', name: 'First' }, { kind: 'frame', children: [{ kind: 'rectangle', width: -1 }] },
    ] } })).rejects.toThrow('fields.layers[1].children[0]');
    expect(await read()).toMatchObject({ revision, document: { rootIds: [] }, canUndo: false });

    const ink = { color: '#223355', styleId: 'ink' };
    const theme = JSON.parse(await execute('design_edit', { action: 'setStyle', revision,
      fields: { styles: { ink: { kind: 'color', name: 'Text', color: ink.color }, surface: { kind: 'color', name: 'Surface', color: '#ffffff' } } } }));
    expect(theme).toMatchObject({ applied: true, refreshed: false, changes: 2 });
    expect(JSON.parse(await execute('design_resources', { kind: 'styles' })).total).toBe(2);
    const insert = { revision: theme.revision, ids: [], action: 'insert', fields: { layers: [
      { kind: 'frame', name: 'Home', layout: { direction: 'horizontal', align: 'center', justify: 'center', padding: 0, gap: 0 } }, { kind: 'frame', name: 'Detail', x: 1000, children: [
        { kind: 'frame', name: 'Card', layout: { direction: 'vertical', align: 'center', justify: 'center', padding: 0, gap: 0 },
          children: [{ kind: 'text', name: 'label', text: 'Amount', fills: [ink], width: 100, textAlign: 'center' },
          { kind: 'text', name: 'label', text: '¥460.00', fills: [ink] },
          { kind: 'line' }, { kind: 'rectangle', strokes: [{ color: '#345678', width: 2 }] }] },
      ] },
    ] } };
    expect(JSON.parse(await execute('design_edit', { ...insert, dryRun: true }))).toMatchObject({ revision: theme.revision, validated: true, applied: false });
    expect(await read()).toMatchObject({ revision: theme.revision, document: { rootIds: [] } });
    const boards = JSON.parse(await execute('design_edit', insert));
    await expect(execute('design_edit', insert)).rejects.toThrow('"applied":false');
    expect(boards).toMatchObject({ count: 2, changes: 7 });
    const [home, detail] = boards.ids;
    const labels = JSON.parse(await execute('design_inspect', { name: 'label', mode: 'index', ids: [detail] })).layers;
    expect(labels).toHaveLength(2);
    expect(labels[0].bounds.width).toBe(100);
    expect(boards.inserted).toEqual(expect.arrayContaining(labels));
    expect(JSON.parse(await execute('design_resources', { kind: 'icons', query: 'USER', exact: true })).items).toEqual(['user']);
    const linked = JSON.parse(await execute('design_edit', { revision: boards.revision, ids: [home], action: 'insert',
      fields: { kind: 'text', name: 'Open', text: 'Open', interaction: { kind: 'navigate', targetId: detail } } }));
    const centered = linked.inserted[0].bounds;
    const boardBounds = boards.inserted.find((layer: { id: string }) => layer.id === home).bounds;
    expect(centered.y + centered.height / 2).toBeCloseTo(boardBounds.y + boardBounds.height / 2, 0);
    const hotspot = linked.ids[0];
    const icon = JSON.parse(await execute('design_edit', { revision: linked.revision, ids: [detail], action: 'insertSvg',
      fields: { icons: [{ icon: 'search', x: 12, y: 34, width: 48, strokes: [{ color: '#ff0000', width: 3 }] }, { icon: 'user', x: 60 }] } }));
    const saved = await read();
    expect(saved.revision).toBe(icon.revision);
    expect(saved.document.nodes[icon.ids[0]]).toMatchObject({ kind: 'vector', x: 12, y: 34, width: 48, height: 48,
      strokes: [{ color: '#ff0000', width: 3 }] });
    const card = Object.values(saved.document.nodes).find((layer) => layer.name === 'Card');
    if (card?.kind !== 'frame') throw new Error('Expected the nested card frame.');
    const [title, amount, line, outlined] = card.childIds.map((id) => saved.document.nodes[id]);
    expect([title, amount]).toMatchObject([{ text: 'Amount', widthMode: 'fixed', fills: [ink] }, { text: '¥460.00', widthMode: 'hug', fills: [ink] }]);
    for (const node of [card, saved.document.nodes[home], saved.document.nodes[hotspot], title, amount]) expect(node.strokes ?? []).toEqual([]);
    expect(line.strokes).toMatchObject([{ width: 1 }]);
    expect(outlined.strokes).toMatchObject([{ color: '#345678', width: 2 }]);
    expect(JSON.parse(await execute('design_prototype', { action: 'start', ids: [home] })).hotspots[0].id).toBe(hotspot);
    expect(JSON.parse(await execute('design_prototype', { action: 'click', id: hotspot })).board).toBe(detail);
    expect(JSON.parse(await execute('design_prototype', { action: 'back' })).board).toBe(home);
    await execute('design_export', { action: 'copy', format: 'layers', ids: [home, detail] });
  });
  await act(() => chat.release());
  const saved = (await read()).document;
  expect(saved.nodes[saved.rootIds[0]]).toMatchObject({ kind: 'frame', width: 960, height: 600 });
  const clipboard = JSON.parse(copied.mock.calls[0][0]).document;
  const button = clipboard.nodes[clipboard.nodes[clipboard.rootIds[0]].childIds[0]];
  expect(button).toMatchObject({ name: 'Open', interaction: { kind: 'navigate', targetId: clipboard.rootIds[1] } });
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  for (const count of [8, 7, 0]) {
    await waitFor(() => expect(undo.disabled).toBe(false));
    fireEvent.click(undo);
    await waitFor(async () => expect(Object.keys((await read()).document.nodes)).toHaveLength(count));
  }
});

it('finds a layer beyond the first page and recolors a whole dashboard through one saved variable', async () => {
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'dashboard', rootIds: [], nodes: {} }, undefined, {
    renderChat: (bridge) => { chat = bridge; return null; },
    tasks(service) { return tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service); },
  });
  await waitFor(() => expect(chat).toBeDefined());
  await act(() => chat.bind('dashboard'));
  const signal = new AbortController().signal;
  const call = async (name: Parameters<typeof tasks.execute>[1], args: Record<string, unknown>) =>
    JSON.parse((await tasks.execute('dashboard', name, args, signal)).content);
  const accent = { name: 'Accent', kind: 'color', color: '#4f7cff' };
  const cards = Array.from({ length: 4 }, (_, card) => ({
    kind: 'frame', name: 'kpi.' + card, x: card * 200, clip: card === 0, children: Array.from({ length: card === 3 ? 63 : 62 }, (_, bar) => ({
      kind: 'rectangle', name: 'kpi.' + card + '.bar.' + bar, x: bar === 62 || (card === 0 && bar === 0) ? 300 : bar * 3, width: 2, height: bar + 1, fills: [{ color: accent.color, styleId: 'accent' }],
    })),
  }));
  await act(async () => {
    const initial = await call('design_inspect', {});
    const palette = await call('design_edit', { revision: initial.revision, action: 'setStyle', fields: { styles: { accent } } });
    const board = await call('design_edit', { revision: palette.revision, action: 'insert', fields: { kind: 'frame', name: 'Overview', children: cards } });
    expect(board.inserted).toHaveLength(254);
    const audit = await call('design_inspect', { ids: board.ids, mode: 'audit' });
    expect(audit).toMatchObject({ checked: 254, issueCount: 2, summary: { clipped: 1, outsideParent: 1 }, issues: [
      expect.objectContaining({ kind: 'clipped', path: ['Overview', 'kpi.0', 'kpi.0.bar.0'] }),
      expect.objectContaining({ kind: 'outsideParent', path: ['Overview', 'kpi.3', 'kpi.3.bar.62'] }),
    ] });
    expect(audit.nextOffset).toBeUndefined();
    const lookup = await call('design_inspect', { mode: 'index', name: 'kpi.3.bar.62' });
    expect(lookup.layers).toEqual([board.inserted.at(-1)]);
    const recolor = await call('design_edit', { revision: lookup.revision, action: 'setStyle', fields: {
      styleId: 'accent', style: { ...accent, color: '#3f6be6' },
    } });
    expect(recolor).toMatchObject({ applied: true, changes: 1 });
    const resume = await call('design_inspect', { ids: [], mode: 'index' });
    expect(resume).toMatchObject({ layers: [], scope: 'document', boardCount: 1, rootCount: 1, boards: [{ id: board.ids[0] }],
      lastSaved: { board: { id: board.ids[0] }, section: { name: 'kpi.3' }, layer: { id: lookup.layers[0].id } } });
    const { document } = await read();
    const colors = Object.values(projectDesignComponents(document).nodes).flatMap((layer) => layer.kind === 'rectangle' ? layer.fills?.map((fill) => fill.color) ?? [] : []);
    expect(colors).toHaveLength(249);
    expect(new Set(colors)).toEqual(new Set(['#3f6be6']));
  });
  await act(() => chat.release());
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.audit' }));
  fireEvent.click(await screen.findByRole('button', { name: /outsideParent.*kpi.3.bar.62/u }));
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.layers' }));
  expect(screen.getByRole('button', { name: 'kpi.3.bar.62' }).getAttribute('aria-pressed')).toBe('true');
});

it('updates nested targets, diagnoses the selected board and atomically binds its repairs in undoable steps', async () => {
  mockTextMetrics();
  const rect = { kind: 'rectangle', x: 10, y: 0, width: 20, height: 18, cornerRadius: 0 } as const;
  const text = { kind: 'text', text: 'Amount', fontSize: 12, x: 20, y: 90, width: 80, fills: [{ color: '#98a2b3' }] } as const;
  let chat!: DesignChatBinding;
  let tasks!: DesignTasks;
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'report', rootIds: ['board', 'outside'],
    styles: { ink: { name: 'Ink', kind: 'color', color: '#303030' }, space: { name: 'Spacing', kind: 'number', value: 12 } },
    nodes: {
      board: { kind: 'frame', name: 'Overview', x: 0, y: 0, width: 340, height: 220, fills: [{ color: '#ffffff' }], strokes: [{ color: '#000000', width: 1 }],
        childIds: ['group', 'badge', 'caption', 'overlap', 'covered', 'cover', 'footer', 'strip'] },
      badge: { ...rect, x: 15, y: 83, width: 110, height: 40, fills: [{ color: '#ffffff' }] },
      covered: { ...text, x: 175, y: 90 }, cover: { ...rect, x: 170, y: 85, width: 100, height: 40, fills: [{ color: '#ffffff' }] },
      group: { kind: 'frame', group: true, x: 0, y: 0, width: 100, height: 50, childIds: ['swatch', 'other'] },
      swatch: rect, other: { ...rect, x: 50 }, caption: { ...text, name: 'Caption layer' }, overlap: { ...text, x: 25 }, footer: { ...text, x: 320, y: 215 },
      strip: { kind: 'frame', x: 0, y: 165, width: 170, height: 30, childIds: [],
        layout: { direction: 'horizontal', padding: 0, gap: 4, align: 'start' } },
      outside: { ...rect, x: 400 },
    } }, undefined, {
    renderChat: (bridge) => { chat = bridge; return null; },
    tasks(service) {
      tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service);
      return tasks;
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'feature.design.layers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.expandLayer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Caption layer' }), { metaKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.chat.tab' }));
  await act(() => chat.bind('batch'));
  const signal = new AbortController().signal;
  const call = async (name: Parameters<typeof tasks.execute>[1], args: Record<string, unknown>) =>
    JSON.parse((await tasks.execute('batch', name, args, signal)).content);
  await act(async () => {
    const report = await call('design_inspect', { mode: 'layout' });
    expect(report.total).toBe(11);
    const scoped = await call('design_inspect', { ids: [] });
    expect(scoped.scope).toBe('selection');
    expect(scoped.boards).toBeUndefined();
    expect(scoped.lastSaved).toBeUndefined();
    const audit = await call('design_inspect', { mode: 'audit' });
    expect(audit.issues).toContainEqual(expect.objectContaining({ kind: 'unverifiedContrast', id: 'overlap' }));
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lowContrast', id: 'caption', ratio: expect.closeTo(2.58, 1), minimum: 4.5 }),
      expect.objectContaining({ kind: 'occludedText', id: 'cover', hiddenTextIds: ['covered'] }),
      expect.objectContaining({ kind: 'outOfBounds', id: 'footer', path: ['Overview', 'text (footer)'] }),
      expect.objectContaining({ kind: 'textOverflow', id: 'footer', reason: 'clipped' }),
    ]));
    expect(report.unverifiedContrast).toContain('overlap');
    expect(report.findings.map((row: { kind: string }) => row.kind)).not.toContain('possibleOverlap');
    const overlaps = await call('design_inspect', { mode: 'layout', checks: ['possibleOverlap'], includeExpectedOverlaps: true });
    expect(overlaps.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'possibleOverlap', id: 'overlap', peers: ['caption'] }),
      expect.objectContaining({ kind: 'expectedOverlap', id: 'caption', peers: ['badge'] }),
    ]));
    const selectionEdit = await call('design_edit', { action: 'update', revision: report.revision, fields: { context: 'Selected' } });
    await expect(call('design_inspect', { mode: 'layout', revision: report.revision, offset: 32 })).rejects.toThrow('revision');
    expect(new Set(selectionEdit.ids)).toEqual(new Set(['board', 'caption']));
    expect((await read()).document.nodes).toMatchObject({ board: { context: 'Selected' }, caption: { context: 'Selected' } });
    const updated = await call('design_edit', { action: 'update', ids: ['swatch', 'group'], revision: selectionEdit.revision,
      fields: { width: 200 } });
    expect((await read()).document.nodes).toMatchObject({ group: { width: 200 }, swatch: { x: 20, width: 200 }, other: { x: 100, width: 40 } });

    const bind = (bindings: unknown[]) => call('design_edit', { action: 'bindTokens', revision: updated.revision, fields: { bindings } });
    const fill = { field: 'fills.0.color', tokenId: 'ink', ids: ['group', 'swatch', 'caption'] };
    await expect(bind([fill, { field: 'fontSize', tokenId: 'ink', ids: ['caption'] }])).rejects.toThrow();
    await expect(bind([fill, { field: 'width', tokenId: 'space', ids: ['outside'] }])).rejects.toThrow();
    expect((await read()).revision).toBe(updated.revision);
    const saved = await bind([fill, { field: 'layout.gap', tokenId: 'space', ids: ['strip'] }]);
    expect(await call('design_edit', { revision: saved.revision, action: 'bindTokens', fields: { bindings: [
      fill, { field: 'layout.gap', tokenId: 'space', ids: ['strip'] },
    ] } })).toMatchObject({ revision: saved.revision, changes: 0 });
    const snapshot = await read();
    for (const id of fill.ids) expect(snapshot.document.nodes[id]).toMatchObject({ fills: [{ color: '#303030', styleId: 'ink' }] });
    expect(snapshot.document.nodes.strip).toMatchObject({ layout: { gap: 12, variableIds: { gap: 'space' } } });
    const repaired = await call('design_inspect', { ids: ['caption'], mode: 'layout' });
    expect(repaired).toMatchObject({ revision: saved.revision, total: 1, findings: [], unverifiedContrast: [] });
  });
  await act(() => chat.release());
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  await waitFor(() => expect(undo.disabled).toBe(false));
  fireEvent.click(undo);
  await waitFor(async () => expect((await read()).document.nodes).toMatchObject({ caption: { fills: [{ color: '#98a2b3' }] },
    strip: { layout: { gap: 4 } }, group: { width: 200 }, swatch: { x: 20, width: 200 } }));
  fireEvent.click(undo);
  await waitFor(async () => expect((await read()).document.nodes).toMatchObject({ group: { width: 100 }, swatch: rect, other: { x: 50, width: 20 } }));
});
