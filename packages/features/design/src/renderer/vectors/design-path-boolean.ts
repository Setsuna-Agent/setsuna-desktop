import { maxDesignPathAnchors, type DesignDocument, type DesignEdit, type DesignVectorGeometry } from '../../contracts/index.js';
import { designFills } from '../design-paint.js';
import type { DesignScene } from '../design-layout.js';
import { isClosedDesignShape, positionedDesignOutline } from './design-shape-outline.js';
import { mapPathAnchors } from './design-vector.js';

export async function combineDesignPaths(
  document: DesignDocument, scene: DesignScene, ids: readonly string[], operation: 'union' | 'subtract', name: string,
): Promise<{ id?: string; edits: DesignEdit[] }> {
  const [baseId] = ids;
  const parentId = scene[baseId]?.parentId;
  if (ids.length < 2 || ids.some((id) => {
    const box = scene[id];
    return !isClosedDesignShape(document.nodes[id]) || !box?.visible || box.locked || box.parentId !== parentId || box.width <= 0 || box.height <= 0;
  })) return { edits: [] };
  const { default: paper } = await import('paper');
  const scope = new paper.PaperScope();
  type PathItem = InstanceType<typeof scope.PathItem>;
  scope.setup(new scope.Size(1, 1));
  const removes = ids.map((nodeId): DesignEdit => ({ kind: 'remove', nodeId }));
  try {
    const operands = ids.map((id) => positionedDesignOutline(document.nodes[id], scene[id])
      .filter(({ data }) => /z/iu.test(data)).map((outline): PathItem => {
        const path = scope.PathItem.create(outline.data);
        path.fillRule = outline.fillRule ?? 'nonzero';
        if (outline.transform) path.transform(new scope.Matrix([...outline.transform]));
        return path;
      }).reduce((a, b) => a.unite(b, { insert: false })));
    const result = operands.slice(1).reduce((current, path) =>
      operation === 'union' ? current.unite(path, { insert: false }) : current.subtract(path, { insert: false }), operands[0]);
    if (result.isEmpty() || result.bounds.width <= 0 || result.bounds.height <= 0) return { edits: removes };
    const { x, y, width, height } = result.bounds;
    const bounds = { x, y, width, height };
    let geometry: DesignVectorGeometry = { kind: 'svg', viewBox: bounds, paths: [{ data: result.pathData, fillRule: 'nonzero' }] };
    if (result instanceof scope.Path && result.closed && result.segments.length >= 2 && result.segments.length <= maxDesignPathAnchors) {
      const anchors = result.segments.map(({ point, handleIn, handleOut }) => ({
        x: point.x, y: point.y,
        incoming: handleIn.isZero() ? undefined : { x: point.x + handleIn.x, y: point.y + handleIn.y },
        outgoing: handleOut.isZero() ? undefined : { x: point.x + handleOut.x, y: point.y + handleOut.y },
      }));
      geometry = { kind: 'path', closed: true, anchors: mapPathAnchors(anchors, (point) => ({ x: (point.x - x) / width, y: (point.y - y) / height })) };
    }
    const id = crypto.randomUUID();
    const base = document.nodes[baseId];
    return { id, edits: [
      { kind: 'insert', nodeId: id, parentId: parentId ?? null, node: { kind: 'vector', name, ...bounds, geometry,
        fills: designFills(base), opacity: base.opacity, absolute: base.absolute, strokes: base.strokes, shadow: base.shadow,
        interaction: base.interaction } },
      { kind: 'reorder', nodeId: id, beforeId: baseId }, ...removes,
    ] };
  } finally {
    scope.remove();
  }
}
