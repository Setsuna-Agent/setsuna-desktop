import type { DesktopBrowserBounds, DesktopBrowserElement } from '@setsuna-desktop/contracts';

export const browserSnapshotComputedStyles = ['visibility', 'opacity', 'pointer-events', 'cursor'] as const;

type RareData<T> = {
  index?: number[];
  value?: T[];
};

export type CdpNodeTreeSnapshot = {
  attributes?: number[][];
  backendNodeId?: number[];
  inputChecked?: RareData<boolean>;
  inputValue?: RareData<number>;
  isClickable?: RareData<boolean>;
  nodeName?: number[];
  nodeType?: number[];
  nodeValue?: number[];
  optionSelected?: RareData<boolean>;
  parentIndex?: number[];
  textValue?: RareData<number>;
};

export type CdpLayoutTreeSnapshot = {
  bounds?: number[][];
  nodeIndex?: number[];
  paintOrders?: number[];
  styles?: number[][];
  text?: number[];
};

export type CdpDocumentSnapshot = {
  contentHeight?: number;
  contentWidth?: number;
  documentURL?: number;
  frameId?: number;
  layout?: CdpLayoutTreeSnapshot;
  nodes?: CdpNodeTreeSnapshot;
  scrollOffsetX?: number;
  scrollOffsetY?: number;
  title?: number;
};

export type CdpSnapshotResponse = {
  documents?: CdpDocumentSnapshot[];
  strings?: string[];
};

type CdpAxValue = { value?: unknown };

export type CdpAxNode = {
  backendDOMNodeId?: number;
  description?: CdpAxValue;
  frameId?: string;
  ignored?: boolean;
  name?: CdpAxValue;
  properties?: Array<{ name?: string; value?: CdpAxValue }>;
  role?: CdpAxValue;
  value?: CdpAxValue;
};

export type CdpAccessibilityResponse = {
  nodes?: CdpAxNode[];
};

export type CdpViewport = {
  height: number;
  width: number;
};

export type CdpObservedNode = Omit<DesktopBrowserElement, 'bounds' | 'ref'> & {
  backendNodeId: number;
  bounds: DesktopBrowserBounds;
  frameId: string;
  priority: number;
};

export type CdpPageObservation = {
  nodes: CdpObservedNode[];
  text: string;
};

type LayoutInfo = {
  bounds: DesktopBrowserBounds;
  cursor: string;
  opacity: string;
  paintOrder: number;
  pointerEvents: string;
  visibility: string;
};

type TextRow = {
  bounds: DesktopBrowserBounds;
  text: string;
};

const actionableRoles = new Set([
  'button', 'checkbox', 'combobox', 'gridcell', 'link', 'listbox', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'searchbox', 'slider',
  'spinbutton', 'switch', 'tab', 'textbox', 'treeitem',
]);

const interactiveTags = new Set(['a', 'button', 'input', 'option', 'select', 'summary', 'textarea']);

/**
 * 将 CDP 的列式 DOM 快照转换为面向模型的紧凑观察结果。
 * 即使包含文本的元素没有语义角色也会保留，以便通过委托点击处理器实现的
 * 单页应用行项目仍能获得可操作的引用。
 */
export function extractCdpPageObservation(
  snapshot: CdpSnapshotResponse,
  accessibility: CdpAccessibilityResponse,
  viewport: CdpViewport,
): CdpPageObservation {
  const strings = Array.isArray(snapshot.strings) ? snapshot.strings : [];
  const axByBackendNode = accessibilityMap(accessibility);
  const observed: Array<CdpObservedNode & { order: number; paintOrder: number }> = [];
  const textRows: TextRow[] = [];
  let order = 0;

  for (const document of snapshot.documents ?? []) {
    const nodes = document.nodes;
    const layout = document.layout;
    if (!nodes || !layout) continue;
    const parentIndexes = nodes.parentIndex ?? [];
    const nodeTypes = nodes.nodeType ?? [];
    const backendNodeIds = nodes.backendNodeId ?? [];
    const backendToNodeIndex = new Map<number, number>();
    backendNodeIds.forEach((backendNodeId, index) => {
      if (Number.isSafeInteger(backendNodeId)) backendToNodeIndex.set(backendNodeId, index);
    });

    const layoutByNode = new Map<number, LayoutInfo>();
    const fallbackBoundsByElement = new Map<number, DesktopBrowserBounds>();
    const textByElement = new Map<number, string[]>();
    const scrollX = finiteNumber(document.scrollOffsetX);
    const scrollY = finiteNumber(document.scrollOffsetY);
    const layoutNodeIndexes = layout.nodeIndex ?? [];

    for (let layoutIndex = 0; layoutIndex < layoutNodeIndexes.length; layoutIndex += 1) {
      const nodeIndex = layoutNodeIndexes[layoutIndex];
      if (!Number.isSafeInteger(nodeIndex) || nodeIndex < 0) continue;
      const bounds = normalizeBounds(layout.bounds?.[layoutIndex], scrollX, scrollY, viewport);
      if (!bounds) continue;
      const styles = (layout.styles?.[layoutIndex] ?? []).map((index) => stringAt(strings, index));
      const info: LayoutInfo = {
        bounds,
        cursor: styles[3] ?? '',
        opacity: styles[1] ?? '',
        paintOrder: finiteNumber(layout.paintOrders?.[layoutIndex]),
        pointerEvents: styles[2] ?? '',
        visibility: styles[0] ?? '',
      };
      if (nodeTypes[nodeIndex] === 1) layoutByNode.set(nodeIndex, info);

      const rawText = compact(stringAt(strings, layout.text?.[layoutIndex]), 500);
      if (!rawText) continue;
      const elementIndex = nearestElementIndex(nodeIndex, nodeTypes, parentIndexes);
      if (elementIndex < 0) continue;
      const existing = textByElement.get(elementIndex) ?? [];
      if (!existing.includes(rawText)) existing.push(rawText);
      textByElement.set(elementIndex, existing);
      if (!layoutByNode.has(elementIndex) && !fallbackBoundsByElement.has(elementIndex)) {
        fallbackBoundsByElement.set(elementIndex, bounds);
      }
      textRows.push({ bounds, text: rawText });
    }

    const clickableIndexes = rareIndexSet(nodes.isClickable);
    const checkedIndexes = rareIndexSet(nodes.inputChecked);
    const selectedIndexes = rareIndexSet(nodes.optionSelected);
    const inputValues = rareStringMap(nodes.inputValue, strings);
    const textValues = rareStringMap(nodes.textValue, strings);
    const candidateIndexes = new Set<number>([
      ...layoutByNode.keys(),
      ...fallbackBoundsByElement.keys(),
    ]);
    for (const backendNodeId of axByBackendNode.keys()) {
      const nodeIndex = backendToNodeIndex.get(backendNodeId);
      if (nodeIndex !== undefined) candidateIndexes.add(nodeIndex);
    }

    for (const nodeIndex of candidateIndexes) {
      if (nodeTypes[nodeIndex] !== 1) continue;
      const layoutInfo = layoutByNode.get(nodeIndex);
      const bounds = layoutInfo?.bounds ?? fallbackBoundsByElement.get(nodeIndex);
      if (!bounds || isHiddenLayout(layoutInfo)) continue;
      const backendNodeId = backendNodeIds[nodeIndex];
      if (!Number.isSafeInteger(backendNodeId) || backendNodeId <= 0) continue;
      const attributes = attributesAt(nodes, nodeIndex, strings);
      const tag = stringAt(strings, nodes.nodeName?.[nodeIndex]).toLowerCase();
      const ax = axByBackendNode.get(backendNodeId);
      const axRole = compact(axString(ax?.role), 80).toLowerCase();
      const role = normalizedRole(axRole, tag, attributes);
      const text = compact((textByElement.get(nodeIndex) ?? []).join(' '), 240);
      const name = elementName(ax, attributes, text);
      const focusable = axBooleanProperty(ax, 'focusable') || attributes.has('tabindex');
      const editable = axBooleanProperty(ax, 'editable') || attributes.has('contenteditable');
      const clickable = clickableIndexes.has(nodeIndex)
        || actionableRoles.has(role)
        || interactiveTags.has(tag)
        || layoutInfo?.cursor === 'pointer';
      const semanticallyUseful = clickable
        || focusable
        || editable
        || (Boolean(axRole) && !['generic', 'none', 'presentation'].includes(axRole))
        || Boolean(name);
      if (!semanticallyUseful) continue;

      const type = attributes.get('type')?.toLowerCase();
      const rawValue = inputValues.get(nodeIndex) ?? textValues.get(nodeIndex) ?? axString(ax?.value);
      const value = type === 'password' ? '' : compact(rawValue, 200);
      const element: CdpObservedNode & { order: number; paintOrder: number } = {
        backendNodeId,
        bounds,
        clickable,
        frameId: ax?.frameId ?? stringAt(strings, document.frameId),
        name,
        order: order++,
        paintOrder: layoutInfo?.paintOrder ?? 0,
        priority: observationPriority({ clickable, editable, focusable, name, role, tag, text }),
        role,
        tag,
      };
      if (value) element.value = value;
      if (attributes.has('href')) element.href = compact(attributes.get('href') ?? '', 500);
      if (checkedIndexes.has(nodeIndex) || axProperty(ax, 'checked') !== undefined) {
        element.checked = checkedIndexes.has(nodeIndex) || axBooleanProperty(ax, 'checked');
      }
      if (selectedIndexes.has(nodeIndex) || axProperty(ax, 'selected') !== undefined) {
        element.selected = selectedIndexes.has(nodeIndex) || axBooleanProperty(ax, 'selected');
      }
      if (attributes.has('disabled') || axBooleanProperty(ax, 'disabled')) element.disabled = true;
      observed.push(element);
    }
  }

  observed.sort((left, right) =>
    right.priority - left.priority
      || left.bounds.y - right.bounds.y
      || left.bounds.x - right.bounds.x
      || right.paintOrder - left.paintOrder
      || left.order - right.order);

  return {
    nodes: deduplicateObservedNodes(observed),
    text: visibleText(textRows),
  };
}

function accessibilityMap(response: CdpAccessibilityResponse): Map<number, CdpAxNode> {
  const result = new Map<number, CdpAxNode>();
  for (const node of response.nodes ?? []) {
    if (node.ignored || !Number.isSafeInteger(node.backendDOMNodeId) || !node.backendDOMNodeId) continue;
    result.set(node.backendDOMNodeId, node);
  }
  return result;
}

function attributesAt(nodes: CdpNodeTreeSnapshot, nodeIndex: number, strings: string[]): Map<string, string> {
  const indexes = nodes.attributes?.[nodeIndex] ?? [];
  const result = new Map<string, string>();
  for (let index = 0; index + 1 < indexes.length; index += 2) {
    result.set(stringAt(strings, indexes[index]).toLowerCase(), stringAt(strings, indexes[index + 1]));
  }
  return result;
}

function elementName(ax: CdpAxNode | undefined, attributes: Map<string, string>, text: string): string {
  const candidates = [
    axString(ax?.name),
    attributes.get('aria-label') ?? '',
    attributes.get('placeholder') ?? '',
    attributes.get('alt') ?? '',
    attributes.get('title') ?? '',
    text,
  ];
  return compact(candidates.find((candidate) => compact(candidate, 160)) ?? '', 160);
}

function normalizedRole(axRole: string, tag: string, attributes: Map<string, string>): string {
  if (axRole && !['generic', 'none', 'presentation'].includes(axRole)) return axRole;
  const explicit = compact(attributes.get('role') ?? '', 80).toLowerCase();
  if (explicit) return explicit;
  if (tag === 'a') return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'input') {
    const type = attributes.get('type')?.toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (['button', 'submit', 'reset'].includes(type ?? '')) return 'button';
    return 'textbox';
  }
  return 'text';
}

function observationPriority(input: {
  clickable: boolean;
  editable: boolean;
  focusable: boolean;
  name: string;
  role: string;
  tag: string;
  text: string;
}): number {
  if (input.editable || actionableRoles.has(input.role)) return 120;
  if (input.clickable) return 110;
  if (input.focusable) return 100;
  if (input.role === 'heading' || /^h[1-6]$/.test(input.tag)) return 90;
  if (input.name || input.text) return 70;
  return 40;
}

function nearestElementIndex(nodeIndex: number, nodeTypes: number[], parentIndexes: number[]): number {
  let current = nodeIndex;
  for (let depth = 0; current >= 0 && depth < 20; depth += 1) {
    if (nodeTypes[current] === 1) return current;
    current = parentIndexes[current] ?? -1;
  }
  return -1;
}

function normalizeBounds(
  rawBounds: number[] | undefined,
  scrollX: number,
  scrollY: number,
  viewport: CdpViewport,
): DesktopBrowserBounds | null {
  if (!rawBounds || rawBounds.length < 4) return null;
  const x = finiteNumber(rawBounds[0]) - scrollX;
  const y = finiteNumber(rawBounds[1]) - scrollY;
  const width = Math.max(0, finiteNumber(rawBounds[2]));
  const height = Math.max(0, finiteNumber(rawBounds[3]));
  if (width <= 0.5 || height <= 0.5) return null;
  const right = Math.min(x + width, viewport.width);
  const bottom = Math.min(y + height, viewport.height);
  const clippedX = Math.max(0, x);
  const clippedY = Math.max(0, y);
  if (right <= clippedX || bottom <= clippedY) return null;
  return {
    height: roundCoordinate(bottom - clippedY),
    width: roundCoordinate(right - clippedX),
    x: roundCoordinate(clippedX),
    y: roundCoordinate(clippedY),
  };
}

function isHiddenLayout(layout: LayoutInfo | undefined): boolean {
  if (!layout) return false;
  return ['hidden', 'collapse'].includes(layout.visibility)
    || Number(layout.opacity) === 0;
}

function rareIndexSet(data: RareData<unknown> | undefined): Set<number> {
  return new Set((data?.index ?? []).filter((index) => Number.isSafeInteger(index) && index >= 0));
}

function rareStringMap(data: RareData<number> | undefined, strings: string[]): Map<number, string> {
  const result = new Map<number, string>();
  const indexes = data?.index ?? [];
  const values = data?.value ?? [];
  for (let position = 0; position < indexes.length; position += 1) {
    result.set(indexes[position], stringAt(strings, values[position]));
  }
  return result;
}

function axString(value: CdpAxValue | undefined): string {
  if (typeof value?.value === 'string') return value.value;
  if (typeof value?.value === 'number' || typeof value?.value === 'boolean') return String(value.value);
  return '';
}

function axProperty(node: CdpAxNode | undefined, name: string): unknown {
  return node?.properties?.find((property) => property.name === name)?.value?.value;
}

function axBooleanProperty(node: CdpAxNode | undefined, name: string): boolean {
  const value = axProperty(node, name);
  return value === true || value === 'true';
}

function visibleText(rows: TextRow[]): string {
  rows.sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
  const output: string[] = [];
  let previous = '';
  for (const row of rows) {
    const text = compact(row.text, 500);
    if (!text || text === previous) continue;
    output.push(text);
    previous = text;
    if (output.join('\n').length >= 16_000) break;
  }
  return output.join('\n').slice(0, 16_000);
}

function deduplicateObservedNodes(
  nodes: Array<CdpObservedNode & { order: number; paintOrder: number }>,
): CdpObservedNode[] {
  const seen = new Set<string>();
  const result: CdpObservedNode[] = [];
  for (const { order: _order, paintOrder: _paintOrder, ...node } of nodes) {
    const key = `${node.backendNodeId}:${node.role}:${node.name}:${node.bounds.x}:${node.bounds.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(node);
  }
  return result;
}

function stringAt(strings: string[], index: number | undefined): string {
  return Number.isSafeInteger(index) && index !== undefined && index >= 0 && typeof strings[index] === 'string'
    ? strings[index]
    : '';
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

function compact(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
