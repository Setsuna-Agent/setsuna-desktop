import type { DesktopBrowserElement } from '@setsuna-desktop/contracts';
import {
  browserSnapshotComputedStyles,
  extractCdpPageObservation,
  type CdpAccessibilityResponse,
  type CdpPageObservation,
  type CdpSnapshotResponse,
  type CdpViewport,
} from './snapshot.js';

export type BrowserAutomationSnapshot = {
  elements: DesktopBrowserElement[];
  text: string;
};

export type BrowserTypeOptions = {
  clear: boolean;
  submit: boolean;
  text: string;
};

export type BrowserAutomation = {
  click(ref: string, signal?: AbortSignal): Promise<string>;
  dispose(): void;
  hasText(text: string, signal?: AbortSignal): Promise<boolean>;
  invalidate(): void;
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
  parentByBackendNodeId: ReadonlyMap<number, number>;
  role: string;
  sessionId?: string;
  tag: string;
  viewport: CdpViewport;
};

type TargetCapture = {
  observation: CdpPageObservation;
  parentByBackendNodeId: ReadonlyMap<number, number>;
  sessionId?: string;
  targetIndex: number;
  url: string;
  viewport: CdpViewport;
};

type CdpPoint = { x: number; y: number };

const protocolVersion = '1.3';
const clickProbeRatios: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0.2, 0.2],
  [0.8, 0.2],
  [0.2, 0.8],
  [0.8, 0.8],
];
const pageTargetTypes = new Set(['iframe', 'page', 'webview']);
const waitTextComputedStyles = ['visibility', 'opacity'] as const;

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
      const type = stringValue(targetInfo.type) || 'iframe';
      if (!pageTargetTypes.has(type)) return;
      this.childTargets.set(sessionId, {
        sessionId,
        type,
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
      if (sessionId && this.childTargets.delete(sessionId)) this.references.clear();
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
        parentByBackendNodeId: capture.parentByBackendNodeId,
        role: node.role,
        sessionId: capture.sessionId,
        tag: node.tag,
        viewport: capture.viewport,
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
    const point = await this.clickablePointForNode(reference, signal);
    const label = reference.name || reference.role || reference.tag;
    return `Dispatched a real browser click to ${ref} (${label}) at (${formatCoordinate(point.x)}, ${formatCoordinate(point.y)}).`;
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
    return `Dispatched ${options.text.length} character${options.text.length === 1 ? '' : 's'} of browser text input to ${ref}${options.submit ? ' followed by Enter' : ''}.`;
  }

  async scroll(ref: string | undefined, deltaY: number, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    await this.ensureAttached();
    if (ref) {
      const reference = this.reference(ref);
      await this.scrollNodeIntoView(reference);
      return `Ensured ${ref} is in view using browser scrolling.`;
    }
    if (deltaY === 0) throw new Error('Browser scroll distance must not be 0.');

    const viewport = await this.viewport();
    const point = {
      x: Math.max(1, Math.round(viewport.width * 0.5)),
      y: Math.max(1, Math.round(viewport.height * 0.5)),
    };
    throwIfAborted(signal);
    await this.send('Input.dispatchMouseEvent', {
      button: 'none',
      deltaX: 0,
      deltaY,
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
    });
    return `Dispatched a real browser wheel scroll of ${deltaY}px at (${point.x}, ${point.y}).`;
  }

  async hasText(text: string, signal?: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    await this.ensureAttached();
    for (const target of this.targets()) {
      try {
        const snapshot = asSnapshotResponse(await this.send('DOMSnapshot.captureSnapshot', {
          computedStyles: [...waitTextComputedStyles],
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
    const children = [...this.childTargets.values()].filter((target) => pageTargetTypes.has(target.type));
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
      observation: extractCdpPageObservation(snapshot, accessibility, viewport),
      parentByBackendNodeId: snapshotParentByBackendNodeId(snapshot),
      sessionId: target.sessionId,
      targetIndex,
      url: target.url || documentUrl(snapshot),
      viewport,
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

  private async clickablePointForNode(reference: NodeReference, signal?: AbortSignal): Promise<CdpPoint> {
    await this.scrollNodeIntoView(reference);
    const points = await this.candidatePointsForNode(reference);
    for (const point of points) {
      throwIfAborted(signal);
      // 先移动指针再命中测试，避免 hover 后出现的遮罩截获真正的按下事件。
      await this.dispatchMouseMove(point, reference.sessionId);
      const hitBackendNodeId = await this.backendNodeAtPoint(point, reference.sessionId);
      if (!referenceContainsBackendNode(reference, hitBackendNodeId)) continue;
      throwIfAborted(signal);
      await this.dispatchMouseClick(point, reference.sessionId);
      return point;
    }
    const label = reference.name || reference.role || reference.tag;
    throw new Error(`Browser element ${label || reference.backendNodeId} is covered, stale, or not pointer-interactable. Take a new browser snapshot.`);
  }

  private async candidatePointsForNode(reference: NodeReference): Promise<CdpPoint[]> {
    try {
      const response = objectRecord(await this.send('DOM.getContentQuads', {
        backendNodeId: reference.backendNodeId,
      }, reference.sessionId));
      const quads = Array.isArray(response.quads) ? response.quads : [];
      const points = uniquePoints(quads.flatMap((quad) => quadCandidatePoints(quad, reference.viewport)));
      if (points.length) return points;
    } catch {
      // 某些替换元素或文本节点不会暴露内容四边形，此时回退到盒模型。
    }
    try {
      const response = objectRecord(await this.send('DOM.getBoxModel', {
        backendNodeId: reference.backendNodeId,
      }, reference.sessionId));
      const model = objectRecord(response.model);
      const points = quadCandidatePoints(model.border, reference.viewport);
      if (points.length) return points;
    } catch {
      // 对于仍然存在的节点，已保存的快照边界是最后的回退方案。
    }
    if (reference.bounds) {
      return boundsCandidatePoints(reference.bounds, reference.viewport);
    }
    throw new Error('Browser element no longer has a clickable layout box. Take a new snapshot.');
  }

  private async backendNodeAtPoint(point: CdpPoint, sessionId?: string): Promise<number | null> {
    const response = objectRecord(await this.send('DOM.getNodeForLocation', {
      x: Math.round(point.x),
      y: Math.round(point.y),
    }, sessionId));
    return positiveSafeInteger(response.backendNodeId);
  }

  private async dispatchMouseMove(point: CdpPoint, sessionId?: string): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      button: 'none',
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    }, sessionId);
  }

  private async dispatchMouseClick(point: CdpPoint, sessionId?: string): Promise<void> {
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
    await this.dispatchKey('a', platformModifier, sessionId, ['selectAll']);
    await this.dispatchKey('Backspace', 0, sessionId);
  }

  private async dispatchKey(
    rawKey: string,
    modifiers: number,
    sessionId?: string,
    commands?: string[],
  ): Promise<void> {
    const definition = keyDefinition(rawKey, (modifiers & 8) !== 0);
    const sendsText = definition.text && (modifiers & (1 | 2 | 4)) === 0;
    await this.send('Input.dispatchKeyEvent', {
      code: definition.code,
      commands,
      key: definition.key,
      modifiers,
      text: sendsText ? definition.text : undefined,
      type: sendsText ? 'keyDown' : 'rawKeyDown',
      unmodifiedText: sendsText ? definition.unmodifiedText ?? definition.text : undefined,
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
    return viewportFromMetrics(await this.send('Page.getLayoutMetrics', {}, sessionId));
  }

  private async send(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    return this.transport.sendCommand(method, params, sessionId);
  }
}

function viewportFromMetrics(value: unknown, snapshot?: CdpSnapshotResponse): CdpViewport {
  const metrics = objectRecord(value);
  const visual = objectRecord(metrics.cssVisualViewport);
  const layout = objectRecord(metrics.cssLayoutViewport);
  const firstDocument = snapshot?.documents?.[0];
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

function snapshotParentByBackendNodeId(snapshot: CdpSnapshotResponse): ReadonlyMap<number, number> {
  const parents = new Map<number, number>();
  for (const document of snapshot.documents ?? []) {
    const backendNodeIds = document.nodes?.backendNodeId ?? [];
    const parentIndexes = document.nodes?.parentIndex ?? [];
    for (let nodeIndex = 0; nodeIndex < backendNodeIds.length; nodeIndex += 1) {
      const backendNodeId = positiveSafeInteger(backendNodeIds[nodeIndex]);
      const parentIndex = parentIndexes[nodeIndex];
      const parentBackendNodeId = Number.isSafeInteger(parentIndex) && parentIndex >= 0
        ? positiveSafeInteger(backendNodeIds[parentIndex])
        : null;
      if (backendNodeId !== null && parentBackendNodeId !== null) {
        parents.set(backendNodeId, parentBackendNodeId);
      }
    }
  }
  return parents;
}

function snapshotText(snapshot: CdpSnapshotResponse): string {
  const strings = snapshot.strings ?? [];
  const parts: string[] = [];
  for (const document of snapshot.documents ?? []) {
    const layout = document.layout;
    for (let layoutIndex = 0; layoutIndex < (layout?.text?.length ?? 0); layoutIndex += 1) {
      const styleIndexes = layout?.styles?.[layoutIndex] ?? [];
      const visibility = strings[styleIndexes[0]] ?? '';
      const opacity = Number.parseFloat(strings[styleIndexes[1]] ?? '');
      if (['hidden', 'collapse'].includes(visibility) || (Number.isFinite(opacity) && opacity <= 0)) continue;
      const textIndex = layout?.text?.[layoutIndex];
      if (textIndex === undefined) continue;
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

function quadCandidatePoints(value: unknown, viewport: CdpViewport): CdpPoint[] {
  if (!Array.isArray(value) || value.length < 8) return [];
  const coordinates = value.slice(0, 8);
  if (coordinates.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))) return [];
  const numbers = coordinates as number[];
  const corners: ReadonlyArray<CdpPoint> = [
    { x: numbers[0], y: numbers[1] },
    { x: numbers[2], y: numbers[3] },
    { x: numbers[4], y: numbers[5] },
    { x: numbers[6], y: numbers[7] },
  ];
  const points = clickProbeRatios
    .map(([xRatio, yRatio]) => pointWithinQuad(corners, xRatio, yRatio))
    .filter((point) => pointWithinViewport(point, viewport));

  const minimumX = Math.min(numbers[0], numbers[2], numbers[4], numbers[6]);
  const maximumX = Math.max(numbers[0], numbers[2], numbers[4], numbers[6]);
  const minimumY = Math.min(numbers[1], numbers[3], numbers[5], numbers[7]);
  const maximumY = Math.max(numbers[1], numbers[3], numbers[5], numbers[7]);
  points.push(...rectangleCandidatePoints(
    Math.max(1, minimumX),
    Math.max(1, minimumY),
    Math.min(viewport.width - 1, maximumX),
    Math.min(viewport.height - 1, maximumY),
  ));
  return uniquePoints(points);
}

function boundsCandidatePoints(
  bounds: NonNullable<DesktopBrowserElement['bounds']>,
  viewport: CdpViewport,
): CdpPoint[] {
  return rectangleCandidatePoints(
    Math.max(1, bounds.x),
    Math.max(1, bounds.y),
    Math.min(viewport.width - 1, bounds.x + bounds.width),
    Math.min(viewport.height - 1, bounds.y + bounds.height),
  );
}

function rectangleCandidatePoints(left: number, top: number, right: number, bottom: number): CdpPoint[] {
  if (right <= left || bottom <= top) return [];
  return clickProbeRatios.map(([xRatio, yRatio]) => ({
    x: left + ((right - left) * xRatio),
    y: top + ((bottom - top) * yRatio),
  }));
}

function pointWithinQuad(
  corners: ReadonlyArray<CdpPoint>,
  xRatio: number,
  yRatio: number,
): CdpPoint {
  const top = interpolatePoint(corners[0], corners[1], xRatio);
  const bottom = interpolatePoint(corners[3], corners[2], xRatio);
  return interpolatePoint(top, bottom, yRatio);
}

function interpolatePoint(start: CdpPoint, end: CdpPoint, ratio: number): CdpPoint {
  return {
    x: start.x + ((end.x - start.x) * ratio),
    y: start.y + ((end.y - start.y) * ratio),
  };
}

function pointWithinViewport(point: CdpPoint, viewport: CdpViewport): boolean {
  return point.x >= 1 && point.x <= viewport.width - 1
    && point.y >= 1 && point.y <= viewport.height - 1;
}

function uniquePoints(points: CdpPoint[]): CdpPoint[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${formatCoordinate(point.x)}:${formatCoordinate(point.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function referenceContainsBackendNode(reference: NodeReference, backendNodeId: number | null): boolean {
  if (backendNodeId === null) return false;
  const visited = new Set<number>();
  let current: number | undefined = backendNodeId;
  while (current !== undefined && !visited.has(current)) {
    if (current === reference.backendNodeId) return true;
    visited.add(current);
    current = reference.parentByBackendNodeId.get(current);
  }
  return false;
}

function formatCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

function keyDefinition(rawKey: string, shift: boolean): {
  code: string;
  key: string;
  text?: string;
  unmodifiedText?: string;
  virtualKeyCode: number;
} {
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
  const rawCharacter = [...key][0];
  const unmodifiedText = /^[a-z]$/i.test(rawCharacter) ? rawCharacter.toLowerCase() : rawCharacter;
  const character = shift && /^[a-z]$/i.test(rawCharacter) ? rawCharacter.toUpperCase() : rawCharacter;
  const upper = unmodifiedText.toUpperCase();
  const code = /^[a-z]$/i.test(unmodifiedText)
    ? `Key${upper}`
    : /^\d$/.test(unmodifiedText) ? `Digit${unmodifiedText}` : '';
  return {
    code,
    key: character,
    text: character,
    unmodifiedText,
    virtualKeyCode: upper.charCodeAt(0),
  };
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

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
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
