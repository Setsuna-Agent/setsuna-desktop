// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Util } from 'konva/lib/Util.js';
import { expect, it, vi } from 'vitest';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/index.js';
import type { DesignClient } from '../../src/renderer/client.js';
import { drawing, mountEditor } from './support/mount-design-editor.js';

function enterSource(field: HTMLElement, value: string) {
  field.focus();
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

function prototypeWebImage(preview: ReturnType<typeof within>, board: string) {
  const image = preview.getByAltText<HTMLImageElement>(board);
  const svg = new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)), 'image/svg+xml');
  return svg.querySelector('image')?.getAttribute('href');
}

it('loads a saved web address automatically and only reports snapshot failures on manual refresh', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
  const url = 'https://example.test/';
  const configure = vi.fn().mockResolvedValue(true);
  const capture = vi.fn().mockResolvedValue(null);
  await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'saved-web', rootIds: ['board', 'web'], nodes: {
    board: { kind: 'rectangle', x: 0, y: 0, width: 1600, height: 900, cornerRadius: 0 },
    web: { kind: 'web', url, x: 650, y: 400, width: 24, height: 24 },
  } }, undefined, { webPreview: { partition: 'test-preview', devices: [], configure, capture, onEscape: () => () => undefined } });
  const guest = await waitFor(() => {
    const guest = document.querySelector('webview');
    if (!guest) throw new Error('Expected the saved page to start loading.');
    return guest;
  });
  Object.defineProperty(guest, 'getWebContentsId', { value: () => 1 });
  fireEvent(guest, new Event('dom-ready'));
  await waitFor(() => expect(capture).toHaveBeenCalledWith(1));
  expect(configure).toHaveBeenCalledWith(1, { url, device: undefined, interactive: false });
  await waitFor(() => expect(document.querySelector('webview')).toBeNull());
  expect(screen.queryByText('feature.design.webLoadFailed')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'feature.design.reloadWebPreview' }));
  const retry = await waitFor(() => {
    const retry = document.querySelector('webview');
    if (!retry) throw new Error('Expected the manual refresh to start a new capture.');
    return retry;
  });
  Object.defineProperty(retry, 'getWebContentsId', { value: () => 2 });
  fireEvent(retry, new Event('dom-ready'));
  await screen.findByText('feature.design.webLoadFailed');
  expect(capture).toHaveBeenCalledWith(2);
});

it('includes the captured web page in the board prototype and its PNG, SVG and HTML exports', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  const snapshot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1X8AAAAASUVORK5CYII=';
  const saveImageAs = vi.fn().mockResolvedValue({ ok: true, cancelled: false });
  const saveDesignSvg = vi.fn().mockResolvedValue({ ok: true, cancelled: false });
  const saveDesignHtml = vi.fn().mockResolvedValue({ ok: true, cancelled: false });
  const capture = vi.fn().mockResolvedValue(snapshot);
  await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'web-export', rootIds: ['board'], nodes: {
    board: { kind: 'frame', name: 'Dashboard', x: 0, y: 0, width: 360, height: 220, childIds: ['browser'] },
    browser: { kind: 'web', url: 'https://example.test/', x: 20, y: 20, width: 300, height: 170 },
  } }, undefined, {
    webPreview: { partition: 'test-preview', devices: [], configure: vi.fn().mockResolvedValue(true),
      capture, onEscape: () => () => undefined },
    output: { saveImageAs, saveDesignSvg, saveDesignHtml },
  });
  const guest = await waitFor(() => {
    const guest = document.querySelector('webview');
    if (!guest) throw new Error('Expected the web layer to start capturing.');
    return guest;
  });
  Object.defineProperty(guest, 'getWebContentsId', { value: () => 1 });
  fireEvent(guest, new Event('dom-ready'));
  await waitFor(() => expect(drawing.images.get('browser')?.image.src).toBe(snapshot));

  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Dashboard' }));
  await user.click(screen.getByRole('button', { name: 'feature.design.prototype.preview' }));
  const preview = within(await screen.findByRole('dialog', { name: 'feature.design.prototype.preview' }));
  await waitFor(() => expect(prototypeWebImage(preview, 'Dashboard')).toBe(snapshot));
  await user.click(preview.getByRole('button', { name: 'feature.design.close' }));
  await user.click(screen.getByRole('button', { name: 'feature.design.exportLayer' }));
  await waitFor(() => expect(saveImageAs).toHaveBeenCalledOnce());
  expect(drawing.exportedImages.get('browser')?.src).toBe(snapshot);
  await user.click(screen.getByRole('combobox', { name: 'feature.design.exportImageFormat' }));
  await user.click(await screen.findByRole('option', { name: 'SVG' }));
  await user.click(screen.getByRole('button', { name: 'feature.design.exportLayer' }));
  await waitFor(() => expect(saveDesignSvg).toHaveBeenCalledOnce());
  const svg = new DOMParser().parseFromString(saveDesignSvg.mock.calls[0][0].svg, 'image/svg+xml');
  expect(svg.querySelector('image')?.getAttribute('href')).toBe(snapshot);
  await user.click(screen.getByRole('button', { name: 'feature.design.saveHtml' }));
  await waitFor(() => expect(saveDesignHtml).toHaveBeenCalledOnce());
  const html = new DOMParser().parseFromString(saveDesignHtml.mock.calls[0][0].html, 'text/html');
  expect(html.querySelector('img')?.getAttribute('src')).toBe(snapshot);
  expect(capture).toHaveBeenCalledExactlyOnceWith(1);
});

it('keeps the board capture running when opening a prototype overlay with another web page', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  const boardImage = 'data:image/jpeg;base64,Ym9hcmQ=';
  const overlayImage = 'data:image/jpeg;base64,b3ZlcmxheQ==';
  const capture = vi.fn(async (id: number) => id === 1 ? boardImage : overlayImage);
  const frame = { kind: 'frame' as const, x: 0, y: 0, width: 160, height: 120 };
  const web = { kind: 'web' as const, x: 0, y: 0, width: 80, height: 60 };
  await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'prototype-pages', rootIds: ['board', 'overlay'], nodes: {
    board: { ...frame, name: 'Board', childIds: ['mainPage', 'button'] },
    overlay: { ...frame, x: 1000, name: 'Overlay', childIds: ['overlayPage'] },
    mainPage: { ...web, name: 'Main page', url: 'https://example.test/main' },
    overlayPage: { ...web, name: 'Overlay page', url: 'https://example.test/detail' },
    button: { kind: 'rectangle', name: 'Show detail', x: 80, y: 0, width: 60, height: 24, cornerRadius: 0,
      interaction: { kind: 'overlay', targetId: 'overlay' } },
  } }, undefined, { webPreview: { partition: 'test-preview', devices: [], configure: vi.fn().mockResolvedValue(true), capture, onEscape: () => () => undefined } });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'feature.design.prototype.preview' }));
  const preview = within(await screen.findByRole('dialog', { name: 'feature.design.prototype.preview' }));
  const guest = (name: string) => waitFor(() => {
    const element = document.querySelector(`webview[aria-label="${name}"]`);
    if (!element) throw new Error(`Waiting for ${name}`);
    return element;
  });
  const first = await guest('Main page');
  await user.click(preview.getByRole('button', { name: 'Show detail' }));
  Object.defineProperty(first, 'getWebContentsId', { value: () => 1 });
  fireEvent(first, new Event('dom-ready'));
  await waitFor(() => expect(prototypeWebImage(preview, 'Board')).toBe(boardImage));
  const second = await guest('Overlay page');
  Object.defineProperty(second, 'getWebContentsId', { value: () => 2 });
  fireEvent(second, new Event('dom-ready'));
  await waitFor(() => expect(prototypeWebImage(preview, 'Overlay')).toBe(overlayImage));
});

it('refreshes stale and offscreen web snapshots for PNG and reports a capture failure before saving', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  const desktop = 'data:image/jpeg;base64,ZGVza3RvcA==';
  const phone = 'data:image/jpeg;base64,cGhvbmU=';
  const offscreen = 'data:image/jpeg;base64,b2Zmc2NyZWVu';
  const zoomed = 'data:image/jpeg;base64,em9vbWVk';
  const handsetCapture = Promise.withResolvers<string>();
  const configure = vi.fn().mockResolvedValue(true);
  const capture = vi.fn().mockResolvedValueOnce(desktop).mockReturnValueOnce(handsetCapture.promise)
    .mockResolvedValueOnce(null).mockResolvedValueOnce(offscreen).mockResolvedValueOnce(zoomed);
  const saveImageAs = vi.fn().mockResolvedValue({ ok: true, cancelled: false });
  const visibleUrl = 'https://example.test/visible';
  const offscreenUrl = 'https://example.test/offscreen';
  await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'capture-for-export', rootIds: ['board'], nodes: {
    board: { kind: 'frame', name: 'Dashboard', x: 0, y: 0, width: 360, height: 220, clip: false, childIds: ['browser', 'offscreen'] },
    browser: { kind: 'web', name: 'Primary page', url: visibleUrl, x: 20, y: 20, width: 300, height: 170 },
    offscreen: { kind: 'web', url: offscreenUrl, x: 1200, y: 20, width: 300, height: 170 },
  } }, undefined, {
    webPreview: { partition: 'test-preview', devices: [{ id: 'phone', label: 'Phone', width: 400, height: 800 }],
      configure, capture, onEscape: () => () => undefined },
    output: { saveImageAs },
  });
  async function readyGuest(id: number, previous?: Element) {
    const guest = await waitFor(() => {
      const guest = document.querySelector('webview');
      if (!guest || guest === previous) throw new Error('Expected a new capture guest.');
      return guest;
    });
    Object.defineProperty(guest, 'getWebContentsId', { value: () => id });
    fireEvent(guest, new Event('dom-ready'));
    await waitFor(() => expect(capture).toHaveBeenCalledWith(id));
    return guest;
  }
  try {
    await readyGuest(1);
    await waitFor(() => expect(drawing.images.get('browser')?.image.src).toBe(desktop));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'feature.design.webDevice' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Phone' }));
    await user.click(screen.getByRole('button', { name: 'Dashboard' }));
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.exportLayer' });
    await user.click(save);
    const handsetGuest = await readyGuest(2);
    expect(configure).toHaveBeenCalledWith(2, { url: visibleUrl, interactive: false, device: { id: 'phone', width: 400, height: 800 } });
    expect(saveImageAs).not.toHaveBeenCalled();
    await act(async () => { handsetCapture.resolve(phone); });
    const failedGuest = await readyGuest(3, handsetGuest);
    expect(configure).toHaveBeenCalledWith(3, { url: offscreenUrl, interactive: false, device: undefined });
    await screen.findByText('feature.design.exportFailed');
    expect(saveImageAs).not.toHaveBeenCalled();

    await user.click(save);
    await readyGuest(4, failedGuest);
    expect(configure).toHaveBeenCalledWith(4, { url: offscreenUrl, interactive: false, device: undefined });
    await waitFor(() => expect(saveImageAs).toHaveBeenCalledOnce());
    expect(drawing.exportedImages.get('browser')?.src).toBe(phone);
    expect(drawing.exportedImages.get('offscreen')?.src).toBe(offscreen);

    await user.click(screen.getByRole('button', { name: 'Primary page' }));
    await user.click(screen.getByRole('combobox', { name: 'feature.design.webZoom' }));
    await user.click(await screen.findByRole('option', { name: '125%' }));
    await user.click(screen.getByRole('button', { name: 'Dashboard' }));
    await user.click(screen.getByRole('button', { name: 'feature.design.exportLayer' }));
    await readyGuest(5);
    expect(configure).toHaveBeenCalledWith(5, { url: visibleUrl, interactive: false, device: { id: 'phone', width: 320, height: 640 } });
    await waitFor(() => expect(saveImageAs).toHaveBeenCalledTimes(2));
    expect(drawing.exportedImages.get('browser')?.src).toBe(zoomed);
  } finally { handsetCapture.resolve(phone); }
});

it('uses the browser toolbar before selection and keeps dragging available while browsing', async () => {
  const configure = vi.fn().mockResolvedValue(true);
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'web', rootIds: [], nodes: {} }, undefined,
    { webPreview: { partition: 'test-preview', devices: [{ id: 'phone', label: 'Phone', width: 400, height: 800 }],
      configure, capture: vi.fn(), onEscape: () => () => undefined } });
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'feature.design.shapeTools' }));
  await user.click(await screen.findByRole('menuitem', { name: 'feature.design.tool.web' }));
  const pointer = { button: 0, pointerId: 1, clientX: 100, clientY: 100 };
  fireEvent.pointerDown(canvas, pointer);
  await act(async () => { fireEvent.pointerUp(canvas, pointer); });

  const clearSelection = () => {
    canvas.focus();
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'feature.design.webZoom' })).toBeNull();
  };
  clearSelection();
  const toolbar = within(screen.getByRole('toolbar', { name: 'feature.design.webToolbar' }));
  const addressField = () => toolbar.getByRole<HTMLInputElement>('textbox', { name: 'feature.design.webAddress' });
  enterSource(addressField(), 'localhost:4321/dev');
  const address = 'http://localhost:4321/dev';
  await waitFor(async () => {
    const { document } = await read();
    expect(document.nodes[document.rootIds[0]]).toMatchObject({ kind: 'web', url: address });
  });

  await user.click(toolbar.getByRole('button', { name: 'feature.design.webDevice' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Phone' }));
  const [browserId] = (await read()).document.rootIds;
  const release = { ...pointer, clientX: 145, clientY: 125, altKey: true };
  async function dragFromToolbar() {
    const start = (await read()).document.nodes[browserId];
    fireEvent.pointerDown(toolbar.getByRole('button', { name: 'feature.design.moveWebLayer' }), pointer);
    fireEvent.pointerMove(canvas, release);
    fireEvent.pointerUp(canvas, release);
    await waitFor(async () => expect((await read()).document.nodes[browserId]).toMatchObject({
      x: start.x + 45, y: start.y + 25, url: address,
    }));
  }
  await dragFromToolbar();
  await user.click(screen.getByRole('combobox', { name: 'feature.design.webZoom' }));
  await user.click(await screen.findByRole('option', { name: '125%' }));
  await waitFor(async () => {
    const { document } = await read();
    expect(document.nodes[document.rootIds[0]]).toMatchObject({ url: address, deviceId: 'phone', zoom: 1.25 });
  });
  clearSelection();
  await user.click(toolbar.getByRole('button', { name: 'feature.design.openWebPreview' }));
  const guest = document.querySelector('webview')!;
  const reload = vi.fn();
  const currentAddress = `${address}#details`;
  Object.defineProperties(guest, {
    getWebContentsId: { value: () => 1 }, getURL: { value: () => currentAddress }, reload: { value: reload },
  });
  fireEvent(guest, new Event('dom-ready'));
  await waitFor(() => expect(configure).toHaveBeenCalledWith(1, {
    url: address, device: { id: 'phone', width: 320, height: 640 }, interactive: true,
  }));
  fireEvent(guest, Object.assign(new Event('did-navigate-in-page'), { url: currentAddress, isMainFrame: true }));
  expect(addressField().value).toBe(currentAddress);
  await user.click(toolbar.getByRole('button', { name: 'feature.design.reloadWebPreview' }));
  expect(reload).toHaveBeenCalledOnce();
  const failed = (errorCode: number, isMainFrame: boolean) => fireEvent(guest,
    Object.assign(new Event('did-fail-load'), { errorCode, isMainFrame }));
  failed(-3, true);
  fireEvent(guest, new Event('did-stop-loading'));
  failed(-105, true);
  expect(screen.queryByText('feature.design.webLoadFailed')).toBeNull();

  await user.click(toolbar.getByRole('button', { name: 'feature.design.reloadWebPreview' }));
  failed(-105, false);
  expect(screen.queryByText('feature.design.webLoadFailed')).toBeNull();
  failed(-105, true);
  await screen.findByText('feature.design.webLoadFailed');

  await dragFromToolbar();
  await user.click(toolbar.getByRole('button', { name: 'feature.design.stopWebPreview' }));
  expect(addressField().value).toBe(address);

  await user.click(screen.getByRole('button', { name: 'feature.design.addAutoLayout' }));
  await waitFor(async () => {
    const { document } = await read();
    expect(document.nodes[document.rootIds[0]]).toMatchObject({ kind: 'frame', layout: { direction: expect.any(String) }, childIds: [browserId] });
    expect(document.nodes[browserId]).toMatchObject({ url: address, deviceId: 'phone', zoom: 1.25 });
  });
});

it('imports a script and converts only the result of the saved parameters', async () => {
  const size = { x: 0, y: 0, width: 240, height: 120 };
  const result: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'script-output', rootIds: ['bar'], nodes: {
    bar: { ...size, kind: 'rectangle', name: 'Bar', cornerRadius: 4 },
  } };
  const source = '// 图表\r\nreturn [];';
  const scriptPath = 'design-assets/bars-2.js';
  const store = vi.fn<DesignClient['importScript']>().mockResolvedValue(scriptPath);
  let releaseRender: () => void = () => undefined;
  const pendingRender = new Promise<void>((resolve) => { releaseRender = resolve; });
  const evaluate = vi.fn<DesignClient['renderScript']>(async ({ inputs }) => {
    if (inputs?.barWidth !== 90) return result;
    await pendingRender;
    return { ...result, nodes: { bar: { ...result.nodes.bar, width: 90 } } };
  });
  const { read, commit, documentRef } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'script',
    rootIds: ['before', 'script', 'after'], nodes: {
      before: { ...size, kind: 'ellipse', y: -120 }, after: { ...size, kind: 'ellipse', y: 200 },
      script: { ...size, kind: 'script', name: 'Graphic', x: 12, y: 16 },
    } }, undefined, { importScript: store, renderScript: evaluate,
    readScriptParameters: async () => [{ name: 'barWidth', type: 'number', defaultValue: size.width }] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Graphic' }));
  const input = window.document.querySelector<HTMLInputElement>('input[type="file"][accept=".js"]')!;
  const openPicker = vi.spyOn(input, 'click');
  await user.click(screen.getByRole('button', { name: 'feature.design.importScript' }));
  expect(openPicker).toHaveBeenCalledOnce();
  await user.upload(input, new File([source], 'bars.js', { type: 'text/javascript' }));
  const convert = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.convertScript' });
  await waitFor(() => expect(convert.disabled).toBe(false));
  expect(store).toHaveBeenCalledExactlyOnceWith({ ref: documentRef, name: 'bars.js', source }, expect.any(AbortSignal));
  expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ scriptPath, width: 240, height: 120 }), expect.any(AbortSignal));
  expect((await read()).document.nodes.script).toMatchObject({ kind: 'script', scriptPath });
  expect(commit).toHaveBeenCalledTimes(1);

  const parameter = await screen.findByRole('spinbutton', { name: 'barWidth' });
  parameter.focus();
  fireEvent.change(parameter, { target: { value: '90' } });
  try {
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ inputs: { barWidth: 90 } }), expect.any(AbortSignal)));
    expect(commit).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.keyDown(parameter, { key: 'Enter' }); });
    expect((await read()).document.nodes.script).toMatchObject({ scriptInputs: { barWidth: 90 } });
    expect(convert.disabled).toBe(true);
  } finally { releaseRender(); }
  await waitFor(() => expect(convert.disabled).toBe(false));
  await act(async () => { fireEvent.click(convert); });
  const { document } = await read();
  const frameId = document.rootIds[1];
  const frame = document.nodes[frameId];
  expect(document.rootIds).toEqual(['before', frameId, 'after']);
  expect(document.nodes.script).toBeUndefined();
  expect(frame).toMatchObject({ kind: 'frame', x: 12, y: 16, width: 240 });
  if (frame.kind !== 'frame') throw new Error('Expected editable script output.');
  expect(frame.childIds.map((id) => document.nodes[id])).toEqual([expect.objectContaining({ ...result.nodes.bar, width: 90 })]);
  expect(commit).toHaveBeenCalledTimes(3);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'feature.design.undo' })); });
  expect((await read()).document.nodes.script).toMatchObject({ kind: 'script', scriptPath, scriptInputs: { barWidth: 90 } });
});

it('exports and previews the current generated content of a board after its script finishes', async () => {
  const metrics = { save() {}, restore() {}, measureText: (text: string) => ({ width: text.length * 8 }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(metrics as unknown as CanvasRenderingContext2D);
  vi.spyOn(Util, 'isCanvasFarblingActive').mockReturnValue(false);
  const first = Promise.withResolvers<DesignDocument>();
  const updated = Promise.withResolvers<DesignDocument>();
  const scriptPath = 'design-assets/chart.js';
  const renderScript = vi.fn<DesignClient['renderScript']>(({ inputs }) => inputs?.value === 80 ? updated.promise : first.promise);
  const copyText = vi.fn().mockResolvedValue(undefined);
  const generated = (text: string): DesignDocument => ({ schemaVersion: designDocumentVersion, documentId: 'script-output',
    rootIds: ['label'], nodes: { label: { kind: 'text', text, x: 5, y: 5, width: 180, fontSize: 14 } } });
  await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'script-output-board', rootIds: ['board', 'note'], nodes: {
    board: { kind: 'frame', name: 'Dashboard', x: 0, y: 0, width: 360, height: 220, childIds: ['script'] },
    script: { kind: 'script', name: 'Chart', scriptPath, x: 20, y: 20, width: 300, height: 170 },
    note: { kind: 'text', name: 'Note', text: 'Independent note', x: 0, y: 240, width: 180, fontSize: 14 },
  } }, undefined, { renderScript, readScriptParameters: async () => [{ name: 'value', type: 'number', defaultValue: 40 }], output: { copyText } });
  const user = userEvent.setup();
  const select = async (name: string) => user.click(await screen.findByRole('button', { name }));
  const copy = () => screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.copyHtml' });
  try {
    await waitFor(() => expect(renderScript).toHaveBeenCalled());
    await select('Dashboard');
    expect(copy().disabled).toBe(true);
    await user.click(copy());
    expect(copyText).not.toHaveBeenCalled();
    await select('Note');
    await user.click(copy());
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith(expect.stringContaining('Independent note')));

    await act(async () => { first.resolve(generated('Initial chart label')); });
    await select('Chart');
    const parameter = await screen.findByRole('spinbutton', { name: 'value' });
    parameter.focus();
    fireEvent.change(parameter, { target: { value: '80' } });
    await act(async () => { fireEvent.keyDown(parameter, { key: 'Enter' }); });
    await waitFor(() => expect(renderScript).toHaveBeenCalledWith(expect.objectContaining({ inputs: { value: 80 } }), expect.any(AbortSignal)));
    await select('Dashboard');
    expect(copy().disabled).toBe(true);

    await act(async () => { updated.resolve(generated('Updated chart label')); });
    await waitFor(() => expect(copy().disabled).toBe(false));
    await user.click(copy());
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith(expect.stringContaining('Updated chart label')));

    await user.click(screen.getByRole('button', { name: 'feature.design.prototype.preview' }));
    const preview = within(await screen.findByRole('dialog', { name: 'feature.design.prototype.preview' }));
    const board = await preview.findByRole<HTMLImageElement>('img', { name: 'Dashboard' });
    expect(decodeURIComponent(board.src)).toContain('Updated chart label');
  } finally {
    first.resolve(generated('Initial chart label'));
    updated.resolve(generated('Updated chart label'));
  }
});
