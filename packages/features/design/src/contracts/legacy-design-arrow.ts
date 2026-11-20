import { designSvgNumberPattern, type DesignPathGeometry, type DesignSvgGeometry } from './vector-geometry.js';

const pair = `(${designSvgNumberPattern}) (${designSvgNumberPattern})`;
const legacyPath = new RegExp(`^M${pair} L${pair} M${pair} L${pair} L${pair}$`, 'u');

export function restoreLegacyDesignArrow({ viewBox, paths, icon }: DesignSvgGeometry): DesignPathGeometry | undefined {
  if (icon || paths.length !== 1 || viewBox.x !== 0 || viewBox.y !== 0 || viewBox.width < 1 || viewBox.height < 1) return;
  const { data, lineCap, transform, fillRule, fillFromStroke, dash, dashOffset } = paths[0];
  if (lineCap !== 'round' || transform || fillRule || fillFromStroke !== undefined || dash || dashOffset !== undefined) return;
  const match = legacyPath.exec(data);
  if (!match) return;
  const [x1, y1, x2, y2, leftX, leftY, tipX, tipY, rightX, rightY] = match.slice(1).map(Number);
  if ([x1, x2, leftX, rightX].some((x) => x < 0 || x > viewBox.width)
    || [y1, y2, leftY, rightY].some((y) => y < 0 || y > viewBox.height)) return;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (!length || tipX !== x2 || tipY !== y2) return;

  // Recognize the previous tool's exact shaft/head pattern without relying on the layer name.
  const depth = Math.min(12, length / 3);
  const dx = (x2 - x1) / length * depth;
  const dy = (y2 - y1) / length * depth;
  const near = (actual: number, expected: number) => Math.abs(actual - expected) <= 0.02;
  if (!near(leftX, x2 - dx + dy * 0.55) || !near(leftY, y2 - dy - dx * 0.55)
    || !near(rightX, x2 - dx - dy * 0.55) || !near(rightY, y2 - dy + dx * 0.55)) return;

  // Keep the existing layer box and transforms. The normalized shaft retains its previous placement.
  return { kind: 'path', closed: false, endMarker: 'arrow',
    anchors: [{ x: x1 / viewBox.width, y: y1 / viewBox.height }, { x: x2 / viewBox.width, y: y2 / viewBox.height }] };
}
