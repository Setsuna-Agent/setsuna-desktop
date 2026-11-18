import type { DesignNode, DesignText } from '../../contracts/index.js';
import { designFrameMask } from '../../contracts/design-references.js';
import { layerTransform, type Bounds } from '../design-geometry.js';
import { designImageFit } from '../design-image-fit.js';
import { visibleDesignStrokes } from '../design-paint.js';
import { createPlainDesignText, designTextStyle } from '../design-text.js';
import { hasLayeredDesignPaint } from '../styles/design-gradients.js';
import { layoutRichDesignText } from '../text/design-rich-text.js';
import { designShapeOutline, designTransformMatrix, positionedDesignOutline } from '../vectors/design-shape-outline.js';
import { designVectorShape } from '../vectors/design-vector.js';
import type { DesignExportSelection } from './design-export-scene.js';
import { createDesignSvgDefs, escapeDesignMarkup, svgAttributes, svgNumber, svgPaintedPaths, svgPathMarkup, svgStrokeAttributes } from './design-svg-markup.js';

type SvgTextPiece = { text: string; x: number; y: number; style: ReturnType<typeof designTextStyle>; color?: string; wordSpacing?: number };

function svgTextPieces(node: DesignText, width: number): readonly SvgTextPiece[] {
  if (node.runs?.length) return layoutRichDesignText(node, width).pieces;
  // Use the canvas engine's actual lines so wrapped words, whitespace and shaping survive SVG handoff.
  const shape = createPlainDesignText(node, width);
  const style = designTextStyle(node);
  try {
    return shape.textArr.map((line, index) => {
      const spare = width - line.width;
      const spaces = style.textAlign === 'justify' && !line.lastInParagraph ? line.text.split(' ').length - 1 : 0;
      return { text: line.text, style, x: style.textAlign === 'right' ? spare : style.textAlign === 'center' ? spare / 2 : 0,
        y: index * style.fontSize * style.lineHeight, wordSpacing: spaces ? spare / spaces : undefined };
    });
  } finally {
    shape.destroy();
  }
}

export function renderDesignSvg(
  { document, scene, ids }: DesignExportSelection, bounds: Bounds,
  images: ReadonlyMap<string, HTMLImageElement>, title: string,
): string {
  const defs = createDesignSvgDefs(images);

  function textMarkup(node: DesignText, box: Bounds) {
    const fills = defs.fills(node, box);
    const strokes = visibleDesignStrokes(node).map((stroke) => svgStrokeAttributes(stroke));
    return svgTextPieces(node, box.width).map(({ text, x, y, style, color, wordSpacing }) => {
      const colors = color ? [{ fill: color }] : fills;
      return [...colors, ...strokes.map((stroke) => ({ fill: 'none', ...stroke }))].map((paint) => {
        const blend = 'style' in paint && paint.style ? `;${paint.style}` : '';
        return `<text${svgAttributes({ ...paint, x, y: y + style.fontSize * style.lineHeight / 2, 'dominant-baseline': 'central',
          style: `font-family:${style.fontFamily}${blend}`, 'font-size': style.fontSize, 'font-weight': style.fontWeight,
          'letter-spacing': style.letterSpacing, 'word-spacing': wordSpacing, 'xml:space': 'preserve' })}>${escapeDesignMarkup(text)}</text>`;
      }).join('');
    }).join('');
  }

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
    let painted: string;
    if (node.kind === 'text') painted = textMarkup(node, localBox);
    else if (node.kind === 'image') painted = imageMarkup(node, localBox);
    else if (node.kind === 'vector') {
      const shape = designVectorShape(node.geometry, width, height);
      const paths = svgPaintedPaths(shape.paths, defs.fills(node, shape.viewBox), visibleDesignStrokes(node), Math.max(shape.scaleX, shape.scaleY) || 1);
      painted = `<svg${svgAttributes({ width, height, overflow: 'visible', preserveAspectRatio: 'none',
        viewBox: [shape.viewBox.x, shape.viewBox.y, shape.viewBox.width, shape.viewBox.height].map(svgNumber).join(' ') })}>${paths}</svg>`;
    } else painted = svgPaintedPaths(outline, defs.fills(node, localBox));

    const filter = defs.shadow(node.shadow);
    if (filter) painted = `<g filter="${filter}">${painted}</g>`;
    const strokes = node.kind === 'text' || node.kind === 'vector' ? [] : visibleDesignStrokes(node);
    const outlines = strokes.map((stroke) => {
      const align = stroke.alignment ?? 'center';
      const attributes = align === 'inside' ? { 'clip-path': defs.clip(outline) }
        : align === 'outside' ? { mask: defs.outside(outline, localBox, stroke.width) } : {};
      const ink = svgStrokeAttributes(stroke, align === 'center' ? 1 : 0.5);
      return `<g${svgAttributes(attributes)}>${outline.map((path) => svgPathMarkup(path, { fill: 'none', ...ink })).join('')}</g>`;
    });
    let children = '';
    if (node.kind === 'frame') {
      const mask = designFrameMask(document, node);
      children = node.childIds.filter((id) => id !== mask?.id).map((id) => layer(id)).join('');
      if (mask) children = `<g clip-path="${defs.clip(positionedDesignOutline(mask.node, scene[mask.id]))}">${children}</g>`;
      if (node.clip !== false) children = `<g clip-path="${defs.clip(outline)}">${children}</g>`;
    }
    const [first, ...rest] = outlines;
    const centered = !hasLayeredDesignPaint(node) && strokes[0] && (strokes[0].alignment ?? 'center') === 'center';
    const content = centered ? `${first}${children}${rest.join('')}` : `${children}${outlines.join('')}`;
    return `<g${svgAttributes({ transform, opacity: node.opacity, 'data-layer': node.name })}>${painted}${content}</g>`;
  }

  const content = ids.map((id) => layer(id, true)).join('');
  return `<svg${svgAttributes({ xmlns: 'http://www.w3.org/2000/svg', width: bounds.width, height: bounds.height,
    viewBox: [bounds.x, bounds.y, bounds.width, bounds.height].map(svgNumber).join(' ') })}>`
    + `<title>${escapeDesignMarkup(title)}</title>${defs.markup()}${content}</svg>\n`;
}
