import { Transform } from 'konva/lib/Util.js';
import type { DesignNode, DesignSvgMatrix, DesignSvgPath } from '../../contracts/index.js';
import { layerTransform, type Bounds, type DesignTransform } from '../design-geometry.js';
import { layerCornerRadius } from '../design-paint.js';
import { svgShapePath } from './design-svg-shapes.js';
import { designVectorShape } from './design-vector.js';

export function designTransformMatrix(pose: DesignTransform): DesignSvgMatrix {
  const angle = pose.angle * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine * pose.scaleX, sine * pose.scaleX, -sine * pose.scaleY, cosine * pose.scaleY, pose.absoluteX, pose.absoluteY];
}

export function isClosedDesignShape(node: DesignNode | undefined): boolean {
  if (node?.kind === 'rectangle' || node?.kind === 'ellipse') return true;
  if (node?.kind !== 'vector') return false;
  const { geometry } = node;
  return geometry.kind === 'polygon' || (geometry.kind === 'path' && geometry.closed)
    || (geometry.kind === 'svg' && geometry.paths.some(({ data }) => /z/iu.test(data)));
}

export function designShapeOutline(node: DesignNode, width: number, height: number): readonly DesignSvgPath[] {
  if (width <= 0 || height <= 0) return [];
  if (node.kind === 'vector') {
    const shape = designVectorShape(node, width, height);
    const view = new Transform().scale(shape.scaleX, shape.scaleY).translate(-shape.viewBox.x, -shape.viewBox.y);
    return shape.paths.map((path) => ({ ...path, transform: combine(view, path.transform) }));
  }
  if (node.kind === 'ellipse') {
    const values = { cx: width / 2, rx: width / 2, cy: height / 2, ry: height / 2 } as Record<string, number>;
    return [{ data: svgShapePath('ellipse', (key) => String(values[key]), { width, height }) }];
  }
  const radius = layerCornerRadius(node, width, height);
  const [tl, tr, br, bl] = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
  return [{ data: [
    `M${tl} 0H${width - tr}`, corner(tr, width, tr), `V${height - br}`, corner(br, width - br, height),
    `H${bl}`, corner(bl, 0, height - bl), `V${tl}`, corner(tl, tl, 0), 'Z',
  ].join('') }];
}

export function positionedDesignOutline(node: DesignNode, box: Bounds): readonly DesignSvgPath[] {
  const pose = new Transform([...designTransformMatrix(layerTransform(box, node))]);
  return designShapeOutline(node, box.width, box.height).map((path) => ({ ...path, transform: combine(pose, path.transform) }));
}

export function designMaskPath(node: DesignNode, box: Bounds): [Path2D, CanvasFillRule] {
  const paths = positionedDesignOutline(node, box);
  const mask = new Path2D();
  for (const path of paths) mask.addPath(new Path2D(path.data), path.transform && new DOMMatrix([...path.transform]));
  return [mask, paths.some((path) => path.fillRule === 'evenodd') ? 'evenodd' : 'nonzero'];
}

function combine(base: Transform, matrix: DesignSvgMatrix | undefined): DesignSvgMatrix {
  const [a, b, c, d, e, f] = (matrix ? base.copy().multiply(new Transform([...matrix])) : base).getMatrix();
  return [a, b, c, d, e, f];
}

function corner(radius: number, x: number, y: number) {
  return radius ? `A${radius} ${radius} 0 0 1 ${x} ${y}` : `L${x} ${y}`;
}
