import type { DesignNode } from '../../contracts/index.js';
import { designFrameMask } from '../../contracts/design-references.js';
import { fitDesignWebDevice } from '../canvas/use-design-web-previews.js';
import { layerTransform, type Bounds } from '../design-geometry.js';
import { designImageFit } from '../design-image-fit.js';
import { designStrokeNeedsSeparateLayer, visibleDesignStrokes } from '../design-paint.js';
import { hasLayeredDesignPaint } from '../styles/design-gradients.js';
import { designShapeOutline, designTransformMatrix, positionedDesignOutline } from '../vectors/design-shape-outline.js';
import { designVectorShape } from '../vectors/design-vector.js';
import type { DesignExportSelection } from './design-export-scene.js';
import { createDesignSvgDefs, escapeDesignMarkup, svgAttributes, svgDesignText, svgNumber, svgPaintedPaths } from './design-svg-markup.js';

export function renderDesignSvg(
  { document, scene, ids, webImages }: DesignExportSelection, bounds: Bounds,
  images: ReadonlyMap<string, HTMLImageElement>, title: string, fontCss = '',
): string {
  const defs = createDesignSvgDefs(images);

  function imageMarkup(node: Extract<DesignNode, { kind: 'image' }>, box: Bounds) {
    const image = images.get(node.assetPath);
    if (!image) return '';
    const { bounds, crop } = designImageFit(node, box.width, box.height, image.naturalWidth, image.naturalHeight);
    if (!crop) return `<image${svgAttributes({ ...bounds, href: image.src, preserveAspectRatio: 'none' })}/>`;
    const scale = box.width / crop.width;
    const clip = defs.clip(designShapeOutline(node, box.width, box.height));
    return `<image${svgAttributes({ href: image.src, preserveAspectRatio: 'none', 'clip-path': clip,
      x: -crop.x * scale, y: -crop.y * scale, width: image.naturalWidth * scale, height: image.naturalHeight * scale })}/>`;
  }

  function layer(id: string, root = false): string {
    const node = document.nodes[id];
    const box = scene[id];
    if (!box?.visible) return '';
    const pose = root ? box : layerTransform(box, node);
    const width = box.width;
    const height = box.height;
    const localBox = { x: 0, y: 0, width, height };
    const transform = `matrix(${designTransformMatrix(pose).map(svgNumber).join(' ')})`;
    const outline = designShapeOutline(node, width, height);
    const strokes = visibleDesignStrokes(node);
    let painted: string;
    if (node.kind === 'text') painted = svgDesignText(node, width, defs.fills(node, localBox), defs.strokes(strokes, localBox));
    else if (node.kind === 'image') painted = imageMarkup(node, localBox);
    else if (node.kind === 'vector') {
      const shape = designVectorShape(node, width, height);
      const paths = defs.vector(node, shape.paths, shape.viewBox, Math.max(shape.scaleX, shape.scaleY) || 1);
      painted = `<svg${svgAttributes({ width, height, overflow: 'visible', preserveAspectRatio: 'none',
        viewBox: [shape.viewBox.x, shape.viewBox.y, shape.viewBox.width, shape.viewBox.height].map(svgNumber).join(' ') })}>${paths}</svg>`;
    } else painted = svgPaintedPaths(outline, defs.fills(node, localBox));

    const web = node.kind === 'web' && webImages?.get(id);
    if (web) painted += `<image${svgAttributes({ ...fitDesignWebDevice(localBox, web.device), href: web.image.src,
      preserveAspectRatio: 'none', 'clip-path': defs.clip(outline) })}/>`;
    const filter = defs.shadow(node.shadow);
    if (filter) painted = `<g filter="${filter}">${painted}</g>`;
    const glyph = node.kind === 'text' || node.kind === 'vector';
    const firstStroke = glyph ? undefined : strokes[0];
    const outlines = glyph ? [] : defs.outlines(strokes, outline, localBox);
    let children = '';
    if (node.kind === 'frame') {
      const mask = designFrameMask(document, node);
      children = node.childIds.filter((id) => id !== mask?.id).map((id) => layer(id)).join('');
      if (mask) children = `<g clip-path="${defs.clip(positionedDesignOutline(mask.node, scene[mask.id]))}">${children}</g>`;
      if (node.clip !== false) children = `<g clip-path="${defs.clip(outline)}">${children}</g>`;
    }
    const [first, ...rest] = outlines;
    const centered = firstStroke && !hasLayeredDesignPaint(node) && !designStrokeNeedsSeparateLayer(firstStroke)
      && (firstStroke.alignment ?? 'center') === 'center';
    const content = centered ? `${first}${children}${rest.join('')}` : `${children}${outlines.join('')}`;
    return `<g${svgAttributes({ transform, opacity: node.opacity, 'data-layer': node.name })}>${painted}${content}</g>`;
  }

  const content = ids.map((id) => layer(id, true)).join('');
  return `<svg${svgAttributes({ xmlns: 'http://www.w3.org/2000/svg', width: bounds.width, height: bounds.height,
    viewBox: [bounds.x, bounds.y, bounds.width, bounds.height].map(svgNumber).join(' ') })}>`
    + `<title>${escapeDesignMarkup(title)}</title>${fontCss ? `<style>${escapeDesignMarkup(fontCss)}</style>` : ''}${defs.markup()}${content}</svg>\n`;
}
