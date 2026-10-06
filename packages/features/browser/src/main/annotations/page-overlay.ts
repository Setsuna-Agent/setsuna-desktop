import type { BrowserAnnotationAnchor, BrowserAnnotationMarkers, BrowserAnnotationTarget } from '../../contracts/annotations.js';
import type { readAnnotationElement } from './element-context.js';

export type AnnotationPageAction =
  | { kind: 'pick'; id: string }
  | ({ kind: 'sync' } & BrowserAnnotationMarkers)
  | { kind: 'prepare-screenshot'; id: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'cancel' | 'dispose' | 'finish-screenshot' };

type AnnotationPageState = {
  run(action: AnnotationPageAction): Promise<BrowserAnnotationTarget | boolean | null> | BrowserAnnotationAnchor | boolean | null;
};

/** Runs only in our isolated world; no preload, IPC or Node APIs are exposed to the page. */
export function annotationPageOverlay(
  action: AnnotationPageAction,
  readElement: typeof readAnnotationElement,
): ReturnType<AnnotationPageState['run']> {
  const local = window as Window & { __setsunaAnnotations?: AnnotationPageState };
  if (local.__setsunaAnnotations) return local.__setsunaAnnotations.run(action);
  if (action.kind !== 'pick') return action.kind === 'anchor' ? null : true;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;overflow:clip!important;z-index:2147483647!important;pointer-events:none!important;';
  const root = host.attachShadow({ mode: 'closed' });
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;pointer-events:auto;cursor:crosshair;';
  const highlight = document.createElement('div');
  highlight.style.cssText = 'position:fixed;pointer-events:none;box-sizing:border-box;border:1.5px solid #6366f1;background:#6366f10d;border-radius:4px;display:none;';
  root.append(veil, highlight);
  document.documentElement.append(host);
  const elements = new Map<string, Element>();
  const markers = new Map<string, { outline: HTMLDivElement; badge: HTMLSpanElement }>();
  let markerIds: readonly string[] = [];
  let activeId: string | null = null;
  let captureId: string | null = null;
  const captureScrollPositions = new Map<Element, { left: number; top: number }>();
  let visible = true;
  let hovered: Element | null = null;
  let resolvePick: ((target: BrowserAnnotationTarget | null) => void) | null = null;
  let pendingId = '';
  let frame = 0;

  const atPoint = (x: number, y: number): Element | null => {
    veil.style.pointerEvents = 'none';
    let element = document.elementFromPoint(x, y);
    while (element?.shadowRoot) {
      const nested = element.shadowRoot.elementFromPoint(x, y);
      if (!nested || nested === element) break;
      element = nested;
    }
    veil.style.pointerEvents = 'auto';
    return element === host ? null : element;
  };
  const isExposed = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
    if (!element.isConnected || right <= left || bottom <= top) return false;
    let hit = atPoint((left + right) / 2, (top + bottom) / 2);
    // Hit testing descends open shadow roots; walk their hosts to recognize the target's content.
    while (hit) {
      if (element.contains(hit)) return true;
      const root = hit.getRootNode();
      hit = root instanceof ShadowRoot ? root.host : null;
    }
    return false;
  };
  const position = (node: HTMLElement, element: Element) => {
    const rect = element.getBoundingClientRect();
    const shown = element.isConnected && rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    node.style.display = shown ? 'grid' : 'none';
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
    return rect;
  };
  const paint = () => {
    frame = 0;
    if (hovered && resolvePick) position(highlight, hovered);
    else highlight.style.display = 'none';
    for (const [id, { outline, badge }] of markers) {
      const element = elements.get(id);
      if (element && (captureId ? id === captureId : visible)) {
        const rect = position(outline, element);
        badge.style.left = `${Math.max(4 - rect.left, -10)}px`;
        badge.style.top = `${Math.max(4 - rect.top, -10)}px`;
      } else outline.style.display = 'none';
    }
    // Track layout changes as well as nested scrolling; at most twenty selected nodes are read.
    if (resolvePick || ((visible || captureId) && markers.size)) frame = requestAnimationFrame(paint);
  };
  const schedulePaint = () => { if (!frame) frame = requestAnimationFrame(paint); };
  const finishCapture = () => {
    captureId = null;
    for (const [element, position] of captureScrollPositions) {
      element.scrollTo({ ...position, behavior: 'instant' });
    }
    captureScrollPositions.clear();
    cancelAnimationFrame(frame);
    paint();
  };
  const reconcileMarkers = () => {
    for (const [id, marker] of markers) {
      if (markerIds.includes(id)) continue;
      marker.outline.remove();
      markers.delete(id);
    }
    markerIds.forEach((id, index) => {
      let marker = markers.get(id);
      if (!marker) {
        const outline = document.createElement('div');
        outline.style.cssText = 'position:fixed;pointer-events:none;box-sizing:border-box;border:1.5px solid #6366f1;border-radius:4px;';
        const badge = document.createElement('span');
        badge.style.cssText = 'position:absolute;display:grid;place-items:center;min-width:20px;height:20px;padding:0 2px;box-sizing:border-box;border-radius:7px;background:#6366f1;color:#fff;font:600 11px/1 system-ui;box-shadow:0 0 0 2px #fff,0 2px 6px #0002;';
        outline.append(badge);
        root.append(outline);
        marker = { outline, badge };
        markers.set(id, marker);
      }
      marker.outline.style.background = activeId === id ? '#6366f10d' : 'transparent';
      marker.badge.textContent = String(index + 1);
    });
    schedulePaint();
  };
  const finish = (target: BrowserAnnotationTarget | null) => {
    const resolve = resolvePick;
    resolvePick = null;
    hovered = null;
    veil.style.display = 'none';
    highlight.style.display = 'none';
    if (target) {
      // A selected draft is already an annotation target, even before its comment is saved.
      // Keep its identity and outline through the handoff to the host editor.
      activeId = target.id;
      if (!markerIds.includes(target.id)) markerIds = [...markerIds, target.id];
      reconcileMarkers();
      cancelAnimationFrame(frame);
      paint();
    }
    resolve?.(target);
  };
  const cancelKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !resolvePick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(null);
  };
  window.addEventListener('keydown', cancelKey, true);
  veil.addEventListener('pointermove', (event) => { hovered = atPoint(event.clientX, event.clientY); });
  // The veil consumes the entire click sequence, so selecting links/buttons never activates them.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
    veil.addEventListener(type, (event) => { event.preventDefault(); event.stopPropagation(); });
  }
  veil.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!resolvePick) return;
    const element = atPoint(event.clientX, event.clientY);
    if (!element) return;
    // The node owns its annotation identity; selecting it again edits the existing note.
    const id = markerIds.find((markerId) => elements.get(markerId) === element) ?? pendingId;
    const target = readElement(element, id);
    elements.set(id, element);
    finish(target);
  });

  const run: AnnotationPageState['run'] = (next) => {
    if (next.kind === 'pick') {
      finishCapture();
      finish(null);
      pendingId = next.id;
      veil.style.display = 'block';
      const result = new Promise<BrowserAnnotationTarget | null>((resolve) => { resolvePick = resolve; });
      schedulePaint();
      return result;
    }
    if (next.kind === 'sync') {
      visible = next.visible;
      markerIds = next.ids;
      activeId = next.activeId ?? null;
      if (markerIds.includes(pendingId)) pendingId = '';
      // Retain only the active selection and saved annotations, not every node ever picked.
      for (const id of elements.keys()) if (id !== pendingId && !markerIds.includes(id)) elements.delete(id);
      reconcileMarkers();
      return true;
    }
    if (next.kind === 'prepare-screenshot') {
      const element = elements.get(next.id);
      if (!element?.isConnected || !markerIds.includes(next.id)) return false;
      captureId = next.id;
      // A target inside the viewport may still be clipped by a nested scroller. Let the browser
      // reveal it through every ancestor, retaining each original scroll position for the batch.
      let ancestor: Element | null = element;
      while (ancestor) {
        if (!captureScrollPositions.has(ancestor)) captureScrollPositions.set(ancestor, { left: ancestor.scrollLeft, top: ancestor.scrollTop });
        const root = ancestor.getRootNode();
        ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
      }
      // Edge alignment can leave the target behind fixed/sticky site navigation.
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      cancelAnimationFrame(frame);
      paint();
      // Let scrolling and the marker reach the compositor, then reject obscured content.
      return new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(isExposed(element)))));
    }
    if (next.kind === 'finish-screenshot') {
      finishCapture();
      return true;
    }
    if (next.kind === 'anchor') {
      const element = elements.get(next.id);
      if (!element?.isConnected) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { bounds: { x, y, width, height }, viewport: { width: innerWidth, height: innerHeight } };
    }
    finishCapture();
    finish(null);
    if (next.kind === 'dispose') {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', cancelKey, true);
      host.remove();
      delete local.__setsunaAnnotations;
    }
    return true;
  };
  local.__setsunaAnnotations = { run };
  return run(action);
}
