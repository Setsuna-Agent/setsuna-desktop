import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { describe, expect, it } from 'vitest';
import type {
  BrowserAutomation,
  BrowserAutomationSnapshot,
  BrowserDebuggerTransport,
  BrowserKeyOptions,
  BrowserTypeOptions,
} from './browser-cdp-automation.js';
import { DesktopBrowserController } from './browser-control.js';

class FakeAutomation implements BrowserAutomation {
  readonly calls: string[] = [];
  disposed = false;
  invalidated = 0;

  constructor(private readonly name = 'Inbox row') {}

  async snapshot(revision: number, _maxElements: number): Promise<BrowserAutomationSnapshot> {
    this.calls.push(`snapshot:${revision}`);
    return {
      elements: [{
        bounds: { height: 40, width: 400, x: 10, y: 50 },
        clickable: false,
        name: this.name,
        ref: `s${revision}:t0:n4`,
        role: 'text',
        tag: 'div',
      }],
      text: `${this.name} page`,
    };
  }

  async click(ref: string): Promise<string> {
    this.calls.push(`click:${ref}`);
    return `clicked ${ref}`;
  }

  async type(ref: string, options: BrowserTypeOptions): Promise<string> {
    this.calls.push(`type:${ref}:${options.text.length}`);
    return `typed ${ref}`;
  }

  async scroll(ref: string | undefined, deltaY: number): Promise<string> {
    this.calls.push(`scroll:${ref ?? 'page'}:${deltaY}`);
    return `scrolled ${deltaY}`;
  }

  async key(options: BrowserKeyOptions): Promise<string> {
    this.calls.push(`key:${options.key}:${options.repeat}`);
    return `pressed ${options.key}`;
  }

  async hasText(text: string): Promise<boolean> {
    this.calls.push(`has-text:${text}`);
    return text === this.name;
  }

  invalidate(): void {
    this.invalidated += 1;
  }

  dispose(): void {
    this.disposed = true;
  }
}

class FakeWebContents extends EventEmitter {
  readonly debugger = new FakeBrowserDebugger();
  deviceEmulation: unknown = null;
  userAgent = 'Desktop Chrome/140.0.0.0';
  readonly session = { getUserAgent: () => 'Desktop Chrome/140.0.0.0' };
  private destroyed = false;
  private loading = false;
  private title = 'Example';
  private url = 'https://example.com/';

  constructor(readonly id: number) {
    super();
  }

  getTitle(): string { return this.title; }
  getURL(): string { return this.url; }
  isDestroyed(): boolean { return this.destroyed; }
  isLoading(): boolean { return this.loading; }

  disableDeviceEmulation(): void {
    this.deviceEmulation = null;
  }

  enableDeviceEmulation(parameters: unknown): void {
    this.deviceEmulation = parameters;
  }

  setUserAgent(userAgent: string): void {
    this.userAgent = userAgent;
  }

  async loadURL(url: string): Promise<void> {
    this.emit('did-start-navigation');
    this.url = url;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

class FakeBrowserDebugger extends EventEmitter implements BrowserDebuggerTransport {
  attached = false;
  readonly commands: Array<{ method: string; params?: unknown }> = [];

  attach(): void {
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.emit('detach');
  }

  isAttached(): boolean {
    return this.attached;
  }

  async sendCommand(method: string, params?: unknown): Promise<unknown> {
    this.commands.push({ method, params });
    return {};
  }
}

function asWebContents(value: FakeWebContents): WebContents {
  return value as unknown as WebContents;
}

describe('DesktopBrowserController', () => {
  it('asks the renderer to open a tab and waits until its guest is registered', async () => {
    let controller: DesktopBrowserController;
    controller = new DesktopBrowserController({
      createAutomation: () => new FakeAutomation(),
      openTab: async (url) => {
        expect(url).toBe('https://example.com/docs');
        queueMicrotask(() => controller.registerTab('new-tab', asWebContents(new FakeWebContents(9))));
        return true;
      },
    });

    await expect(controller.execute({ kind: 'open', url: 'example.com/docs' })).resolves.toEqual({
      kind: 'action',
      message: 'Opened https://example.com/docs in a new side-browser tab.',
      tabId: 'new-tab',
      url: 'https://example.com/docs',
    });
  });

  it('lists registered tabs, tracks the active tab, and disposes destroyed sessions', async () => {
    const automations = new Map<number, FakeAutomation>();
    const controller = new DesktopBrowserController({
      createAutomation: (contents) => {
        const automation = new FakeAutomation();
        automations.set(contents.id, automation);
        return automation;
      },
    });
    const first = new FakeWebContents(10);
    const second = new FakeWebContents(11);
    controller.registerTab('tab-1', asWebContents(first));
    controller.registerTab('tab-2', asWebContents(second));
    controller.setActiveTab('tab-2');

    await expect(controller.execute({ kind: 'tabs' })).resolves.toMatchObject({
      tabs: [
        { active: false, id: 'tab-1', url: 'https://example.com/' },
        { active: true, id: 'tab-2', url: 'https://example.com/' },
      ],
    });

    second.destroy();
    expect(automations.get(11)?.disposed).toBe(true);
    await expect(controller.execute({ kind: 'tabs' })).resolves.toMatchObject({
      tabs: [{ active: true, id: 'tab-1' }],
    });
  });

  it('applies validated device emulation and mobile request identity to the registered guest', async () => {
    const contents = new FakeWebContents(12);
    const controller = new DesktopBrowserController({ createAutomation: () => new FakeAutomation() });
    controller.registerTab('tab-1', asWebContents(contents));

    await expect(controller.setDeviceEmulation('tab-1', {
      deviceScaleFactor: 3,
      height: 852,
      mobile: true,
      scale: 0.75,
      userAgentProfile: 'ios-phone',
      width: 393,
    })).resolves.toBe(true);
    expect(contents.deviceEmulation).toEqual({
      deviceScaleFactor: 3,
      scale: 0.75,
      screenPosition: 'mobile',
      screenSize: { height: 852, width: 393 },
      viewPosition: { x: 0, y: 0 },
      viewSize: { height: 852, width: 393 },
    });
    expect(contents.userAgent).toContain('iPhone');
    expect(contents.debugger.commands).toContainEqual({
      method: 'Emulation.setUserAgentOverride',
      params: expect.objectContaining({ platform: 'iPhone', userAgent: expect.stringContaining('iPhone') }),
    });
    expect(contents.debugger.commands).toContainEqual({
      method: 'Emulation.setTouchEmulationEnabled',
      params: { enabled: true, maxTouchPoints: 5 },
    });
    await expect(controller.setDeviceEmulation('tab-1', {
      deviceScaleFactor: 3,
      height: 852,
      mobile: true,
      scale: 0.75,
      userAgentProfile: 'ios-phone',
      width: 100,
    })).resolves.toBe(false);
    await expect(controller.setDeviceEmulation('tab-1', null)).resolves.toBe(true);
    expect(contents.deviceEmulation).toBeNull();
    expect(contents.userAgent).toBe('Desktop Chrome/140.0.0.0');
    expect(contents.debugger.commands).toContainEqual({
      method: 'Emulation.setUserAgentOverride',
      params: { userAgent: '' },
    });
  });

  it('invalidates old snapshot refs and routes real-input commands through the tab adapter', async () => {
    const automation = new FakeAutomation('Mail subject');
    const contents = new FakeWebContents(20);
    const controller = new DesktopBrowserController({ createAutomation: () => automation });
    controller.registerTab('tab-1', asWebContents(contents));

    await expect(controller.execute({ kind: 'snapshot', maxElements: 10 })).resolves.toMatchObject({
      elements: [{ name: 'Mail subject', ref: 's1:t0:n4', role: 'text' }],
      kind: 'snapshot',
      tabId: 'tab-1',
    });
    await expect(controller.execute({ kind: 'click', ref: 's1:t0:n4' })).resolves.toMatchObject({
      message: 'clicked s1:t0:n4',
    });
    await expect(controller.execute({ kind: 'type', ref: 's1:t0:n4', text: 'hello' })).resolves.toMatchObject({
      message: 'typed s1:t0:n4',
    });
    await expect(controller.execute({ deltaY: 700, kind: 'scroll' })).resolves.toMatchObject({
      message: 'scrolled 700',
    });
    await expect(controller.execute({ key: 'Tab', kind: 'key', repeat: 2 })).resolves.toMatchObject({
      message: 'pressed Tab',
    });
    await expect(controller.execute({ kind: 'wait', text: 'Mail subject', timeoutMs: 0 })).resolves.toMatchObject({
      matched: true,
    });

    await controller.execute({ kind: 'snapshot' });
    await expect(controller.execute({ kind: 'click', ref: 's1:t0:n4' })).rejects.toThrow('is stale');
    await controller.execute({ kind: 'navigate', url: 'example.org' });
    expect(automation.invalidated).toBeGreaterThanOrEqual(1);
    await expect(controller.execute({ kind: 'navigate', url: 'javascript:alert(1)' })).rejects.toThrow(
      'Unsupported browser URL protocol',
    );
    expect(automation.calls).toEqual(expect.arrayContaining([
      'click:s1:t0:n4',
      'type:s1:t0:n4:5',
      'scroll:page:700',
      'key:Tab:2',
      'has-text:Mail subject',
    ]));
  });
});
