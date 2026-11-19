import type { DesignDocument, DesignFrame, DesignLayout, DesignNode } from '../contracts/index.js';
import { roundDesignValue, type Point } from './design-geometry.js';
import { designPadding, participatesInDesignFlow, type DesignScene } from './design-layout.js';

export const layoutEdges = ['top', 'right', 'bottom', 'left'] as const;
export const layoutHandles = ['gap', ...layoutEdges] as const;
export type LayoutHandle = (typeof layoutHandles)[number];
export const layoutHandleName = (handle: LayoutHandle) => `design-layout-${handle}`;

export function layoutHandleAxis(layout: DesignLayout, handle: LayoutHandle): 'x' | 'y' {
  if (handle === 'gap') return layout.direction === 'horizontal' ? 'x' : 'y';
  return handle === 'left' || handle === 'right' ? 'x' : 'y';
}

export function hasEditableLayout(node: DesignNode | undefined): node is DesignFrame & { layout: DesignLayout } {
  return node?.kind === 'frame' && !node.instanceOf && node.layout !== undefined;
}

export function frameLayoutGap(document: DesignDocument, scene: DesignScene, frame: DesignFrame, layout: DesignLayout) {
  const horizontal = layout.direction === 'horizontal';
  const axis = horizontal ? 'x' : 'y';
  const cross = horizontal ? 'y' : 'x';
  const size = horizontal ? 'width' : 'height';
  const crossSize = horizontal ? 'height' : 'width';
  let previous: DesignScene[string] | undefined;
  for (const id of frame.childIds) {
    const next = scene[id];
    if (!next.visible || !participatesInDesignFlow(document.nodes[id], id, frame)) continue;
    if (previous) {
      const end = previous[axis] + previous[size];
      const distance = Math.max(0, next[axis] - end);
      const crossStart = Math.max(previous[cross], next[cross]);
      const crossEnd = Math.min(previous[cross] + previous[crossSize], next[cross] + next[crossSize]);
      if (layout.wrap && crossEnd <= crossStart) { previous = next; continue; }
      const crossLength = Math.max(0, crossEnd - crossStart);
      const bounds = horizontal ? { x: end, y: crossStart, width: distance, height: crossLength }
        : { x: crossStart, y: end, width: crossLength, height: distance };
      return {
        point: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, bounds,
        value: isDistributed(layout) ? roundDesignValue(distance) : layout.gap,
      };
    }
    previous = next;
  }
}

export function adjustFrameLayout(layout: DesignLayout, handle: LayoutHandle, start: number, delta: Point, snap: boolean) {
  const axis = layoutHandleAxis(layout, handle);
  const distance = delta[axis] * (handle === 'right' || handle === 'bottom' ? -1 : 1);
  const value = Math.max(0, roundDesignValue(start + (snap ? Math.round(distance) : distance)));
  if (value === roundDesignValue(start)) return undefined;
  if (handle === 'gap') {
    // These anchors preserve the position of the distributed content when its gap becomes fixed.
    const justify = layout.justify === 'space-around' ? 'center' : layout.justify === 'space-between' ? 'start' : layout.justify;
    return { value, layout: { ...layout, gap: value, justify } };
  }
  if (!layout.paddingSides) return { value, layout: { ...layout, [axis === 'x' ? 'paddingX' : 'paddingY']: value } };
  const paddingSides: [number, number, number, number] = [...layout.paddingSides];
  paddingSides[layoutEdges.indexOf(handle)] = value;
  return { value, layout: { ...layout, paddingSides } };
}

export function layoutHandleValue(layout: DesignLayout, handle: Exclude<LayoutHandle, 'gap'>) {
  return designPadding(layout)[layoutEdges.indexOf(handle)];
}

function isDistributed({ justify }: DesignLayout) {
  return justify === 'space-between' || justify === 'space-around';
}
