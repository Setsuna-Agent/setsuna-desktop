import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  ElectronBrowserCdpAutomation,
  type BrowserDebuggerTransport,
} from './browser-cdp-automation.js';
import {
  extractCdpPageObservation,
  type CdpAccessibilityResponse,
  type CdpSnapshotResponse,
} from './browser-cdp-snapshot.js';

class SnapshotFixture {
  readonly strings: string[] = [];
  private readonly indexes = new Map<string, number>();

  string(value: string): number {
    const existing = this.indexes.get(value);
    if (existing !== undefined) return existing;
    const index = this.strings.length;
    this.strings.push(value);
    this.indexes.set(value, index);
    return index;
  }

  snapshot(options: { clicked?: boolean; inputValue?: string; scrolled?: boolean } = {}): CdpSnapshotResponse {
    const s = (value: string) => this.string(value);
    const rowText = options.clicked ? 'Opened mail' : 'Inbox subject';
    const rowY = options.scrolled ? 20 : 60;
    const style = [s('visible'), s('1'), s('auto'), s('default')];
    const pointerStyle = [s('visible'), s('1'), s('auto'), s('pointer')];
    return {
      documents: [{
        contentHeight: 1200,
        contentWidth: 800,
        documentURL: s('https://mail.example.com/'),
        frameId: s('frame-main'),
        layout: {
          bounds: [
            [10, rowY, 500, 40],
            [20, rowY + 10, 220, 20],
            [10, 10, 100, 30],
            [20, 15, 80, 20],
            [550, 10, 220, 32],
          ],
          nodeIndex: [3, 4, 5, 6, 7],
          paintOrders: [1, 2, 3, 4, 5],
          styles: [style, style, pointerStyle, pointerStyle, style],
          text: [s(''), s(rowText), s(''), s('Open'), s('')],
        },
        nodes: {
          attributes: [
            [], [], [],
            [s('class'), s('mail-row')],
            [],
            [s('role'), s('button')],
            [],
            [s('type'), s('text'), s('placeholder'), s('Search mail')],
          ],
          backendNodeId: [1, 2, 3, 4, 5, 6, 7, 8],
          inputValue: { index: [7], value: [s(options.inputValue ?? '')] },
          isClickable: { index: [5], value: [true] },
          nodeName: [s('#document'), s('HTML'), s('BODY'), s('DIV'), s('#text'), s('BUTTON'), s('#text'), s('INPUT')],
          nodeType: [9, 1, 1, 1, 3, 1, 3, 1],
          nodeValue: [s(''), s(''), s(''), s(''), s(rowText), s(''), s('Open'), s('')],
          parentIndex: [-1, 0, 1, 2, 3, 2, 5, 2],
        },
        scrollOffsetX: 0,
        scrollOffsetY: options.scrolled ? 40 : 0,
        title: s('Mail'),
      }],
      strings: this.strings,
    };
  }

  accessibility(): CdpAccessibilityResponse {
    return {
      nodes: [
        { backendDOMNodeId: 6, ignored: false, name: { value: 'Open' }, role: { value: 'button' } },
        {
          backendDOMNodeId: 8,
          ignored: false,
          name: { value: 'Search mail' },
          properties: [{ name: 'focusable', value: { value: true } }],
          role: { value: 'textbox' },
        },
      ],
    };
  }
}

class FakeDebuggerTransport extends EventEmitter implements BrowserDebuggerTransport {
  readonly calls: Array<{ method: string; params: unknown; sessionId?: string }> = [];
  private attached = false;
  private clicked = false;
  private inputValue = '';
  private scrolled = false;

  constructor(
    private readonly fixture: SnapshotFixture,
    private readonly rejectChildAutoAttach = false,
  ) {
    super();
  }

  attach(): void { this.attached = true; }
  detach(): void { this.attached = false; }
  isAttached(): boolean { return this.attached; }

  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  override off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  async sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    this.calls.push({ method, params, sessionId });
    if (method === 'Target.setAutoAttach' && sessionId && this.rejectChildAutoAttach) {
      throw new Error('Target domain is unavailable in child session');
    }
    if (method === 'DOMSnapshot.captureSnapshot') {
      return this.fixture.snapshot({ clicked: this.clicked, inputValue: this.inputValue, scrolled: this.scrolled });
    }
    if (method === 'Accessibility.getFullAXTree') return this.fixture.accessibility();
    if (method === 'Page.getLayoutMetrics') {
      return { cssVisualViewport: { clientHeight: 600, clientWidth: 800 } };
    }
    if (method === 'DOM.getContentQuads') {
      return { quads: [[10, 60, 510, 60, 510, 100, 10, 100]] };
    }
    if (method === 'Input.dispatchMouseEvent') {
      const input = params as { type?: string };
      if (input.type === 'mouseReleased') this.clicked = true;
      if (input.type === 'mouseWheel') this.scrolled = true;
    }
    if (method === 'Input.insertText') this.inputValue = String((params as { text?: unknown }).text ?? '');
    return {};
  }
}

describe('extractCdpPageObservation', () => {
  it('keeps semantic controls and ordinary visible text nodes used by delegated SPA handlers', () => {
    const fixture = new SnapshotFixture();
    const observation = extractCdpPageObservation(
      fixture.snapshot(),
      fixture.accessibility(),
      { height: 600, width: 800 },
    );

    expect(observation.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ backendNodeId: 4, name: 'Inbox subject', role: 'text', tag: 'div' }),
      expect.objectContaining({ backendNodeId: 6, clickable: true, name: 'Open', role: 'button' }),
      expect.objectContaining({ backendNodeId: 8, name: 'Search mail', role: 'textbox' }),
    ]));
    expect(observation.text).toContain('Inbox subject');
  });
});

describe('ElectronBrowserCdpAutomation', () => {
  it('attaches lazily and dispatches real pointer, wheel, text, and keyboard input', async () => {
    const fixture = new SnapshotFixture();
    const transport = new FakeDebuggerTransport(fixture);
    const automation = new ElectronBrowserCdpAutomation(transport);

    const snapshot = await automation.snapshot(1, 20);
    const row = snapshot.elements.find((element) => element.name === 'Inbox subject');
    const input = snapshot.elements.find((element) => element.role === 'textbox');
    expect(row?.ref).toBe('s1:t0:n4');
    expect(input?.ref).toBe('s1:t0:n8');

    await expect(automation.click(row!.ref)).resolves.toContain('visible page state changed');
    await expect(automation.type(input!.ref, { clear: true, submit: false, text: 'query' })).resolves.toContain(
      'Typed 5 characters',
    );
    await expect(automation.scroll(undefined, 600)).resolves.toContain('real wheel event');
    await expect(automation.key({ key: 'Tab', modifiers: ['Shift'], repeat: 2 })).resolves.toContain('Shift+Tab');
    await expect(automation.hasText('Opened mail')).resolves.toBe(true);

    expect(transport.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'Target.setAutoAttach' }),
      expect.objectContaining({ method: 'DOM.getContentQuads' }),
      expect.objectContaining({ method: 'DOM.focus' }),
      expect.objectContaining({ method: 'Input.insertText' }),
      expect.objectContaining({ method: 'Input.dispatchKeyEvent' }),
      expect.objectContaining({ method: 'Input.dispatchMouseEvent' }),
    ]));
    automation.dispose();
    expect(transport.isAttached()).toBe(false);
  });

  it('keeps an attached OOPIF target when recursive auto-attach is unavailable', async () => {
    const fixture = new SnapshotFixture();
    const transport = new FakeDebuggerTransport(fixture, true);
    const automation = new ElectronBrowserCdpAutomation(transport);
    await automation.snapshot(1, 10);

    transport.emit('message', {}, 'Target.attachedToTarget', {
      sessionId: 'child-session',
      targetInfo: { type: 'iframe', url: 'https://frame.example.com/' },
    }, '');
    await Promise.resolve();
    const snapshot = await automation.snapshot(2, 20);

    expect(snapshot.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 's2:t1:n4' }),
    ]));
    expect(transport.calls).toContainEqual(expect.objectContaining({
      method: 'DOMSnapshot.captureSnapshot',
      sessionId: 'child-session',
    }));
    automation.dispose();
  });
});
