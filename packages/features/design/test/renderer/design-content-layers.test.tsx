// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Util } from 'konva/lib/Util.js';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { MAX_DESKTOP_IMAGE_BYTES } from '@setsuna-desktop/contracts';
import { designDocumentVersion, type DesignDocument, type DesignPublicationBridge } from '../../src/contracts/index.js';
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

function publicationForExports(prepareExport: DesignPublicationBridge['prepareExport'],
  useExportFile: DesignPublicationBridge['useExportFile'] = async () => 'saved'): DesignPublicationBridge {
  return { prepareExport, useExportFile, closeExport: vi.fn().mockResolvedValue(undefined),
    previewStatus: vi.fn().mockResolvedValue(null), beginPreview: vi.fn(), appendPreviewBoard: vi.fn(), appendPreviewVariant: vi.fn(),
    publishPreview: vi.fn(), cancelPreview: vi.fn(), stopPreview: vi.fn() };
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
  expect(configure).toHaveBeenCalledWith(1, { url, device: undefined, networkAccess: true, interactive: false });
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

it('previews every design export before saving, using the same captured web page for each layer format', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  const snapshot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1X8AAAAASUVORK5CYII=';
  const prepareExport = vi.fn<DesignPublicationBridge['prepareExport']>(async (_, input) => input.kind === 'zip'
    ? { name: 'test.zip', archive: { entries: ['manifest.json', 'content/test.design.json'], remaining: 0 } }
    : { name: input.name });
  const useExportFile = vi.fn<DesignPublicationBridge['useExportFile']>(async () => 'saved');
  const publication = publicationForExports(prepareExport, useExportFile);
  const directSave = vi.fn();
  const capture = vi.fn().mockResolvedValue(snapshot);
  await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'web-export', rootIds: ['board', 'secondary', 'draft'], nodes: {
    board: { kind: 'frame', name: 'Dashboard', x: 0, y: 0, width: 360, height: 220, childIds: ['browser'] },
    browser: { kind: 'web', url: 'https://example.test/', x: 20, y: 20, width: 300, height: 170 },
    secondary: { kind: 'frame', name: 'Secondary board', x: 420, y: 0, width: 240, height: 200, childIds: [] },
    draft: { kind: 'frame', name: 'Private draft', x: 740, y: 0, width: 240, height: 200, childIds: [], hidden: true },
  } }, undefined, {
    webPreview: { partition: 'test-preview', devices: [], configure: vi.fn().mockResolvedValue(true),
      capture, onEscape: () => () => undefined },
    publication, output: { saveImageAs: directSave, saveDesignSvg: directSave, saveDesignHtml: directSave },
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
  async function savePreview() {
    const dialog = within(await screen.findByRole('dialog', { name: 'feature.design.exportPreview.title' }));
    const save = await dialog.findByRole('button', { name: 'feature.design.exportPreview.saveAs' });
    const [id, input] = prepareExport.mock.lastCall!;
    expect(useExportFile).not.toHaveBeenCalledWith(id, 'save');
    await user.click(save);
    await waitFor(() => expect(useExportFile).toHaveBeenCalledWith(id, 'save'));
    await user.click(dialog.getByRole('button', { name: 'Close' }));
    return input;
  }
  await user.click(await screen.findByRole('button', { name: 'Dashboard' }));
  await user.click(screen.getByRole('button', { name: 'feature.design.prototype.previewBoard' }));
  const preview = within(await screen.findByRole('dialog', { name: 'feature.design.prototype.preview' }));
  await waitFor(() => expect(prototypeWebImage(preview, 'Dashboard')).toBe(snapshot));
  await user.click(preview.getByRole('button', { name: 'feature.design.prototype.exit' }));
  await user.click(screen.getByRole('button', { name: 'feature.design.exportLayer' }));
  expect(await savePreview()).toMatchObject({ kind: 'png', name: 'Dashboard.png' });
  expect(drawing.exportedImages.get('browser')?.src).toBe(snapshot);
  await user.click(screen.getByRole('combobox', { name: 'feature.design.exportImageFormat' }));
  await user.click(await screen.findByRole('option', { name: 'SVG' }));
  await user.click(screen.getByRole('button', { name: 'feature.design.exportLayer' }));
  const vector = await savePreview();
  if (vector.kind !== 'svg') throw new Error('Expected a prepared SVG.');
  const svg = new DOMParser().parseFromString(vector.content, 'image/svg+xml');
  expect(svg.querySelector('image')?.getAttribute('href')).toBe(snapshot);
  await user.click(screen.getByRole('button', { name: 'feature.design.saveHtml' }));
  const tailwind = await savePreview();
  await user.click(screen.getByRole('combobox', { name: 'feature.design.codeFormat' }));
  await user.click(await screen.findByRole('option', { name: 'HTML', exact: true }));
  await user.click(screen.getByRole('button', { name: 'feature.design.saveHtml' }));
  const plain = await savePreview();
  if (tailwind.kind !== 'html' || plain.kind !== 'html') throw new Error('Expected prepared HTML exports.');
  for (const { content } of [tailwind, plain]) {
    const html = new DOMParser().parseFromString(content, 'text/html');
    expect(html.querySelector('img')?.getAttribute('src')).toBe(snapshot);
  }
  expect(plain.content).not.toBe(tailwind.content);

  await user.click(screen.getByRole('button', { name: 'feature.design.publication.share' }));
  const share = within(await screen.findByRole('dialog', { name: 'feature.design.publication.share' }));
  await user.click(share.getByRole('tab', { name: 'feature.design.layerExport' }));
  const startDocumentExport = (name: string) => user.click(share.getByRole('button', { name, exact: true }));
  const pendingPackage = Promise.withResolvers<Awaited<ReturnType<DesignPublicationBridge['prepareExport']>>>();
  const packagingStarted = Promise.withResolvers<string>();
  prepareExport.mockImplementationOnce((id) => {
    packagingStarted.resolve(id);
    return pendingPackage.promise;
  });
  try {
    await startDocumentExport('feature.design.publication.sourcePackage');
    await screen.findByRole('dialog', { name: 'feature.design.exportPreview.title' });
    const cancelledId = await packagingStarted.promise;
    await user.keyboard('{Escape}');
    await waitFor(() => expect(publication.closeExport).toHaveBeenCalledWith(cancelledId));
    expect(useExportFile).not.toHaveBeenCalledWith(cancelledId, 'save');
    await act(async () => pendingPackage.resolve({ name: 'late.zip' }));
    expect(screen.queryByRole('dialog', { name: 'feature.design.exportPreview.title' })).toBeNull();
  } finally {
    pendingPackage.resolve(null);
  }
  await startDocumentExport('feature.design.publication.sourcePackage');
  expect(await savePreview()).toMatchObject({ kind: 'zip', version: { documentId: 'web-export' } });
  await startDocumentExport('HTML');
  const manuscript = await savePreview();
  if (manuscript.kind !== 'html') throw new Error('Expected a prepared document HTML export.');
  expect(manuscript.name).toBe('test.html');
  const html = new DOMParser().parseFromString(manuscript.content, 'text/html');
  expect(html.querySelector('[data-layer="Dashboard"] img')?.getAttribute('src')).toBe(snapshot);
  expect(html.querySelector('[data-layer="Secondary board"]')).not.toBeNull();
  expect(html.querySelector('[data-layer="Private draft"]')).toBeNull();
  await user.click(share.getByRole('combobox', { name: 'feature.design.exportScale' }));
  await user.click(await screen.findByRole('option', { name: '2×' }));
  await startDocumentExport('PNG');
  expect(await savePreview()).toMatchObject({ kind: 'png', name: 'test@2x.png' });
  expect(drawing.exportedImages.get('browser')?.src).toBe(snapshot);
  expect(publication.beginPreview).not.toHaveBeenCalled();
  expect(directSave).not.toHaveBeenCalled();
  expect(capture).toHaveBeenCalledExactlyOnceWith(1);
});

it('navigates both HTML exports and saves a fitted PNG of a wide canvas', async () => {
  const prepare = vi.fn<DesignPublicationBridge['prepareExport']>(async (_, input) => ({
    name: input.kind === 'zip' ? 'test.zip' : input.name,
  }));
  const useExportFile = vi.fn<DesignPublicationBridge['useExportFile']>(async () => 'saved');
  const board = { kind: 'frame' as const, y: 0, width: 800, height: 640, childIds: [] };
  await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'wide-export', rootIds: ['first', 'last'], nodes: {
    first: { ...board, x: 0, name: 'First board' }, last: { ...board, x: 39_200, name: 'Last board' },
  } }, undefined, { publication: publicationForExports(prepare, useExportFile),
    translate: (key, params) => key === 'feature.design.zoomTo' ? `${params?.percent}%` : key });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'feature.design.publication.share' }));
  const share = within(await screen.findByRole('dialog', { name: 'feature.design.publication.share' }));
  await user.click(share.getByRole('tab', { name: 'feature.design.layerExport' }));
  const startExport = (name: string) => user.click(share.getByRole('button', { name, exact: true }));

  for (const format of ['HTML', 'HTML + Tailwind']) {
    await startExport(format);
    const dialog = await screen.findByRole('dialog', { name: 'feature.design.exportPreview.title' });
    const frame = await waitFor(() => {
      const frame = dialog.querySelector('iframe');
      if (!frame) throw new Error('Expected the HTML preview to open.');
      return frame;
    });
    const input = prepare.mock.lastCall?.[1];
    if (input?.kind !== 'html') throw new Error('Expected HTML for the full canvas.');
    const saved = new DOMParser().parseFromString(input.content, 'text/html');
    expect([...saved.querySelectorAll('[data-layer]')].map((layer) => layer.getAttribute('data-layer'))).toEqual(['First board', 'Last board']);
    exerciseHtmlExportCanvas(saved);
    const embedded = new DOMParser().parseFromString(frame.getAttribute('srcdoc')!, 'text/html');
    const nonce = embedded.querySelector('script')?.getAttribute('nonce');
    expect(nonce).toBeTruthy();
    expect(embedded.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain(`script-src 'nonce-${nonce}'`);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  }
  const oversized = new Blob(['oversized encoder output'], { type: 'image/png' });
  Object.defineProperty(oversized, 'size', { value: MAX_DESKTOP_IMAGE_BYTES * 2 });
  drawing.encodePng.mockReturnValueOnce(oversized);
  await startExport('PNG');
  const dialog = within(await screen.findByRole('dialog', { name: 'feature.design.exportPreview.title' }));
  await user.click(await dialog.findByRole('button', { name: 'feature.design.exportPreview.saveAs' }));
  const attempts = drawing.encodePng.mock.calls;
  expect(attempts).toHaveLength(2);
  const [first] = attempts[0];
  const [saved] = attempts[1];
  expect(first.width).toBeLessThanOrEqual(32_767);
  expect(first.width * first.height).toBeLessThanOrEqual(16_000_000);
  expect(saved.width).toBeLessThan(first.width);
  expect(saved.height).toBeLessThan(first.height);
  expect(prepare.mock.lastCall?.[1]).toMatchObject({
    kind: 'png', name: `test-${saved.width}x${saved.height}.png`, content: 'data:image/png;base64,iVBORw0KGgo=',
  });
  expect(useExportFile).toHaveBeenCalledWith(prepare.mock.lastCall?.[0], 'save');
});

function exerciseHtmlExportCanvas(html: Document) {
  const viewport = html.querySelector('main')!;
  const stage = html.getElementById('setsuna-export-stage')!;
  const level = html.getElementById('zoom-level')!;
  const menu = html.getElementById('zoom-menu')!;
  const script = html.querySelector('script')!;
  let viewportWidth = 832;
  let resize!: () => void;
  let captured: number | undefined;
  Object.defineProperties(viewport, { clientWidth: { get: () => viewportWidth }, clientHeight: { value: 512 } });
  Object.assign(viewport, { setPointerCapture: (id: number) => { captured = id; },
    hasPointerCapture: (id: number) => captured === id, releasePointerCapture: () => { captured = undefined; } });
  runInNewContext(script.textContent!, {
    document: html,
    window: new EventTarget(),
    getComputedStyle: () => ({ paddingLeft: '16px', paddingRight: '16px', paddingTop: '16px', paddingBottom: '56px' }),
    ResizeObserver: class { constructor(callback: () => void) { resize = callback; } observe() {} },
  }, { timeout: 1_000 });
  const current = () => level.textContent;
  const position = () => stage.style.transform;
  const press = (key: string, code: string, shiftKey = false) =>
    viewport.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, code, shiftKey }));
  const pointer = (type: string, clientX: number, clientY: number) => viewport.dispatchEvent(
    new PointerEvent(type, { cancelable: true, bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY }));
  function dragCanvas() {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 220, 180);
    pointer('pointerup', 220, 180);
  }
  function wheelCanvas(ctrlKey: boolean) {
    // happy-dom's WheelEvent lacks its browser MouseEvent fields.
    const wheel = new MouseEvent('wheel', { ctrlKey, cancelable: true, clientX: 400, clientY: 240 });
    Object.defineProperties(wheel, { deltaX: { value: 0 }, deltaY: { value: 100 } });
    viewport.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
  }

  const fitted = position();
  expect(current()).toBe('2%');
  dragCanvas();
  const panned = position();
  expect(panned).not.toBe(fitted);
  expect(current()).toBe('2%');
  press('v', 'KeyV');
  dragCanvas();
  expect(position()).toBe(panned);
  wheelCanvas(false);
  expect(position()).not.toBe(panned);
  expect(current()).toBe('2%');

  level.click();
  within(menu).getByRole('menuitemradio', { name: '100%' }).click();
  expect(current()).toBe('100%');
  press('+', 'Equal', true);
  expect(current()).toBe('125%');
  press('-', 'Minus');
  expect(current()).toBe('100%');
  wheelCanvas(true);
  expect(current()).toBe('55%');
  press('!', 'Digit1', true);
  expect(position()).toBe(fitted);

  viewportWidth = 1632;
  resize();
  expect(current()).toBe('4%');
}

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
  await user.click(await preview.findByRole('button', { name: 'Show detail' }));
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
    expect(configure).toHaveBeenCalledWith(2, { url: visibleUrl, networkAccess: true, interactive: false, device: { id: 'phone', width: 400, height: 800 } });
    expect(saveImageAs).not.toHaveBeenCalled();
    await act(async () => { handsetCapture.resolve(phone); });
    const failedGuest = await readyGuest(3, handsetGuest);
    expect(configure).toHaveBeenCalledWith(3, { url: offscreenUrl, networkAccess: true, interactive: false, device: undefined });
    await screen.findByText('feature.design.exportFailed');
    expect(saveImageAs).not.toHaveBeenCalled();

    await user.click(save);
    await readyGuest(4, failedGuest);
    expect(configure).toHaveBeenCalledWith(4, { url: offscreenUrl, networkAccess: true, interactive: false, device: undefined });
    await waitFor(() => expect(saveImageAs).toHaveBeenCalledOnce());
    expect(drawing.exportedImages.get('browser')?.src).toBe(phone);
    expect(drawing.exportedImages.get('offscreen')?.src).toBe(offscreen);

    await user.click(screen.getByRole('button', { name: 'feature.design.expandLayer' }));
    await user.click(screen.getByRole('button', { name: 'Primary page' }));
    await user.click(screen.getByRole('combobox', { name: 'feature.design.webZoom' }));
    await user.click(await screen.findByRole('option', { name: '125%' }));
    await user.click(screen.getByRole('button', { name: 'Dashboard' }));
    await user.click(screen.getByRole('button', { name: 'feature.design.exportLayer' }));
    await readyGuest(5);
    expect(configure).toHaveBeenCalledWith(5, { url: visibleUrl, networkAccess: true, interactive: false, device: { id: 'phone', width: 320, height: 640 } });
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
    url: address, device: { id: 'phone', width: 320, height: 640 }, networkAccess: true, interactive: true,
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
    await user.click(screen.getByRole('button', { name: 'feature.design.expandLayer' }));
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

    await user.click(screen.getByRole('button', { name: 'feature.design.prototype.previewBoard' }));
    const preview = within(await screen.findByRole('dialog', { name: 'feature.design.prototype.preview' }));
    const board = await preview.findByRole<HTMLImageElement>('img', { name: 'Dashboard' });
    expect(decodeURIComponent(board.src)).toContain('Updated chart label');
  } finally {
    first.resolve(generated('Initial chart label'));
    updated.resolve(generated('Updated chart label'));
  }
});
