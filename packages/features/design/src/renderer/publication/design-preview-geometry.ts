import type paper from 'paper';
import type { DesignNode, DesignVector } from '../../contracts/document.js';
import { maxDesignPreviewOutlinePoints, type DesignPreviewLayer } from '../../contracts/design-preview-layers.js';
import { designFills, layerCornerRadius, visibleDesignStrokes } from '../design-paint.js';
import type { DesignLayerBox } from '../design-layout.js';
import { designShapeOutline, designTransformMatrix, isClosedDesignShape } from '../vectors/design-shape-outline.js';
import { designVectorShape } from '../vectors/design-vector.js';

export async function createDesignPreviewGeometry() {
  // Boolean geometry is only needed when the author publishes a preview.
  const { default: paper } = await import('paper');
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  scope.settings.insertItems = false;
  return { forBoard: (board: DesignLayerBox) => artboardGeometry(scope, board), dispose: () => scope.remove() };
}

export type DesignPreviewGeometry = Awaited<ReturnType<typeof createDesignPreviewGeometry>>;
type Region = paper.PathItem | undefined;

function artboardGeometry(scope: paper.PaperScope, board: DesignLayerBox) {
  scope.activate();
  const width = board.width || 1;
  const height = board.height || 1;
  const crop = new scope.Path.Rectangle(new scope.Rectangle(0, 0, width, height));
  const fromWorld = new scope.Matrix([...designTransformMatrix(board)]).inverted();
  const rectangles = new WeakSet<paper.PathItem>([crop]);

  function shape(node: DesignNode, box: DesignLayerBox, vector?: 'layer' | 'mask'): Region {
    if (!box || box.width <= 0 || box.height <= 0) return;
    const transform = fromWorld.appended(new scope.Matrix([...designTransformMatrix(box)]));
    if (node.kind === 'vector' && vector === 'layer') {
      const paint = vectorFootprint(scope, node, box);
      paint?.transform(transform);
      return paint;
    }
    const radius = layerCornerRadius(node, box.width, box.height);
    const rounded = Array.isArray(radius) ? radius.some(Boolean) : Boolean(radius);
    if (!rounded && node.kind !== 'ellipse' && !(vector === 'mask' && node.kind === 'vector')) {
      const rect = new scope.Path.Rectangle(new scope.Rectangle(0, 0, box.width, box.height));
      rect.transform(transform);
      if (transform.b === 0 && transform.c === 0) rectangles.add(rect);
      return rect;
    }
    const parts = designShapeOutline(node, box.width, box.height);
    const paths = parts.map((part) => {
      const path = scope.PathItem.create(part.data);
      if (part.transform) path.transform(new scope.Matrix([...part.transform]));
      return path;
    });
    // Canvas adds every subpath to one mask before applying its shared winding rule.
    const path = paths.length === 1 ? paths[0] : new scope.CompoundPath({ children: paths });
    path.fillRule = parts.some((part) => part.fillRule === 'evenodd') ? 'evenodd' : 'nonzero';
    path.transform(transform);
    return path;
  }

  function intersect(shape: Region, clip: Region): Region {
    if (!shape || !clip || !shape.bounds.intersects(clip.bounds)) return;
    if (rectangles.has(shape) && rectangles.has(clip)) {
      if (clip.bounds.contains(shape.bounds)) return shape;
      const visible = new scope.Path.Rectangle(shape.bounds.intersect(clip.bounds));
      rectangles.add(visible);
      return visible;
    }
    const result = shape.intersect(clip, { insert: false });
    if ((result instanceof scope.Path || result instanceof scope.CompoundPath) && Math.abs(result.area) > 0) return result;
  }

  function clippedLayer(node: DesignNode, box: DesignLayerBox, clip: Region): Region {
    const layer = shape(node, box);
    if (!clip || !layer || !layer.bounds.intersects(clip.bounds)) return;
    // A vector wholly inside a rectangular clip keeps its usual selection box. At a mask edge, test its painted area.
    if (node.kind === 'vector' && !(rectangles.has(clip) && clip.bounds.contains(layer.bounds))) {
      return intersect(shape(node, box, 'layer'), clip);
    }
    return intersect(layer, clip);
  }

  function outline(region: Region): Pick<DesignPreviewLayer, 'outline' | 'outlinePath'> {
    if (!region) return { outline: [] };
    const coordinate = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
    const point = ({ x, y }: paper.Point): readonly [number, number] => [coordinate(x / width), coordinate(y / height)];
    if (region instanceof scope.Path && region.segments.length <= maxDesignPreviewOutlinePoints && region.curves.every((curve) => curve.isStraight())) {
      return { outline: region.segments.map((segment) => point(segment.point)) };
    }
    const bounds = region.bounds;
    const normalized = region.clone({ insert: false });
    normalized.transform(new scope.Matrix(1 / width, 0, 0, 1 / height, 0, 0));
    // The box gives the viewer a quick rejection test and zoom target. The clipped path retains holes and islands.
    return { outline: [bounds.topLeft, bounds.topRight, bounds.bottomRight, bounds.bottomLeft].map(point),
      outlinePath: normalized.pathData };
  }

  return {
    crop, intersect, outline, clippedLayer,
    mask: (node: DesignNode, box: DesignLayerBox) => shape(node, box, 'mask'),
  };
}

function vectorFootprint(scope: paper.PaperScope, node: DesignVector, box: DesignLayerBox): Region {
  const vector = designVectorShape(node, box.width, box.height);
  const view = new scope.Matrix().scale(vector.scaleX, vector.scaleY).translate(-vector.viewBox.x, -vector.viewBox.y);
  const strokes = visibleDesignStrokes(node).filter((stroke) => stroke.width > 0);
  const filled = designFills(node).some((fill) => !fill.hidden && fill.opacity !== 0);
  const marks: paper.PathItem[] = [];
  // Unlike a mask, vector artwork paints each SVG path separately. An open stroke can miss a mask even when their boxes overlap.
  for (const part of vector.paths) {
    const path = scope.PathItem.create(part.data);
    path.fillRule = part.fillRule ?? 'nonzero';
    const placement = part.transform ? view.appended(new scope.Matrix([...part.transform])) : view;
    if (part.dash) path.dashArray = [...part.dash];
    if (part.dashOffset) path.dashOffset = part.dashOffset;
    for (const stroke of strokes) {
      const ink = path.outline({ width: stroke.width / Math.max(vector.scaleX, vector.scaleY),
        cap: part.lineCap ?? 'butt', join: stroke.join ?? 'miter', insert: false });
      ink.transform(placement);
      marks.push(ink);
    }
    if (filled || (part.fillFromStroke && strokes.length) || (!strokes.length && isClosedDesignShape(node))) {
      path.transform(placement);
      marks.push(path);
    }
  }
  const [first, ...rest] = marks;
  return rest.length ? first.unite(rest, { insert: false }) : first;
}
