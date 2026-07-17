import { createHash } from 'node:crypto';
import type {
  DesktopBrowserElement,
  DesktopBrowserKeyModifier,
} from '@setsuna-desktop/contracts';
import {
  browserSnapshotComputedStyles,
  extractCdpPageObservation,
  type CdpAccessibilityResponse,
  type CdpPageObservation,
  type CdpSnapshotResponse,
  type CdpViewport,
} from './browser-cdp-snapshot.js';

export type BrowserAutomationSnapshot = {
  elements: DesktopBrowserElement[];
  text: string;
};

export type BrowserTypeOptions = {
  clear: boolean;
  submit: boolean;
  text: string;
};

export type BrowserKeyOptions = {
  key: string;
  modifiers: DesktopBrowserKeyModifier[];
  repeat: number;
};

export type BrowserAutomation = {
  click(ref: string, signal?: AbortSignal): Promise<string>;
  dispose(): void;
  hasText(text: string, signal?: AbortSignal): Promise<boolean>;
  invalidate(): void;
  key(options: BrowserKeyOptions, signal?: AbortSignal): Promise<string>;
  scroll(ref: string | undefined, deltaY: number, signal?: AbortSignal): Promise<string>;
  snapshot(revision: number, maxElements: number, signal?: AbortSignal): Promise<BrowserAutomationSnapshot>;
  type(ref: string, options: BrowserTypeOptions, signal?: AbortSignal): Promise<string>;
};

export type BrowserDebuggerTransport = {
  attach(protocolVersion?: string): void;
  detach(): void;
  isAttached(): boolean;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  sendCommand(method: string, commandParams?: unknown, sessionId?: string): Promise<unknown>;
};

type CdpTarget = {
  sessionId?: string;
  type: string;
  url: string;
};

type NodeReference = {
  backendNodeId: number;
  bounds?: DesktopBrowserElement['bounds'];
  name: string;
  role: string;
  sessionId?: string;
  tag: string;
};

type TargetCapture = {
  accessibility: CdpAccessibilityResponse;
  observation: CdpPageObservation;
  sessionId?: string;
  snapshot: CdpSnapshotResponse;
  targetIndex: number;
  url: string;
};

type CdpPoint = { x: number; y: number };

const protocolVersion = '1.3';
const scrollProbeRatios: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0.72, 0.5],
  [0.28, 0.5],
  [0.5, 0.72],
  [0.5, 0.28],
];

/**
 * 为浏览器工具所需的有限 CDP 能力提供可信的 Electron 主进程适配器。
 * runtime 桥接层不会暴露原始协议方法或页面脚本。
 */
export class ElectronBrowserCdpAutomation implements BrowserAutomation {
  private attachedByThisInstance = false;
  private attaching: Promise<void> | null = null;
  private readonly childTargets = new Map<string, CdpTarget>();
  private disposed = false;
  private readonly references = new Map<string, NodeReference>();

  private readonly handleDetach = (..._args: unknown[]): void => {
    this.attachedByThisInstance = false;
    this.childTargets.clear();
    this.references.clear();
  };

  private readonly handleMessage = (...args: unknown[]): void => {
    const method = typeof args[1] === 'string' ? args[1] : '';
    const params = objectRecord(args[2]);
    if (method === 'Target.attachedToTarget') {
      const sessionId = stringValue(params.sessionId);
      const targetInfo = objectRecord(params.targetInfo);
      if (!sessionId) return;
      this.childTargets.set(sessionId, {
        sessionId,
        type: stringValue(targetInfo.type) || 'iframe',
        url: stringValue(targetInfo.url),
      });
      this.references.clear();
      // 此框架已经附加。递归自动附加仅作尽力尝试，协议版本不兼容时
      // 也不能移除这个仍可使用的 OOPIF 会话。
      void this.configureAutoAttach(sessionId).catch(() => undefined);
      return;
    }
    if (method === 'Target.detachedFromTarget') {
      const sessionId = stringValue(params.sessionId);
      if (sessionId) this.childTargets.delete(sessionId);
      this.references.clear();
      return;
    }
    if (method === 'Page.frameNavigated' || method === 'Page.frameDetached') this.references.clear();
  };

  constructor(private readonly transport: BrowserDebuggerTransport) {
    transport.on('detach', this.handleDetach);
    transport.on('message', this.handleMessage);
  }

  async snapshot(revision: number, maxElements: number, signal?: AbortSignal): Promise<BrowserAutomationSnapshot> {
    throwIfAborted(signal);
    await this.ensureAttached();
    const captures = await this.captureTargets(signal);
    this.references.clear();

    const candidates = captures.flatMap((capture) => capture.observation.nodes.map((node) => ({ capture, node })));
    candidates.sort((left, right) =>
      right.node.priority - left.node.priority
        || left.capture.targetIndex - right.capture.targetIndex
        || (left.node.bounds?.y ?? 0) - (right.node.bounds?.y ?? 0)
        || (left.node.bounds?.x ?? 0) - (right.node.bounds?.x ?? 0));

    const selected = candidates.slice(0, maxElements);
    const elements = selected.map(({ capture, node }) => {
      const { backendNodeId, frameId: _frameId, priority: _priority, ...element } = node;
      const ref = `s${revision}:t${capture.targetIndex}:n${backendNodeId}`;
      this.references.set(ref, {
        backendNodeId,
        bounds: node.bounds,
        name: node.name,
        role: node.role,
        sessionId: capture.sessionId,
        tag: node.tag,
      });
      return { ...element, ref };
    });

    const text = captures
      .filter((capture) => capture.observation.text)
      .map((capture) => captures.length > 1
        ? `[Frame ${capture.url || capture.targetIndex}]\n${capture.observation.text}`
        : capture.observation.text)
      .join('\n\n')
      .slice(0, 16_000);
    return { elements, text };
  }

  async click(ref: string, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    await this.ensureAttached();
    const reference = this.reference(ref);
    const before = await this.visualFingerprint(signal);
    const point = await this.pointForNode(reference);
    throwIfAborted(signal);
    await this.dispatchMouseClick(point, reference.sessionId);
    await abortableDelay(80, signal);
    const changed = before !== await this.visualFingerprint(signal);
    const label = reference.name || reference.role || reference.tag;
    return `Clicked ${ref} (${label}) using real browser input; ${changed ? 'visible page state changed' : 'no visible state change was detected'}.`;
  }

  async type(ref: string, options: BrowserTypeOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    await this.ensureAttached();
    const reference = this.reference(ref);
    await this.scrollNodeIntoView(reference);
    await this.send('DOM.focus', { backendNodeId: reference.backendNodeId }, reference.sessionId);
    if (options.clear) await this.clearFocusedElement(reference.sessionId, signal);
    throwIfAborted(signal);
    if (options.text) {
      if (reference.tag === 'select' || reference.role === 'combobox' || reference.role === 'listbox') {
        for (const character of options.text) await this.dispatchKey(character, 0, reference.sessionId);
        await this.dispatchKey('Enter', 0, reference.sessionId);
      } else {
        await this.send('Input.insertText', { text: options.text }, reference.sessionId);
      }
    }
    if (options.submit) await this.dispatchKey('Enter', 0, reference.sessionId);
    return `Typed ${options.text.length} character${options.text.length === 1 ? '' : 's'} into ${ref}${options.submit ? ' and submitted' : ''} using browser input.`;
  }

  async scroll(ref: string | undefined, deltaY: number, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    await this.ensureAttached();
    if (ref) {
      const reference = this.reference(ref);
      const before = await this.visualFingerprint(signal);
      await this.scrollNodeIntoView(reference);
      await abortableDelay(60, signal);
      const changed = before !== await this.visualFingerprint(signal);
      return changed ? `Scrolled ${ref} into view.` : `Element ${ref} was already in view.`;
    }
    if (deltaY === 0) throw new Error('Browser scroll distance must not be 0.');

    const viewport = await this.viewport();
    let fingerprint = await this.visualFingerprint(signal);
    for (const [xRatio, yRatio] of scrollProbeRatios) {
      throwIfAborted(signal);
      const point = {
        x: Math.max(1, Math.round(viewport.width * xRatio)),
        y: Math.max(1, Math.round(viewport.height * yRatio)),
      };
      await this.send('Input.dispatchMouseEvent', {
        button: 'none',
        deltaX: 0,
        deltaY,
        type: 'mouseWheel',
        x: point.x,
        y: point.y,
      });
      await abortableDelay(90, signal);
      const nextFingerprint = await this.visualFingerprint(signal);
      if (nextFingerprint !== fingerprint) {
        return `Scrolled by ${deltaY}px with a real wheel event at (${point.x}, ${point.y}); visible page state changed.`;
      }
      fingerprint = nextFingerprint;
    }
    throw new Error('The wheel events did not change visible page state. The page may be at a boundary or require a target ref.');
  }

  async key(options: BrowserKeyOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    await this.ensureAttached();
    const modifiers = modifierMask(options.modifiers);
    for (let index = 0; index < options.repeat; index += 1) {
      throwIfAborted(signal);
      await this.dispatchKey(options.key, modifiers, undefined, index > 0);
    }
    const chord = `${options.modifiers.length ? `${options.modifiers.join('+')}+` : ''}${options.key}`;
    return `Pressed ${chord}${options.repeat > 1 ? ` ${options.repeat} times` : ''} using browser input.`;
  }

  async hasText(text: string, signal?: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    await this.ensureAttached();
    for (const target of this.targets()) {
      try {
        const snapshot = asSnapshotResponse(await this.send('DOMSnapshot.captureSnapshot', {
          computedStyles: [],
          includeDOMRects: false,
          includePaintOrder: false,
        }, target.sessionId));
        if (snapshotText(snapshot).includes(text)) return true;
      } catch (error) {
        if (!isTransientTargetError(error)) throw error;
      }
    }
    return false;
  }

  invalidate(): void {
    this.references.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.references.clear();
    this.childTargets.clear();
    this.transport.off('detach', this.handleDetach);
    this.transport.off('message', this.handleMessage);
    if (this.attachedByThisInstance && this.transport.isAttached()) {
      try {
        this.transport.detach();
      } catch {
        // 目标可能在检查附加状态后、执行分离前已经消失。
      }
    }
    this.attachedByThisInstance = false;
  }

  private async ensureAttached(): Promise<void> {
    if (this.disposed) throw new Error('Browser automation session has been disposed.');
    if (this.transport.isAttached()) return;
    if (!this.attaching) {
      this.attaching = (async () => {
        try {
          this.transport.attach(protocolVersion);
          this.attachedByThisInstance = true;
          await this.configureAutoAttach();
        } catch (error) {
          this.attachedByThisInstance = false;
          throw new Error(`Could not attach browser automation. Close DevTools for this tab and retry. ${errorMessage(error)}`);
        }
      })().finally(() => {
        this.attaching = null;
      });
    }
    await this.attaching;
  }

  private async configureAutoAttach(sessionId?: string): Promise<void> {
    await this.transport.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false,
    }, sessionId);
  }

  private targets(): CdpTarget[] {
    const children = [...this.childTargets.values()].filter((target) =>
      ['iframe', 'page', 'webview'].includes(target.type));
    return [{ type: 'page', url: '' }, ...children];
  }

  private async captureTargets(signal?: AbortSignal): Promise<TargetCapture[]> {
    const targets = this.targets();
    const captures: TargetCapture[] = [];
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      throwIfAborted(signal);
      const target = targets[targetIndex];
      try {
        const capture = await this.captureTarget(target, targetIndex);
        captures.push(capture);
      } catch (error) {
        if (!isTransientTargetError(error)) throw error;
      }
    }
    if (!captures.length) throw new Error('No browser page target is available for automation.');
    return captures;
  }

  private async captureTarget(target: CdpTarget, targetIndex: number): Promise<TargetCapture> {
    const [snapshotValue, accessibilityValue, metricsValue] = await Promise.all([
      this.send('DOMSnapshot.captureSnapshot', {
        computedStyles: [...browserSnapshotComputedStyles],
        includeDOMRects: true,
        includePaintOrder: true,
      }, target.sessionId),
      this.send('Accessibility.getFullAXTree', {}, target.sessionId).catch(() => ({ nodes: [] })),
      this.send('Page.getLayoutMetrics', {}, target.sessionId),
    ]);
    const snapshot = asSnapshotResponse(snapshotValue);
    const accessibility = asAccessibilityResponse(accessibilityValue);
    const viewport = viewportFromMetrics(metricsValue, snapshot);
    return {
      accessibility,
      observation: extractCdpPageObservation(snapshot, accessibility, viewport),
      sessionId: target.sessionId,
      snapshot,
      targetIndex,
      url: target.url || documentUrl(snapshot),
    };
  }

  private reference(ref: string): NodeReference {
    const reference = this.references.get(ref);
    if (!reference) throw new Error(`Element reference ${ref} is stale. Take a new browser snapshot.`);
    return reference;
  }

  private async scrollNodeIntoView(reference: NodeReference): Promise<void> {
    await this.send('DOM.scrollIntoViewIfNeeded', {
      backendNodeId: reference.backendNodeId,
    }, reference.sessionId);
  }

  private async pointForNode(reference: NodeReference): Promise<CdpPoint> {
    await this.scrollNodeIntoView(reference);
    const viewport = await this.viewport(reference.sessionId);
    try {
      const response = objectRecord(await this.send('DOM.getContentQuads', {
        backendNodeId: reference.backendNodeId,
      }, reference.sessionId));
      const quads = Array.isArray(response.quads) ? response.quads : [];
      const points = quads.map((quad) => quadPoint(quad, viewport)).filter((point): point is CdpPoint => Boolean(point));
      if (points.length) return points[0];
    } catch {
      // 某些替换元素或文本节点不会暴露内容四边形，此时回退到盒模型。
    }
    try {
      const response = objectRecord(await this.send('DOM.getBoxModel', {
        backendNodeId: reference.backendNodeId,
      }, reference.sessionId));
      const model = objectRecord(response.model);
      const point = quadPoint(model.border, viewport);
      if (point) return point;
    } catch {
      // 对于仍然存在的节点，已保存的快照边界是最后的回退方案。
    }
    if (reference.bounds) {
      return {
        x: reference.bounds.x + reference.bounds.width / 2,
        y: reference.bounds.y + reference.bounds.height / 2,
      };
    }
    throw new Error('Browser element no longer has a clickable layout box. Take a new snapshot.');
  }

  private async dispatchMouseClick(point: CdpPoint, sessionId?: string): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      button: 'none',
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    }, sessionId);
    await this.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 1,
      clickCount: 1,
      type: 'mousePressed',
      x: point.x,
      y: point.y,
    }, sessionId);
    await this.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 0,
      clickCount: 1,
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
    }, sessionId);
  }

  private async clearFocusedElement(sessionId: string | undefined, signal?: AbortSignal): Promise<void> {
    const platformModifier = process.platform === 'darwin' ? 4 : 2;
    throwIfAborted(signal);
    await this.dispatchKey('a', platformModifier, sessionId, false, ['selectAll']);
    await this.dispatchKey('Backspace', 0, sessionId);
  }

  private async dispatchKey(
    rawKey: string,
    modifiers: number,
    sessionId?: string,
    autoRepeat = false,
    commands?: string[],
  ): Promise<void> {
    const definition = keyDefinition(rawKey);
    const sendsText = definition.text && (modifiers & (1 | 2 | 4)) === 0;
    await this.send('Input.dispatchKeyEvent', {
      autoRepeat,
      code: definition.code,
      commands,
      key: definition.key,
      modifiers,
      text: sendsText ? definition.text : undefined,
      type: sendsText ? 'keyDown' : 'rawKeyDown',
      unmodifiedText: sendsText ? definition.text : undefined,
      windowsVirtualKeyCode: definition.virtualKeyCode,
    }, sessionId);
    await this.send('Input.dispatchKeyEvent', {
      code: definition.code,
      key: definition.key,
      modifiers,
      type: 'keyUp',
      windowsVirtualKeyCode: definition.virtualKeyCode,
    }, sessionId);
  }

  private async viewport(sessionId?: string): Promise<CdpViewport> {
    const snapshotPromise = this.send('DOMSnapshot.captureSnapshot', {
      computedStyles: [],
      includeDOMRects: false,
      includePaintOrder: false,
    }, sessionId);
    const [metrics, snapshot] = await Promise.all([
      this.send('Page.getLayoutMetrics', {}, sessionId),
      snapshotPromise,
    ]);
    return viewportFromMetrics(metrics, asSnapshotResponse(snapshot));
  }

  private async visualFingerprint(signal?: AbortSignal): Promise<string> {
    const hash = createHash('sha256');
    for (const target of this.targets()) {
      throwIfAborted(signal);
      try {
        const snapshot = asSnapshotResponse(await this.send('DOMSnapshot.captureSnapshot', {
          computedStyles: [],
          includeDOMRects: false,
          includePaintOrder: false,
        }, target.sessionId));
        updateSnapshotHash(hash, snapshot);
      } catch (error) {
        if (!isTransientTargetError(error)) throw error;
      }
    }
    try {
      const screenshot = objectRecord(await this.send('Page.captureScreenshot', {
        captureBeyondViewport: false,
        format: 'jpeg',
        fromSurface: true,
        optimizeForSpeed: true,
        quality: 15,
      }));
      const data = stringValue(screenshot.data);
      if (data) hash.update(`screenshot:${data}`);
    } catch {
      // 无法捕获页面表面时，仍可使用 DOM 或布局哈希。
    }
    return hash.digest('hex');
  }

  private async send(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    return this.transport.sendCommand(method, params, sessionId);
  }
}

function viewportFromMetrics(value: unknown, snapshot: CdpSnapshotResponse): CdpViewport {
  const metrics = objectRecord(value);
  const visual = objectRecord(metrics.cssVisualViewport);
  const layout = objectRecord(metrics.cssLayoutViewport);
  const firstDocument = snapshot.documents?.[0];
  return {
    height: positiveNumber(visual.clientHeight)
      || positiveNumber(layout.clientHeight)
      || positiveNumber(firstDocument?.contentHeight)
      || 1080,
    width: positiveNumber(visual.clientWidth)
      || positiveNumber(layout.clientWidth)
      || positiveNumber(firstDocument?.contentWidth)
      || 1920,
  };
}

function updateSnapshotHash(hash: ReturnType<typeof createHash>, snapshot: CdpSnapshotResponse): void {
  const strings = snapshot.strings ?? [];
  for (const document of snapshot.documents ?? []) {
    hash.update(`${finiteNumber(document.scrollOffsetX)}:${finiteNumber(document.scrollOffsetY)}|`);
    const layout = document.layout;
    const textIndexes = layout?.text ?? [];
    const bounds = layout?.bounds ?? [];
    for (let index = 0; index < textIndexes.length; index += 1) {
      const text = strings[textIndexes[index]] ?? '';
      const box = bounds[index] ?? [];
      if (text) hash.update(`${text}:${box.map((value) => Math.round(finiteNumber(value))).join(',')}|`);
    }
    const input = document.nodes?.inputValue;
    for (let index = 0; index < (input?.index?.length ?? 0); index += 1) {
      hash.update(`v${input?.index?.[index]}:${strings[input?.value?.[index] ?? -1] ?? ''}|`);
    }
  }
}

function snapshotText(snapshot: CdpSnapshotResponse): string {
  const strings = snapshot.strings ?? [];
  const parts: string[] = [];
  for (const document of snapshot.documents ?? []) {
    for (const textIndex of document.layout?.text ?? []) {
      const value = strings[textIndex];
      if (value) parts.push(value);
    }
  }
  return parts.join('\n');
}

function documentUrl(snapshot: CdpSnapshotResponse): string {
  const index = snapshot.documents?.[0]?.documentURL;
  return Number.isSafeInteger(index) && index !== undefined ? snapshot.strings?.[index] ?? '' : '';
}

function quadPoint(value: unknown, viewport?: CdpViewport): CdpPoint | null {
  if (!Array.isArray(value) || value.length < 8) return null;
  const coordinates = value.slice(0, 8);
  if (coordinates.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))) return null;
  const numbers = coordinates as number[];
  const minimumX = Math.min(numbers[0], numbers[2], numbers[4], numbers[6]);
  const maximumX = Math.max(numbers[0], numbers[2], numbers[4], numbers[6]);
  const minimumY = Math.min(numbers[1], numbers[3], numbers[5], numbers[7]);
  const maximumY = Math.max(numbers[1], numbers[3], numbers[5], numbers[7]);
  const left = viewport ? Math.max(1, minimumX) : minimumX;
  const right = viewport ? Math.min(viewport.width - 1, maximumX) : maximumX;
  const top = viewport ? Math.max(1, minimumY) : minimumY;
  const bottom = viewport ? Math.min(viewport.height - 1, maximumY) : maximumY;
  if (right <= left || bottom <= top) return null;
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
  };
}

function keyDefinition(rawKey: string): { code: string; key: string; text?: string; virtualKeyCode: number } {
  const key = rawKey === 'Space' ? ' ' : rawKey;
  const named: Record<string, { code: string; key?: string; text?: string; virtualKeyCode: number }> = {
    ' ': { code: 'Space', key: ' ', text: ' ', virtualKeyCode: 32 },
    ArrowDown: { code: 'ArrowDown', virtualKeyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', virtualKeyCode: 37 },
    ArrowRight: { code: 'ArrowRight', virtualKeyCode: 39 },
    ArrowUp: { code: 'ArrowUp', virtualKeyCode: 38 },
    Backspace: { code: 'Backspace', virtualKeyCode: 8 },
    Delete: { code: 'Delete', virtualKeyCode: 46 },
    End: { code: 'End', virtualKeyCode: 35 },
    Enter: { code: 'Enter', key: 'Enter', text: '\r', virtualKeyCode: 13 },
    Escape: { code: 'Escape', virtualKeyCode: 27 },
    Home: { code: 'Home', virtualKeyCode: 36 },
    PageDown: { code: 'PageDown', virtualKeyCode: 34 },
    PageUp: { code: 'PageUp', virtualKeyCode: 33 },
    Tab: { code: 'Tab', virtualKeyCode: 9 },
  };
  const definition = named[key];
  if (definition) return { ...definition, key: definition.key ?? key };
  if ([...key].length !== 1) throw new Error(`Unsupported browser key: ${rawKey}`);
  const character = [...key][0];
  const upper = character.toUpperCase();
  const code = /^[a-z]$/i.test(character)
    ? `Key${upper}`
    : /^\d$/.test(character) ? `Digit${character}` : '';
  return {
    code,
    key: character,
    text: character,
    virtualKeyCode: upper.charCodeAt(0),
  };
}

function modifierMask(modifiers: DesktopBrowserKeyModifier[]): number {
  return modifiers.reduce((mask, modifier) => mask | ({
    Alt: 1,
    Control: 2,
    Meta: 4,
    Shift: 8,
  })[modifier], 0);
}

function asSnapshotResponse(value: unknown): CdpSnapshotResponse {
  const record = objectRecord(value);
  return {
    documents: Array.isArray(record.documents) ? record.documents as CdpSnapshotResponse['documents'] : [],
    strings: Array.isArray(record.strings) ? record.strings.map((item) => typeof item === 'string' ? item : '') : [],
  };
}

function asAccessibilityResponse(value: unknown): CdpAccessibilityResponse {
  const record = objectRecord(value);
  return { nodes: Array.isArray(record.nodes) ? record.nodes as CdpAccessibilityResponse['nodes'] : [] };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function positiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isTransientTargetError(error: unknown): boolean {
  return /session with given id not found|target closed|frame (?:was|is) detached|no longer available|destroyed/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Browser operation was cancelled.');
}

async function abortableDelay(durationMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
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
