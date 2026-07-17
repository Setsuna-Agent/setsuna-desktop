import type { WebContents } from 'electron';
import type {
  DesktopBrowserControlCommand,
  DesktopBrowserControlResult,
  DesktopBrowserDeviceEmulation,
  DesktopBrowserDeviceUserAgentProfile,
  DesktopBrowserKeyModifier,
  DesktopBrowserScreenshot,
  DesktopBrowserTab,
} from '@setsuna-desktop/contracts';
import {
  ElectronBrowserCdpAutomation,
  type BrowserAutomation,
  type BrowserDebuggerTransport,
} from './browser-cdp-automation.js';
import {
  ElectronBrowserCdpDeviceEmulator,
  resolveBrowserUserAgentOverride,
  type BrowserDeviceEmulator,
} from './browser-cdp-device-emulation.js';

type RegisteredBrowserTab = {
  automation: BrowserAutomation;
  contents: WebContents;
  defaultUserAgent: string;
  deviceEmulator: BrowserDeviceEmulator;
  destroyedListener: () => void;
  navigationListener: () => void;
};

const desktopBrowserDeviceUserAgentProfiles = new Set<DesktopBrowserDeviceUserAgentProfile>([
  'android-phone',
  'desktop',
  'ios-phone',
  'ios-tablet',
  'windows-desktop',
]);

export type BrowserControlExecutor = {
  execute(command: DesktopBrowserControlCommand, signal?: AbortSignal): Promise<DesktopBrowserControlResult>;
};

/** 维护渲染进程标签页 ID 到 Electron 来宾 WebContents 的可信映射。 */
export class DesktopBrowserController implements BrowserControlExecutor {
  private activeTabId: string | null = null;
  private readonly createAutomation: (contents: WebContents) => BrowserAutomation;
  private readonly createDeviceEmulator: (contents: WebContents) => BrowserDeviceEmulator;
  private readonly openTab: ((url: string) => boolean | Promise<boolean>) | null;
  private readonly snapshotRevisions = new Map<string, number>();
  private readonly tabs = new Map<string, RegisteredBrowserTab>();

  constructor(options: {
    createAutomation?: (contents: WebContents) => BrowserAutomation;
    createDeviceEmulator?: (contents: WebContents) => BrowserDeviceEmulator;
    openTab?: (url: string) => boolean | Promise<boolean>;
  } = {}) {
    this.createAutomation = options.createAutomation ?? ((contents) =>
      new ElectronBrowserCdpAutomation(contents.debugger as unknown as BrowserDebuggerTransport));
    this.createDeviceEmulator = options.createDeviceEmulator ?? ((contents) =>
      new ElectronBrowserCdpDeviceEmulator(contents.debugger as unknown as BrowserDebuggerTransport));
    this.openTab = options.openTab ?? null;
  }

  registerTab(tabId: string, contents: WebContents): void {
    const normalizedTabId = normalizeTabId(tabId);
    const current = this.tabs.get(normalizedTabId);
    if (current?.contents.id === contents.id && !contents.isDestroyed()) return;
    this.unregisterTab(normalizedTabId);
    for (const [existingId, entry] of this.tabs) {
      if (entry.contents.id === contents.id) this.unregisterTab(existingId, contents.id);
    }
    const automation = this.createAutomation(contents);
    const deviceEmulator = this.createDeviceEmulator(contents);
    const defaultUserAgent = contents.session.getUserAgent();
    const destroyedListener = () => this.unregisterTab(normalizedTabId, contents.id);
    const navigationListener = () => {
      this.snapshotRevisions.set(normalizedTabId, (this.snapshotRevisions.get(normalizedTabId) ?? 0) + 1);
      automation.invalidate();
    };
    contents.once('destroyed', destroyedListener);
    contents.on('did-start-navigation', navigationListener);
    this.tabs.set(normalizedTabId, {
      automation,
      contents,
      defaultUserAgent,
      deviceEmulator,
      destroyedListener,
      navigationListener,
    });
    this.snapshotRevisions.set(normalizedTabId, 0);
  }

  unregisterTab(tabId: string, expectedWebContentsId?: number): void {
    const entry = this.tabs.get(tabId);
    if (!entry || (expectedWebContentsId !== undefined && entry.contents.id !== expectedWebContentsId)) return;
    entry.contents.off('destroyed', entry.destroyedListener);
    entry.contents.off('did-start-navigation', entry.navigationListener);
    entry.automation.dispose();
    entry.deviceEmulator.dispose();
    this.tabs.delete(tabId);
    this.snapshotRevisions.delete(tabId);
    if (this.activeTabId === tabId) this.activeTabId = null;
  }

  setActiveTab(tabId: string | null): void {
    this.activeTabId = tabId ? normalizeTabId(tabId) : null;
  }

  async captureScreenshot(tabId: string): Promise<DesktopBrowserScreenshot | null> {
    let entry: RegisteredBrowserTab | undefined;
    try {
      entry = this.tabs.get(normalizeTabId(tabId));
    } catch {
      return null;
    }
    if (!entry || entry.contents.isDestroyed()) return null;

    return captureBrowserScreenshot(entry.contents);
  }

  async setDeviceEmulation(tabId: string, emulation: DesktopBrowserDeviceEmulation | null): Promise<boolean> {
    let entry: RegisteredBrowserTab | undefined;
    try {
      entry = this.tabs.get(normalizeTabId(tabId));
    } catch {
      return false;
    }
    if (!entry || entry.contents.isDestroyed()) return false;
    try {
      if (emulation === null) {
        entry.contents.disableDeviceEmulation();
        entry.contents.setUserAgent(entry.defaultUserAgent);
        await entry.deviceEmulator.apply(null);
        return true;
      }
      const normalized = normalizeDeviceEmulation(emulation);
      if (!normalized) return false;
      const userAgent = resolveBrowserUserAgentOverride(normalized.userAgentProfile, entry.defaultUserAgent);
      entry.contents.setUserAgent(userAgent?.userAgent ?? entry.defaultUserAgent);
      entry.contents.enableDeviceEmulation({
        deviceScaleFactor: normalized.deviceScaleFactor,
        scale: normalized.scale,
        screenPosition: normalized.mobile ? 'mobile' : 'desktop',
        screenSize: { height: normalized.height, width: normalized.width },
        viewPosition: { x: 0, y: 0 },
        viewSize: { height: normalized.height, width: normalized.width },
      });
      await entry.deviceEmulator.apply({ touch: normalized.mobile, userAgent });
      return true;
    } catch {
      // 应用覆盖配置期间，来宾页面可能会分离，或其 CDP 会话可能会被替换。
      return false;
    }
  }

  clear(): void {
    for (const tabId of [...this.tabs.keys()]) this.unregisterTab(tabId);
    this.activeTabId = null;
  }

  async execute(command: DesktopBrowserControlCommand, signal?: AbortSignal): Promise<DesktopBrowserControlResult> {
    throwIfAborted(signal);
    switch (command.kind) {
      case 'open':
        return this.open(command.url, signal);
      case 'tabs':
        return { kind: 'tabs', tabs: this.listTabs() };
      case 'snapshot':
        return this.snapshot(command.tabId, command.maxElements, signal);
      case 'screenshot':
        return this.screenshot(command.tabId, signal);
      case 'click':
        return this.click(command.tabId, command.ref, signal);
      case 'type':
        return this.type(command.tabId, command.ref, normalizeTextInput(command.text), command.clear, command.submit, signal);
      case 'scroll':
        return this.scroll(command.tabId, command.ref, command.deltaY, signal);
      case 'key':
        return this.key(command.tabId, command.key, command.modifiers, command.repeat, signal);
      case 'navigate':
        return this.navigate(command.tabId, command.url, signal);
      case 'wait':
        return this.wait(command.tabId, command.text, command.timeoutMs, signal);
    }
  }

  private listTabs(): DesktopBrowserTab[] {
    this.removeDestroyedTabs();
    const activeId = this.activeTabId && this.tabs.has(this.activeTabId)
      ? this.activeTabId
      : this.tabs.keys().next().value as string | undefined;
    return [...this.tabs].map(([id, { contents }]) => ({
      active: id === activeId,
      id,
      loading: contents.isLoading(),
      title: contents.getTitle() || browserHostLabel(contents.getURL()),
      url: contents.getURL(),
    }));
  }

  private async open(rawUrl: string, signal?: AbortSignal): Promise<DesktopBrowserControlResult> {
    if (!this.openTab) throw new Error('The desktop renderer cannot open browser tabs.');
    const url = normalizeBrowserUrl(rawUrl);
    this.removeDestroyedTabs();
    const existingTabIds = new Set(this.tabs.keys());
    if (!await this.openTab(url)) throw new Error('The desktop renderer is not available to open a browser tab.');
    const deadline = Date.now() + 10_000;
    do {
      throwIfAborted(signal);
      this.removeDestroyedTabs();
      const openedTab = [...this.tabs].find(([tabId]) => !existingTabIds.has(tabId));
      if (openedTab) {
        const [tabId] = openedTab;
        this.activeTabId = tabId;
        return { kind: 'action', message: `Opened ${url} in a new side-browser tab.`, tabId, url };
      }
      await abortableDelay(Math.min(50, deadline - Date.now()), signal);
    } while (Date.now() < deadline);
    throw new Error('Timed out waiting for the new browser tab to attach.');
  }

  private async snapshot(
    requestedTabId: string | undefined,
    requestedMaxElements: number | undefined,
    signal?: AbortSignal,
  ): Promise<DesktopBrowserControlResult> {
    const [tabId, entry] = this.resolveTab(requestedTabId);
    const { contents } = entry;
    const maxElements = clampInteger(requestedMaxElements ?? 150, 1, 300);
    const revision = (this.snapshotRevisions.get(tabId) ?? 0) + 1;
    this.snapshotRevisions.set(tabId, revision);
    const snapshot = await entry.automation.snapshot(revision, maxElements, signal);
    return {
      elements: snapshot.elements,
      kind: 'snapshot',
      tabId,
      text: snapshot.text,
      title: contents.getTitle() || browserHostLabel(contents.getURL()),
      url: contents.getURL(),
    };
  }

  private async screenshot(
    requestedTabId: string | undefined,
    signal?: AbortSignal,
  ): Promise<DesktopBrowserControlResult> {
    const [tabId, entry] = this.resolveTab(requestedTabId);
    throwIfAborted(signal);
    const screenshot = await captureBrowserScreenshot(entry.contents);
    throwIfAborted(signal);
    if (!screenshot) throw new Error('The browser page could not be captured.');
    return {
      ...screenshot,
      kind: 'screenshot',
      tabId,
      title: entry.contents.getTitle() || browserHostLabel(entry.contents.getURL()),
      url: entry.contents.getURL(),
    };
  }

  private async click(
    requestedTabId: string | undefined,
    ref: string,
    signal?: AbortSignal,
  ): Promise<DesktopBrowserControlResult> {
    const [tabId, entry] = this.resolveTab(requestedTabId);
    assertCurrentSnapshotRef(this.snapshotRevisions, tabId, ref);
    throwIfAborted(signal);
    const message = await entry.automation.click(ref, signal);
    return { kind: 'action', message, tabId, url: entry.contents.getURL() };
  }

  private async type(
    requestedTabId: string | undefined,
    ref: string,
    text: string,
    clear: boolean | undefined,
    submit: boolean | undefined,
    signal?: AbortSignal,
  ): Promise<DesktopBrowserControlResult> {
    const [tabId, entry] = this.resolveTab(requestedTabId);
    assertCurrentSnapshotRef(this.snapshotRevisions, tabId, ref);
    const message = await entry.automation.type(ref, {
      clear: clear ?? true,
      submit: submit ?? false,
      text,
    }, signal);
    return { kind: 'action', message, tabId, url: entry.contents.getURL() };
  }

  private async scroll(
    requestedTabId: string | undefined,
    ref: string | undefined,
    requestedDeltaY: number | undefined,
    signal?: AbortSignal,
  ): Promise<DesktopBrowserControlResult> {
    const [tabId, entry] = this.resolveTab(requestedTabId);
    if (ref) assertCurrentSnapshotRef(this.snapshotRevisions, tabId, ref);
    const deltaY = clampInteger(requestedDeltaY ?? 600, -4_000, 4_000);
    throwIfAborted(signal);
    const message = await entry.automation.scroll(ref, deltaY, signal);
    return { kind: 'action', message, tabId, url: entry.contents.getURL() };
  }

  private async key(
    requestedTabId: string | undefined,
    rawKey: string,
    rawModifiers: DesktopBrowserKeyModifier[] | undefined,
    requestedRepeat: number | undefined,
    signal?: AbortSignal,
  ): Promise<DesktopBrowserControlResult> {
    const [tabId, entry] = this.resolveTab(requestedTabId);
    const message = await entry.automation.key({
      key: normalizeBrowserKey(rawKey),
      modifiers: normalizeKeyModifiers(rawModifiers),
      repeat: clampInteger(requestedRepeat ?? 1, 1, 20),
    }, signal);
    return { kind: 'action', message, tabId, url: entry.contents.getURL() };
  }

  private async navigate(
    requestedTabId: string | undefined,
    rawUrl: string,
    signal?: AbortSignal,
  ): Promise<DesktopBrowserControlResult> {
    const [tabId, entry] = this.resolveTab(requestedTabId);
    const { contents } = entry;
    const url = normalizeBrowserUrl(rawUrl);
    this.snapshotRevisions.set(tabId, (this.snapshotRevisions.get(tabId) ?? 0) + 1);
    entry.automation.invalidate();
    throwIfAborted(signal);
    await contents.loadURL(url);
    throwIfAborted(signal);
    return { kind: 'action', message: `Navigated to ${url}.`, tabId, url: contents.getURL() || url };
  }

  private async wait(
    requestedTabId: string | undefined,
    rawText: string | undefined,
    requestedTimeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<DesktopBrowserControlResult> {
    const [tabId, entry] = this.resolveTab(requestedTabId);
    const { contents } = entry;
    const timeoutMs = clampInteger(requestedTimeoutMs ?? 2_000, 0, 10_000);
    const text = rawText?.trim();
    if (!text) {
      await abortableDelay(timeoutMs, signal);
      return { kind: 'wait', matched: true, tabId, url: contents.getURL() };
    }
    if (text.length > 500) throw new Error('Browser wait text is too long.');
    const deadline = Date.now() + timeoutMs;
    do {
      throwIfAborted(signal);
      if (await entry.automation.hasText(text, signal)) {
        return { kind: 'wait', matched: true, tabId, url: contents.getURL() };
      }
      if (Date.now() >= deadline) break;
      await abortableDelay(Math.min(150, deadline - Date.now()), signal);
    } while (Date.now() <= deadline);
    return { kind: 'wait', matched: false, tabId, url: contents.getURL() };
  }

  private resolveTab(requestedTabId?: string): [string, RegisteredBrowserTab] {
    this.removeDestroyedTabs();
    const tabId = requestedTabId
      ? normalizeTabId(requestedTabId)
      : this.activeTabId && this.tabs.has(this.activeTabId)
        ? this.activeTabId
        : this.tabs.keys().next().value as string | undefined;
    if (!tabId) throw new Error('No controllable browser tab is open.');
    const entry = this.tabs.get(tabId);
    if (!entry) throw new Error(`Browser tab ${tabId} is not available.`);
    return [tabId, entry];
  }

  private removeDestroyedTabs(): void {
    for (const [tabId, entry] of this.tabs) {
      if (entry.contents.isDestroyed()) this.unregisterTab(tabId, entry.contents.id);
    }
  }
}

function assertCurrentSnapshotRef(revisions: Map<string, number>, tabId: string, ref: string): void {
  const match = /^s(\d+):t\d+:n\d+$/.exec(ref);
  if (!match) throw new Error(`Invalid browser element reference: ${ref}`);
  if (Number(match[1]) !== revisions.get(tabId)) {
    throw new Error(`Element reference ${ref} is stale. Take a new browser snapshot.`);
  }
}

async function captureBrowserScreenshot(contents: WebContents): Promise<DesktopBrowserScreenshot | null> {
  try {
    const image = await contents.capturePage();
    if (image.isEmpty()) return null;
    const png = image.toPNG();
    if (!png.byteLength) return null;
    const { height, width } = image.getSize();
    return {
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      height,
      mimeType: 'image/png',
      size: png.byteLength,
      width,
    };
  } catch {
    // Chromium 生成位图期间，来宾页面可能会分离。
    return null;
  }
}

function normalizeBrowserKey(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Browser key must be a non-empty string.');
  const key = value === ' ' ? value : value.trim();
  if ([...key].length > 32) throw new Error('Browser key is too long.');
  return key;
}

function normalizeKeyModifiers(values: DesktopBrowserKeyModifier[] | undefined): DesktopBrowserKeyModifier[] {
  if (!values) return [];
  const allowed = new Set<DesktopBrowserKeyModifier>(['Alt', 'Control', 'Meta', 'Shift']);
  for (const value of values) {
    if (!allowed.has(value)) throw new Error(`Unsupported browser key modifier: ${String(value)}`);
  }
  return [...new Set(values)];
}

function normalizeTabId(value: string): string {
  const tabId = value.trim();
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(tabId)) throw new Error('Invalid browser tab ID.');
  return tabId;
}

function normalizeDeviceEmulation(value: DesktopBrowserDeviceEmulation): DesktopBrowserDeviceEmulation | null {
  if (!value || typeof value !== 'object') return null;
  const width = normalizeFiniteNumber(value.width, 240, 5_120, true);
  const height = normalizeFiniteNumber(value.height, 240, 5_120, true);
  const deviceScaleFactor = normalizeFiniteNumber(value.deviceScaleFactor, 0.5, 4, false);
  const scale = normalizeFiniteNumber(value.scale, 0.25, 2, false);
  const userAgentProfile = normalizeDeviceUserAgentProfile(value.userAgentProfile);
  if (width === null || height === null || deviceScaleFactor === null || scale === null || typeof value.mobile !== 'boolean' || !userAgentProfile) return null;
  return { deviceScaleFactor, height, mobile: value.mobile, scale, userAgentProfile, width };
}

function normalizeDeviceUserAgentProfile(value: DesktopBrowserDeviceUserAgentProfile): DesktopBrowserDeviceUserAgentProfile | null {
  return desktopBrowserDeviceUserAgentProfiles.has(value) ? value : null;
}

function normalizeFiniteNumber(value: number, minimum: number, maximum: number, integer: boolean): number | null {
  if (!Number.isFinite(value) || value < minimum || value > maximum) return null;
  return integer ? Math.round(value) : value;
}

function normalizeTextInput(value: string): string {
  if (typeof value !== 'string') throw new Error('Browser text input must be a string.');
  if (value.length > 20_000) throw new Error('Browser text input is too long.');
  return value;
}

function normalizeBrowserUrl(rawUrl: string): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw new Error('Browser URL is required.');
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const url = new URL(candidate);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported browser URL protocol: ${url.protocol}`);
  return url.href;
}

function browserHostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname || 'New tab';
  } catch {
    return 'New tab';
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Browser operation was cancelled.');
}

async function abortableDelay(durationMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (durationMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Browser operation was cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, durationMs);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}
