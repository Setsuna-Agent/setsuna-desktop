import { parseDesignSvgNumber, parseDesignSvgPathData, type DesignSvgGeometry, type DesignSvgPath } from '../../../contracts/vector-geometry.js';
import { readDesignLucideSource } from '../../vectors/design-lucide-catalog.js';
import { designSvgGeometry, readDesignSvg, svgPathBounds } from '../../vectors/design-svg-import.js';
import { penSpacing, type PenObject, type ReadPenValue } from './values.js';

export function penPath(node: PenObject): DesignSvgGeometry | undefined {
  try {
    const data = parseDesignSvgPathData(node.geometry);
    const cap = node.strokeLinecap;
    const path: DesignSvgPath = { data, fillRule: node.fillRule === 'evenodd' ? 'evenodd' : undefined,
      lineCap: cap === 'butt' || cap === 'round' || cap === 'square' ? cap : undefined,
      dash: Array.isArray(node.strokeDash) ? node.strokeDash.slice(0, 32).map(penSpacing) : undefined };
    const box = node.viewBox;
    const [x, y, width, height] = Array.isArray(box) && box.length === 4 ? box.map(parseDesignSvgNumber) : [];
    if (width > 0 && height > 0) return { kind: 'svg', viewBox: { x, y, width, height }, paths: [path] };
    const bounds = svgPathBounds(path);
    return { kind: 'svg', paths: [path], viewBox: { x: parseDesignSvgNumber(bounds.x), y: parseDesignSvgNumber(bounds.y),
      width: parseDesignSvgNumber(bounds.width) || 1, height: parseDesignSvgNumber(bounds.height) || 1 } };
  } catch {
    // Keep the layer's placement if its geometry cannot be represented on the canvas.
    return;
  }
}

export async function penIcon(node: PenObject, read: ReadPenValue, cache: Map<string, DesignSvgGeometry | undefined>) {
  const library = read(node.library ?? node.iconFontFamily);
  const name = read(node.icon ?? node.iconFontName);
  if (library !== 'lucide' || typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) return;
  if (!cache.has(name)) {
    const source = await readDesignLucideSource(name);
    cache.set(name, source && designSvgGeometry(await readDesignSvg(source)));
  }
  return cache.get(name);
}
