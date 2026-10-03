// @vitest-environment happy-dom

import type { WebContents } from 'electron';
import type { DesktopBrowserScreenshot } from '../../../src/contracts/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAnnotationSession, parseAnnotationMarkers } from '../../../src/main/annotations/session.js';
import { annotationPageOverlay } from '../../../src/main/annotations/page-overlay.js';
import { readAnnotationElement } from '../../../src/main/annotations/element-context.js';

afterEach(() => {
  annotationPageOverlay({ kind: 'dispose' }, readAnnotationElement);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const screenshot: DesktopBrowserScreenshot = { dataUrl: 'data:image/png;base64,b3JpZ2luYWw=', mimeType: 'image/png', size: 8, width: 1280, height: 720 };

function fixture() {
  const contents = {
    focus: vi.fn(),
    hostWebContents: { focus: vi.fn() },
    isDestroyed: () => false,
    getURL: () => 'https://example.com/checkout',
    getTitle: () => 'Checkout',
    executeJavaScriptInIsolatedWorld: vi.fn((_world: number, scripts: Array<{ code: string }>) =>
      // Execute the serialized bundle, not imported functions, to catch closure dependencies.
      Promise.resolve(new Function(`return ${scripts[0].code}`)())),
  };
  return { contents, session: new BrowserAnnotationSession(contents as unknown as WebContents) };
}

describe('browser annotation session', () => {
  it('selects a labelled element through the serialized isolated script without activating it', async () => {
    const button = document.createElement('button');
    button.id = 'checkout';
    button.innerHTML = '<span>Pay now</span>';
    document.body.append(button);
    const activate = vi.fn();
    button.addEventListener('click', activate);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
    // Closed shadow roots are intentional; capture the root just for dispatching test input.
    const attach = Element.prototype.attachShadow;
    let root: ShadowRoot | undefined;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, options) {
      root = attach.call(this, options);
      return root;
    });
    const { contents, session } = fixture();
    const selected = session.pick();
    root!.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const target = await selected;

    expect(target).toMatchObject({ selector: '#checkout', text: 'Pay now', url: 'https://example.com/checkout', title: 'Checkout' });
    expect(activate).not.toHaveBeenCalled();
    expect(contents.hostWebContents.focus).toHaveBeenCalledOnce();
    expect(await session.anchor(target!.id)).not.toBeNull();
    await session.sync({ ids: [target!.id], activeId: target!.id, visible: true });
    const other = document.createElement('h1');
    other.id = 'heading';
    document.body.append(other);
    vi.mocked(document.elementFromPoint).mockReturnValue(other);
    const secondPick = session.pick();
    root!.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const second = await secondPick;
    expect(second).toMatchObject({ selector: '#heading' });
    expect(second!.id).not.toBe(target!.id);
    await session.sync({ ids: [target!.id, second!.id], activeId: second!.id, visible: true });
    await session.cancel();
    expect(await session.anchor(target!.id)).not.toBeNull();
    expect(await session.anchor(second!.id)).not.toBeNull();
    const capture = vi.fn(async () => screenshot);
    await session.sync({ ids: [target!.id, second!.id], visible: false });
    expect(await session.captureScreenshots([target!.id, second!.id], capture)).toEqual([screenshot, screenshot]);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(await session.anchor(target!.id)).not.toBeNull();
    expect(await session.anchor(second!.id)).not.toBeNull();
    const repeatedPick = session.pick();
    root!.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect((await repeatedPick)?.id).toBe(second!.id);
    await session.sync({ ids: [], activeId: null, visible: true });
    expect(await session.anchor(target!.id)).toBeNull();
    expect(await session.captureScreenshots([target!.id], capture)).toBeNull();
    expect(capture).toHaveBeenCalledTimes(2);
    const freshPick = session.pick();
    root!.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect((await freshPick)?.id).not.toBe(second!.id);
    contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(second);
    await expect(session.pick()).rejects.toThrow('Invalid browser annotation selection.');
    session.dispose();
  });

  it('cancels a pending selection on Escape and releases pending requests on disposal', async () => {
    const { session } = fixture();
    const first = session.pick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(await first).toBeNull();
    const next = session.pick();
    session.dispose();
    expect(await next).toBeNull();
  });

  it('ignores an old page result after navigation even when script completion is delayed', async () => {
    let complete: (value: unknown) => void = () => undefined;
    const { session, contents } = fixture();
    contents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const selection = session.pick();
    session.dispose();
    expect(await selection).toBeNull();
    complete({ selector: '#old-page' });
    await Promise.resolve();
    expect(contents.hostWebContents.focus).not.toHaveBeenCalled();
  });

  it('ignores pre-aborted picks and does not let an old signal cancel a newer pick', async () => {
    const { session, contents } = fixture();
    const aborted = new AbortController();
    aborted.abort();
    expect(await session.pick(aborted.signal)).toBeNull();
    expect(contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();

    const previous = new AbortController();
    const first = session.pick(previous.signal);
    const next = session.pick();
    previous.abort();
    expect(await first).toBeNull();
    expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(await next).toBeNull();
  });

  it('discards a captured image if its page navigates before capture finishes', async () => {
    const { session, contents } = fixture();
    const pick = session.pick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await pick;
    contents.executeJavaScriptInIsolatedWorld.mockResolvedValue(true);
    let finishCapture: (value: DesktopBrowserScreenshot) => void = () => undefined;
    const capture = vi.fn(() => new Promise<DesktopBrowserScreenshot>((resolve) => { finishCapture = resolve; }));
    const pending = session.captureScreenshots(['27f0b1c9-8c70-452e-8cce-2dd7e029f084'], capture);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
    session.dispose();
    finishCapture(screenshot);
    expect(await pending).toBeNull();
  });

  it.each([false, true])('reveals targets clipped inside nested scrollers and restores the batch starting positions (capture failure: %s)', async (failCapture) => {
    const outer = document.createElement('div');
    const host = document.createElement('div');
    outer.append(host);
    document.body.append(outer);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    shadow.append(inner);
    const buttons = [document.createElement('button'), document.createElement('button')];
    inner.append(...buttons);
    outer.style.overflow = inner.style.overflow = 'auto';
    const initial = [outer, inner].map((scroller, index) => {
      scroller.scrollTop = 20 + index * 10;
      scroller.scrollLeft = 5 + index * 10;
      return { left: scroller.scrollLeft, top: scroller.scrollTop };
    });
    const attach = Element.prototype.attachShadow;
    let overlay!: ShadowRoot;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, options) {
      overlay = attach.call(this, options);
      return overlay;
    });
    const hitTest = vi.spyOn(document, 'elementFromPoint');
    const { session } = fixture();
    const ids: string[] = [];
    for (const [index, button] of buttons.entries()) {
      // Still inside the top-level viewport, although its own scrollers have hidden it.
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 40, 20));
      vi.spyOn(button, 'scrollIntoView').mockImplementation(() => {
        outer.scrollTop = 200 + index;
        inner.scrollLeft = 100 + index;
      });
      hitTest.mockReturnValue(button);
      const pick = session.pick();
      overlay.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      ids.push((await pick)!.id);
    }
    let captured = 0;
    const capture = vi.fn(async () => {
      expect(outer.scrollTop).toBe(200 + captured);
      expect(inner.scrollLeft).toBe(100 + captured);
      captured++;
      if (failCapture && captured === 2) throw new Error('Capture failed');
      return screenshot;
    });
    const pending = session.captureScreenshots(ids, capture);
    if (failCapture) await expect(pending).rejects.toThrow('Capture failed');
    else expect(await pending).toEqual([screenshot, screenshot]);
    expect(captured).toBe(2);
    expect([outer, inner].map((scroller) => ({ left: scroller.scrollLeft, top: scroller.scrollTop }))).toEqual(initial);
  });

  it('bounds marker requests and rejects script-shaped or oversized inputs', () => {
    expect(parseAnnotationMarkers({ visible: true, ids: ['");alert(1);//'] })).toBeNull();
    expect(parseAnnotationMarkers({ visible: true, ids: Array(21).fill('a'.repeat(36)) })).toBeNull();
    expect(parseAnnotationMarkers({ visible: 'true', ids: [] })).toBeNull();
    expect(parseAnnotationMarkers({ visible: true, ids: [], activeId: 'unknown-selection' })).toBeNull();
  });
});

describe('annotation element context', () => {
  it('locates repeated direct children through nested shadow roots using the serialized reader', () => {
    const host = document.createElement('div');
    host.id = 'host';
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<section></section><span></span><section></section>';
    const inner = root.querySelectorAll('section')[1].attachShadow({ mode: 'open' });
    inner.innerHTML = '<button class="action">First</button><span>Label</span><button class="action">Second</button>';
    const selected = inner.querySelectorAll('button')[1];
    const read = new Function(`return (${readAnnotationElement.toString()})`)() as typeof readAnnotationElement;
    const path = read(selected, 'annotation-id').selector.split(' >>> ');
    let located = document.querySelector(path[0]);
    for (const selector of path.slice(1)) located = located?.shadowRoot?.querySelector(selector) ?? null;
    expect(located).toBe(selected);
  });

  it('identifies duplicate siblings and open shadow roots without collecting form or editable data', () => {
    const container = document.createElement('div');
    container.id = 'form';
    container.innerHTML = '<button>First</button><button><span>Second</span></button><input value="secret"><textarea>private</textarea><div contenteditable="true">hidden draft</div>';
    document.body.append(container);
    const second = container.querySelectorAll('button')[1];
    expect(document.querySelector(readAnnotationElement(second, 'id').selector)).toBe(second);
    expect(readAnnotationElement(container, 'id').text).toBe('First Second');
    expect(readAnnotationElement(container.querySelector('textarea')!, 'id').text).toBe('');
    const shadow = container.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button id="inside">Shadow action</button>';
    expect(readAnnotationElement(shadow.firstElementChild!, 'id').selector).toBe('#form >>> #inside');
  });
});
