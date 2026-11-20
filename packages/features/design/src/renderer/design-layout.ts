import { Align, Direction, Edge, FlexDirection, Gutter, Justify, MeasureMode, PositionType, Wrap, type Node, type Yoga } from 'yoga-layout/load';
import type { DesignDocument, DesignFrame, DesignLayout, DesignNode, DesignQuad, DesignSizeMode, DesignText } from '../contracts/index.js';
import { designFrameMask } from '../contracts/design-references.js';

import { designProjectedSourceId } from './components/design-components.js';
import { intersectBounds, layerTransform, transformedBounds, transformedLocalBounds, type Bounds, type DesignTransform } from './design-geometry.js';
import { designArrowInkBounds } from './vectors/design-vector.js';

export type DesignLayerBox = Bounds & DesignTransform & Readonly<{
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  paintBounds: Bounds;
  visibleBounds: Bounds | null;
}>;
export type DesignScene = Readonly<Record<string, DesignLayerBox>>;
export type MeasureDesignText = (node: DesignText, maxWidth?: number) => { width: number; height: number };

const alignment = { start: Align.FlexStart, center: Align.Center, end: Align.FlexEnd } as const;
const distribution = {
  start: Justify.FlexStart, center: Justify.Center, end: Justify.FlexEnd,
  'space-between': Justify.SpaceBetween, 'space-around': Justify.SpaceAround,
} as const;

export function participatesInDesignFlow(node: DesignNode, id: string, parent?: DesignFrame): boolean {
  return !node.absolute && !node.hidden && parent?.maskId !== id;
}

export function designPadding(layout: DesignLayout): DesignQuad {
  const { padding, paddingX = padding, paddingY = padding } = layout;
  return layout.paddingSides ?? [paddingY, paddingX, paddingY, paddingX];
}

export function designLayoutPreviewScope(document: DesignDocument, scene: DesignScene, source: string | readonly string[]) {
  const sources = new Set(typeof source === 'string' ? [source] : source);
  const layerIds = new Set<string>();
  const roots = new Set<string>();
  // Hugged ancestors and instances can reflow, so start at each affected tree root.
  for (const [id, node] of Object.entries(document.nodes)) {
    if (!sources.has(id) && !sources.has(id.slice(id.lastIndexOf('/') + 1)) && !sources.has(designProjectedSourceId(id, node))) continue;
    layerIds.add(id);
    let root = id;
    for (let parent = scene[root].parentId; parent !== null; parent = scene[parent].parentId) root = parent;
    roots.add(root);
  }
  return { rootIds: [...roots], layerIds };
}

export function resolveDesignScene(yoga: Yoga, document: DesignDocument, measureText: MeasureDesignText,
  scope?: Readonly<{ rootIds: readonly string[]; layout?: Readonly<{ layerIds: ReadonlySet<string>; apply(layout: DesignLayout): DesignLayout }> }>,
): DesignScene {
  const boxes: Record<string, DesignLayerBox> = Object.create(null);
  const config = yoga.Config.create();
  config.setPointScaleFactor(0);

  function build(tree: Node, id: string, parent?: DesignFrame) {
    const source = document.nodes[id];
    const preview = scope?.layout;
    const model = preview?.layerIds.has(id) && source.kind === 'frame' && source.layout
      ? { ...source, layout: preview.apply(source.layout) } : source;
    const flowParent = parent?.layout && participatesInDesignFlow(model, id, parent) ? parent : undefined;
    // Keep hidden layers measurable for editing while removing them from the parent's layout.
    if (parent && !flowParent) {
      tree.setPositionType(PositionType.Absolute);
      tree.setPosition(Edge.Left, model.x);
      tree.setPosition(Edge.Top, model.y);
    }
    setSize(tree, model, flowParent, 'width');
    if (model.minWidth !== undefined) tree.setMinWidth(model.minWidth);
    if (model.maxWidth !== undefined) tree.setMaxWidth(model.maxWidth);
    if (model.kind === 'text') {
      tree.setMeasureFunc((width, mode) => {
        const measured = measureText(model, mode === MeasureMode.Undefined ? undefined : width);
        return { width: mode === MeasureMode.Exactly ? width : measured.width, height: measured.height };
      });
      return;
    }
    setSize(tree, model, flowParent, 'height');
    if (model.kind !== 'frame') return;
    if (model.layout) {
      const [top, right, bottom, left] = designPadding(model.layout);
      tree.setFlexDirection(model.layout.direction === 'horizontal' ? FlexDirection.Row : FlexDirection.Column);
      if (model.layout.wrap) tree.setFlexWrap(Wrap.Wrap);
      tree.setGap(Gutter.All, model.layout.gap);
      tree.setPadding(Edge.Top, top);
      tree.setPadding(Edge.Right, right);
      tree.setPadding(Edge.Bottom, bottom);
      tree.setPadding(Edge.Left, left);
      tree.setJustifyContent(distribution[model.layout.justify ?? 'start']);
      tree.setAlignItems(alignment[model.layout.align]);
    }
    model.childIds.forEach((id, index) => {
      const child = yoga.Node.create(config);
      tree.insertChild(child, index);
      build(child, id, model);
    });
  }

  function collect(tree: Node, id: string, parentId: string | null, clip?: Bounds | null) {
    const model = document.nodes[id];
    const { left, top, width, height } = tree.getComputedLayout();
    const parent = parentId === null ? undefined : boxes[parentId];
    const x = parent ? left : model.x;
    const y = parent ? top : model.y;
    const size = { x, y, width, height };
    const transform = layerTransform(size, model, parent);
    const arrowInk = model.kind === 'vector' ? designArrowInkBounds(model, width, height) : undefined;
    const paintBounds = arrowInk ? transformedLocalBounds(arrowInk, transform) : transformedBounds({ ...transform, width, height });
    const visible = (parent?.visible ?? true) && !model.hidden;
    const visibleBounds = clip === undefined ? paintBounds : clip && intersectBounds(clip, paintBounds);
    boxes[id] = { ...size, ...transform, paintBounds, visibleBounds, parentId, visible, locked: Boolean(parent?.locked || model.locked) };
    if (model.kind === 'frame') {
      const childClip = model.clip === false ? clip : visibleBounds;
      const mask = designFrameMask(document, model);
      if (mask) collect(tree.getChild(model.childIds.indexOf(mask.id)), mask.id, id, childClip);
      const maskedClip = mask ? boxes[mask.id].visibleBounds : childClip;
      model.childIds.forEach((childId, index) => {
        if (childId !== mask?.id) collect(tree.getChild(index), childId, id, maskedClip);
      });
    }
  }

  try {
    for (const id of scope?.rootIds ?? document.rootIds) {
      const root = yoga.Node.create(config);
      try {
        build(root, id);
        root.calculateLayout(undefined, undefined, Direction.LTR);
        collect(root, id, null);
      } finally {
        root.freeRecursive();
      }
    }
    return boxes;
  } finally {
    config.free();
  }
}

export type DesignAxis = 'width' | 'height';

export function designSizeModes(model: DesignNode, parent: DesignFrame | undefined, axis: DesignAxis): readonly DesignSizeMode[] {
  const modes: DesignSizeMode[] = ['fixed'];
  if (model.kind === 'text' && axis === 'height') return modes;
  if ((model.kind === 'frame' && model.layout) || model.kind === 'text') modes.push('hug');
  // A hug parent gets its size from its children, so a fill child uses its stored size on that axis.
  const parentMode = axis === 'width' ? parent?.widthMode : parent?.heightMode;
  if (!model.absolute && parent?.layout && parentMode !== 'hug') modes.push('fill');
  return modes;
}

export function designSizeMode(model: DesignNode, parent: DesignFrame | undefined, axis: DesignAxis): DesignSizeMode {
  const mode = axis === 'width' ? model.widthMode : 'heightMode' in model ? model.heightMode : undefined;
  return mode && designSizeModes(model, parent, axis).includes(mode) ? mode : 'fixed';
}

function setSize(tree: Node, model: DesignNode, parent: DesignFrame | undefined, axis: DesignAxis) {
  const effectiveMode = designSizeMode(model, parent, axis);
  if (effectiveMode === 'hug') {
    if (axis === 'width') tree.setMinWidth(1);
    else tree.setMinHeight(1);
    return;
  }
  if (effectiveMode === 'fill') {
    if ((parent?.layout?.direction === 'horizontal') === (axis === 'width')) {
      tree.setFlexGrow(1);
      tree.setFlexBasis(0);
    } else {
      tree.setAlignSelf(Align.Stretch);
    }
    return;
  }
  if (axis === 'width') tree.setWidth(model.width);
  else if (model.kind !== 'text') tree.setHeight(model.height);
}
