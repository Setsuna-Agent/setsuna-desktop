// @vitest-environment happy-dom

import { createHash } from 'node:crypto';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { designBundledFontFamilies, type DesignCustomFont } from '../../../src/contracts/design-fonts.js';
import { designDocumentVersion } from '../../../src/contracts/index.js';
import { bundledDesignFonts } from '../../../src/renderer/text/design-bundled-fonts.js';
import { designCustomFontFamily } from '../../../src/renderer/text/design-typography.js';
import { drawing, mountEditor } from '../support/mount-design-editor.js';

const font: DesignCustomFont = { id: '1'.repeat(64), family: 'Imported', name: 'Imported Regular', format: 'woff2',
  minWeight: 400, maxWeight: 400, style: 'normal', embeddable: true };
const textContext = { font: '', measureText(text: string) {
  const registered = Array.from(document.fonts).some(({ family }) => textContext.font.includes(family));
  const advance = registered ? 20 : textContext.font.startsWith('italic ') ? 16 : 10;
  return { width: text.length * advance };
} };

function stubFontFaces(decode = Promise.resolve()) {
  class BrowserFontFace {
    constructor(readonly family: string) {}
    async load() { await decode; return this; }
  }
  const registered = new Set<BrowserFontFace>();
  const previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { configurable: true, value: registered });
  vi.stubGlobal('FontFace', BrowserFontFace);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(textContext as unknown as CanvasRenderingContext2D);
  return { registered, restore() {
    cleanup();
    if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
    else Reflect.deleteProperty(document, 'fonts');
  } };
}

it('reflows saved text when its imported font loads or is removed without editing the design', async () => {
  let release = () => {};
  const decode = new Promise<void>((resolve) => { release = resolve; });
  const { restore } = stubFontFaces(decode);
  const list = vi.fn<() => Promise<readonly DesignCustomFont[]>>().mockResolvedValue([font]);
  const read = vi.fn().mockResolvedValue({ base64: 'Zm9udA==' });
  try {
    const editor = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'fonts', rootIds: ['board'], nodes: {
      board: { kind: 'frame', name: 'Board', x: -80, y: -40, width: 160, height: 100, childIds: ['label', 'tile'],
        layout: { direction: 'horizontal', gap: 8, padding: 0, align: 'start' } },
      label: { kind: 'text', x: 0, y: 0, width: 20, widthMode: 'hug', fontSize: 12, fontFamily: font.family,
        text: 'Aa', runs: [{ start: 0, end: 2, fontWeight: 400 }] },
      tile: { kind: 'rectangle', x: 0, y: 0, width: 12, height: 12, cornerRadius: 0 },
    } }, undefined, { fonts: { list, read, import: vi.fn(), remove: vi.fn() } });
    await screen.findByRole('button', { name: 'Board' });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(drawing.localX.get('tile')).toBe(28);

    await act(async () => { release(); });
    await waitFor(() => expect(drawing.localX.get('tile')).toBe(48));

    list.mockResolvedValue([]);
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(drawing.localX.get('tile')).toBe(28));
    expect((await editor.read()).document.nodes.label).toMatchObject({ text: 'Aa', fontFamily: font.family });
    expect(editor.commit).not.toHaveBeenCalled();
  } finally {
    release();
    restore();
  }
});

it('waits for fonts used only by generated text and embeds its selected faces in HTML and SVG', async () => {
  const decode = Promise.withResolvers<void>();
  const { restore } = stubFontFaces(decode.promise);
  const bold = { ...font, id: '2'.repeat(64), name: 'Imported Bold', minWeight: 700, maxWeight: 700 };
  const italic = { ...font, id: '3'.repeat(64), name: 'Imported Italic', style: 'italic' as const };
  const base64 = 'Zm9udA==';
  const read = vi.fn(async (id: string) => ({ base64: id === font.id ? base64 : 'b3RoZXI=' }));
  const saveDesignHtml = vi.fn().mockResolvedValue({ ok: true, cancelled: true });
  const saveDesignSvg = vi.fn().mockResolvedValue({ ok: true, cancelled: true });
  try {
    await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'font-export', rootIds: ['label'], nodes: {
      label: { kind: 'script', name: 'Caption', scriptPath: 'caption.js', x: 0, y: 0, width: 120, height: 28 },
    } }, undefined, {
      renderScript: async () => ({ schemaVersion: designDocumentVersion, documentId: 'output', rootIds: ['text'], nodes: {
        text: { kind: 'text', x: 0, y: 0, width: 120, fontSize: 12, text: 'Caption',
          fontFamily: font.family, fontWeight: 700, runs: [{ start: 0, end: 7, fontWeight: 400 }] },
      } }),
      fonts: { list: vi.fn().mockResolvedValue([font, bold, italic]), read, import: vi.fn(), remove: vi.fn() },
      output: { saveDesignHtml, saveDesignSvg },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Caption' }));
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.saveHtml' });
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(save.disabled).toBe(true);
    await act(async () => { decode.resolve(); });
    await waitFor(() => expect(save.disabled).toBe(false));
    read.mockClear();
    await user.click(save);
    await waitFor(() => expect(saveDesignHtml).toHaveBeenCalledOnce());
    await waitFor(() => expect(save.disabled).toBe(false));
    await user.click(screen.getByRole('combobox', { name: 'feature.design.exportImageFormat' }));
    await user.click(await screen.findByRole('option', { name: 'SVG' }));
    await user.click(screen.getByRole('button', { name: 'feature.design.exportLayer' }));
    await waitFor(() => expect(saveDesignSvg).toHaveBeenCalledOnce());
    expect(read.mock.calls.map(([id]) => id)).toEqual([font.id, font.id]);
    for (const [markup, type] of [[saveDesignHtml.mock.calls[0][0].html, 'text/html'],
      [saveDesignSvg.mock.calls[0][0].svg, 'image/svg+xml']] as const) {
      const document = new DOMParser().parseFromString(markup, type);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(Array.from(document.querySelectorAll('style'), (style) => style.textContent).join('\n'));
      const faces = Array.from(sheet.cssRules).filter((rule) => rule instanceof CSSFontFaceRule).map(({ style }) => ({
        family: style.getPropertyValue('font-family'), weight: style.getPropertyValue('font-weight'), style: style.getPropertyValue('font-style'),
        source: style.getPropertyValue('src').match(/\burl\(\s*['"]?([^'"\s)]+)['"]?\s*\)/u)?.[1],
      }));
      expect(faces).toEqual([{ family: designCustomFontFamily(font.family), weight: '400', style: 'normal', source: `data:font/woff2;base64,${base64}` }]);
    }
  } finally {
    decode.resolve();
    restore();
  }
});

it('embeds the bundled italic face in a standalone export without reading the custom font store', async () => {
  const { restore } = stubFontFaces();
  const italicFace = bundledDesignFonts.find(({ family, style }) => family === designBundledFontFamilies.geist && style === 'italic');
  const read = vi.fn().mockRejectedValue(new Error('No imported font data'));
  const saveDesignHtml = vi.fn().mockResolvedValue({ ok: true, cancelled: true });
  try {
    await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'offline-font', rootIds: ['label'], nodes: {
      label: { kind: 'text', name: 'Caption', text: 'Preview', x: 0, y: 0, width: 128, fontSize: 16,
        fontFamily: designBundledFontFamilies.geist, fontStyle: 'italic', fontWeight: 700,
        runs: [{ start: 0, end: 7, fontWeight: 700 }] },
    } }, undefined, {
      fonts: { list: vi.fn().mockResolvedValue([]), read, import: vi.fn(), remove: vi.fn() },
      output: { saveDesignHtml },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Caption' }));
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.saveHtml' });
    await waitFor(() => expect(save.disabled).toBe(false));
    await user.click(save);
    await waitFor(() => expect(saveDesignHtml).toHaveBeenCalledOnce());
    const html: string = saveDesignHtml.mock.calls[0][0].html;
    const face = html.match(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/u)?.[1];
    expect(createHash('sha256').update(Buffer.from(face ?? '', 'base64')).digest('hex'))
      .toBe(italicFace?.id);
    expect(read).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});

it('previews a visible imported font on the canvas, discards abandoned hovers and saves only on selection', async () => {
  const offscreen = { ...font, id: '2'.repeat(64), family: 'Offscreen', name: 'Offscreen Regular' };
  let release = () => {};
  const decode = new Promise<void>((resolve) => { release = resolve; });
  const { registered, restore } = stubFontFaces(decode);
  const show = new Map<Element, () => void>();
  vi.stubGlobal('IntersectionObserver', class {
    private readonly targets = new Set<Element>();
    constructor(private readonly report: (entries: { target: Element; isIntersecting: boolean }[]) => void) {}
    observe(target: Element) {
      this.targets.add(target);
      show.set(target, () => this.report([{ target, isIntersecting: true }]));
    }
    unobserve(target: Element) { this.targets.delete(target); show.delete(target); }
    disconnect() { for (const target of this.targets) this.unobserve(target); }
  });
  const list = vi.fn().mockResolvedValue([font, offscreen]);
  const read = vi.fn().mockResolvedValue({ base64: 'Zm9udA==' });
  try {
    const editor = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'font-preview', rootIds: ['board'], nodes: {
      board: { kind: 'frame', x: -80, y: -40, width: 160, height: 100, childIds: ['label', 'tile'],
        layout: { direction: 'horizontal', gap: 8, padding: 0, align: 'start' } },
      label: { kind: 'text', name: 'Body copy', x: 0, y: 0, width: 20, widthMode: 'hug', fontSize: 12, text: 'Aa',
        runs: [{ start: 0, end: 2, fontWeight: 400 }] },
      tile: { kind: 'rectangle', x: 0, y: 0, width: 12, height: 12, cornerRadius: 0 },
    } }, undefined,
    { fonts: { list, read, import: vi.fn(), remove: vi.fn() } });
    fireEvent.click(await screen.findByRole('button', { name: 'feature.design.expandLayer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Body copy' }));
    const picker = screen.getByRole('button', { name: 'feature.design.localFonts' });
    fireEvent.click(picker);
    // The headless DOM has no anchor geometry for the popover's visibility check.
    fireEvent.click(await screen.findByText('feature.design.fontGroup.custom'));
    const option = await screen.findByText(font.family);
    expect(read).not.toHaveBeenCalled();
    const enterViewport = show.get(option)!;
    await act(async () => { enterViewport(); });
    fireEvent.pointerOver(option, { pointerType: 'mouse' });
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(drawing.localX.get('tile')).toBe(28);
    fireEvent.pointerOut(option, { pointerType: 'mouse' });
    await act(async () => { release(); });
    await waitFor(() => expect([...registered].map(({ family }) => family)).toEqual([designCustomFontFamily(font.family)]));
    expect(drawing.localX.get('tile')).toBe(28);

    fireEvent.pointerOver(option, { pointerType: 'mouse' });
    await waitFor(() => expect(drawing.localX.get('tile')).toBe(48));
    expect((await editor.read()).document.nodes.label).toMatchObject({ fontFamily: undefined });
    expect(editor.commit).not.toHaveBeenCalled();
    fireEvent.keyDown(option, { key: 'Escape' });
    expect(drawing.localX.get('tile')).toBe(28);

    fireEvent.click(picker);
    fireEvent.click(await screen.findByText(font.family));
    await waitFor(async () => expect((await editor.read()).document.nodes.label).toMatchObject({ fontFamily: font.family }));
    expect(drawing.localX.get('tile')).toBe(48);
    expect(editor.commit).toHaveBeenCalledOnce();
    expect(read.mock.calls.map(([id]) => id)).toEqual([font.id]);
  } finally {
    release();
    restore();
  }
});

it('persists a new font weight and italic together and can change the slant of a bound weight', async () => {
  const { restore } = stubFontFaces();
  try {
    const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'font-style', rootIds: ['board'], nodes: {
      board: { kind: 'frame', x: -80, y: -40, width: 160, height: 100, childIds: ['label', 'tile'],
        layout: { direction: 'horizontal', gap: 8, padding: 0, align: 'start' } },
      label: { kind: 'text', name: 'Title', x: 0, y: 0, width: 20, widthMode: 'hug', fontSize: 12,
        text: 'Aa', runs: [{ start: 0, end: 2, fontSize: 12 }] },
      tile: { kind: 'rectangle', x: 0, y: 0, width: 12, height: 12, cornerRadius: 0 },
    }, styles: { heavy: { kind: 'number', name: 'Heavy', value: 900 } } }, undefined, {
      translate(key, params) {
        if (key === 'feature.design.bindVariable') return `Bind ${params?.field}`;
        if (key === 'feature.design.weightItalic') return `${params?.weight} italic`;
        return key;
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'feature.design.expandLayer' }));
    await user.click(screen.getByRole('button', { name: 'Title' }));
    const styleField = () => screen.getByRole('combobox', { name: 'feature.design.fontStyle' });
    const thinItalic = () => screen.findByRole('option', { name: 'feature.design.weight.100 italic' });

    await user.click(styleField());
    fireEvent.pointerOver(await thinItalic(), { pointerType: 'mouse' });
    expect(drawing.localX.get('tile')).toBe(40);
    expect(commit).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(drawing.localX.get('tile')).toBe(28);

    await user.click(styleField());
    await user.click(await thinItalic());
    await waitFor(async () => expect((await read()).document.nodes.label).toMatchObject({ fontWeight: 100, fontStyle: 'italic' }));

    await user.click(screen.getByRole('combobox', { name: 'Bind feature.design.fontWeight' }));
    await user.click(await screen.findByRole('option', { name: 'Heavy' }));
    await waitFor(async () => expect((await read()).document.nodes.label).toMatchObject({
      fontWeight: 900, fontStyle: 'italic', variableIds: { fontWeight: 'heavy' },
    }));

    await user.click(styleField());
    await user.click(await screen.findByRole('option', { name: 'feature.design.weight.900' }));
    await waitFor(async () => expect((await read()).document.nodes.label).toMatchObject({
      fontWeight: 900, fontStyle: undefined, variableIds: { fontWeight: 'heavy' },
    }));
    expect(drawing.localX.get('tile')).toBe(28);
  } finally {
    restore();
  }
});
