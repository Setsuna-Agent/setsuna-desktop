import type { DesignFrame, DesignLayout, DesignNode, DesignStroke } from '../../contracts/index.js';
import { designFrameMask } from '../../contracts/design-references.js';
import { toWorld, type Bounds } from '../design-geometry.js';
import { designPadding, designSizeMode, participatesInDesignFlow, type DesignLayerBox } from '../design-layout.js';
import { colorWithOpacity, compositeDesignFill, layerCornerRadius, visibleDesignStrokes } from '../design-paint.js';
import { designFontStack, designTextStyle } from '../design-text.js';
import { designCssBackground, designCssFill, hasLayeredDesignPaint, visibleDesignFills } from '../styles/design-gradients.js';
import { designTextSegments } from '../text/design-rich-text.js';
import type { DesignExportSelection } from './design-export-scene.js';
import { defaultImageCrop } from '../design-image-fit.js';
import { designVectorShape } from '../vectors/design-vector.js';
import { positionedDesignOutline } from '../vectors/design-shape-outline.js';
import { createDesignSvgDefs, escapeDesignMarkup as escapeHtml, svgPaintedPaths } from './design-svg-markup.js';

export type DesignCodeFormat = 'html' | 'html-tailwind';
type Styles = Record<string, string>;

// These utilities are embedded as a fallback so saved HTML also opens offline.
const utilities = {
  absolute: 'position:absolute',
  relative: 'position:relative',
  flex: 'display:flex',
  'flex-row': 'flex-direction:row',
  'flex-col': 'flex-direction:column',
  'flex-none': 'flex:none',
  'items-start': 'align-items:flex-start',
  'items-center': 'align-items:center',
  'items-end': 'align-items:flex-end',
  'justify-start': 'justify-content:flex-start',
  'justify-center': 'justify-content:center',
  'justify-end': 'justify-content:flex-end',
  'justify-between': 'justify-content:space-between',
  'justify-around': 'justify-content:space-around',
  'overflow-hidden': 'overflow:hidden',
  'whitespace-pre-wrap': 'white-space:pre-wrap',
  'break-words': 'overflow-wrap:break-word',
} as const;
type Utility = keyof typeof utilities;
const justifyUtility: Record<NonNullable<DesignLayout['justify']>, Utility> = {
  start: 'justify-start', center: 'justify-center', end: 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around',
};
const px = (value: number) => `${Number(value.toFixed(3))}px`;
const textStroke = (stroke: DesignStroke) => `${px(stroke.width)} ${colorWithOpacity(stroke.color, stroke.opacity)}`;

export function renderDesignHtml(
  { document, scene, ids }: DesignExportSelection, bounds: Bounds,
  images: ReadonlyMap<string, HTMLImageElement>, title: string, format: DesignCodeFormat,
): string {
  const used = new Set<Utility>();
  const defs = createDesignSvgDefs(images);
  const first = document.nodes[ids[0]];
  const firstBox = scene[ids[0]];
  const responsiveRoot = ids.length === 1 && first?.kind === 'frame' && first.layout && !firstBox.angle
    && firstBox.scaleX === 1 && firstBox.scaleY === 1 ? ids[0] : undefined;
  function attributes(style: Styles, ...classes: Utility[]): string {
    const declarations = Object.entries(style).map(([key, value]) => `${key}:${value}`);
    if (format === 'html') declarations.push(...classes.map((item) => utilities[item]));
    else classes.forEach((item) => used.add(item));
    const className = format === 'html-tailwind' && classes.length ? ` class="${classes.join(' ')}"` : '';
    return `${className} style="${escapeHtml(declarations.join(';'))}"`;
  }

  function paintLayers(node: DesignNode, text?: string) {
    return visibleDesignFills(node).map((fill) => {
      const style: Styles = { inset: '0', 'pointer-events': 'none', 'border-radius': 'inherit' };
      if (fill.image) {
        const image = images.get(fill.image.assetPath);
        if (!image) return '';
        const size = fill.image.fit === 'stretch' ? '100% 100%' : fill.image.fit;
        style.background = `center / ${size} no-repeat url(${JSON.stringify(image.src)})`;
        if (fill.opacity !== undefined) style.opacity = String(fill.opacity);
      } else style.background = designCssFill(fill);
      if (fill.blendMode && fill.blendMode !== 'normal') style['mix-blend-mode'] = fill.blendMode;
      if (text !== undefined) {
        style['background-clip'] = 'text';
        style['-webkit-text-fill-color'] = 'transparent';
        style['-webkit-text-stroke-width'] = '0';
        style['user-select'] = 'none';
      }
      return `<span aria-hidden="true"${attributes(style, 'absolute')}>${text ?? ''}</span>`;
    }).join('');
  }

  function layer(id: string, depth: number, parent?: DesignFrame): string {
    const node = document.nodes[id];
    const box = scene[id];
    if (!box.visible) return '';
    const indent = '  '.repeat(depth);
    const name = node.name ? ` data-layer="${escapeHtml(node.name)}"` : '';
    const root = !parent;
    const flow = Boolean(parent?.layout && participatesInDesignFlow(node, id, parent));
    const responsive = root && id === responsiveRoot;
    const widthMode = designSizeMode(node, flow ? parent : undefined, 'width');
    const heightMode = designSizeMode(node, flow ? parent : undefined, 'height');
    const horizontal = parent?.layout?.direction === 'horizontal';
    const grow = flow && (horizontal ? widthMode : heightMode) === 'fill';
    const stretch = flow && (horizontal ? heightMode : widthMode) === 'fill';
    const center = root ? toWorld(box, { x: box.width / 2, y: box.height / 2 }) : undefined;
    const rotation = root ? box.angle : node.rotation ?? 0;
    const scaleX = root ? box.scaleX : node.flipX ? -1 : 1;
    const scaleY = root ? box.scaleY : node.flipY ? -1 : 1;
    const style: Styles = {
      width: widthMode === 'hug' ? 'max-content' : widthMode === 'fill' ? 'auto' : responsive ? '100%' : px(box.width),
      height: heightMode !== 'fixed' || node.kind === 'text' ? 'auto' : px(box.height),
    };
    if (node.minWidth !== undefined || flow) style['min-width'] = px(node.minWidth ?? 0);
    if (node.maxWidth !== undefined) style['max-width'] = px(node.maxWidth);
    if (grow) {
      style.flex = '1 1 0px';
      style['min-height'] = '0';
    }
    if (stretch) style['align-self'] = 'stretch';
    if (!flow && !responsive) {
      style.left = px(center ? center.x - box.width / 2 - bounds.x : box.x);
      style.top = px(center ? center.y - box.height / 2 - bounds.y : box.y);
    }
    const position: Utility[] = flow ? (grow ? ['relative'] : ['relative', 'flex-none']) : [responsive ? 'relative' : 'absolute'];
    if (rotation || scaleX !== 1 || scaleY !== 1) style.transform = `rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
    if (node.opacity !== undefined) style.opacity = String(node.opacity);
    const strokes = visibleDesignStrokes(node);
    if (node.kind === 'vector') {
      const shape = designVectorShape(node.geometry, box.width, box.height);
      const shadow = node.shadow?.hidden ? undefined : node.shadow;
      style.overflow = 'visible';
      if (shadow) style.filter = `drop-shadow(${px(shadow.x)} ${px(shadow.y)} ${px(shadow.blur)} ${colorWithOpacity(shadow.color, shadow.opacity ?? 0.38)})`;
      const paths = svgPaintedPaths(shape.paths, defs.fills(node, shape.viewBox), strokes, Math.max(shape.scaleX, shape.scaleY) || 1);
      const { x, y, width, height } = shape.viewBox;
      return `${indent}<svg${name}${attributes(style, ...position)} viewBox="${x} ${y} ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${paths}</svg>\n`;
    }
    const layered = hasLayeredDesignPaint(node);
    const insetStrokes = applyAppearance(style, node, box, strokes, layered);
    if (node.kind === 'text') {
      const content = designTextSegments(node.text, node.runs).map(({ text, run }) => {
        if (!run) return escapeHtml(text);
        const overrides: Styles = {};
        if (run.color) overrides.color = run.color;
        if (run.fontSize) overrides['font-size'] = px(run.fontSize);
        if (run.fontFamily) overrides['font-family'] = designFontStack(run.fontFamily);
        if (run.fontWeight) overrides['font-weight'] = String(run.fontWeight);
        return `<span${attributes(overrides)}>${escapeHtml(text)}</span>`;
      }).join('');
      // Overlay the additional outlines while keeping a single selectable text flow.
      const outlines = strokes.slice(1).map((stroke) => `<span aria-hidden="true"${attributes({ inset: '0', 'pointer-events': 'none',
        'user-select': 'none', '-webkit-text-fill-color': 'transparent', '-webkit-text-stroke': textStroke(stroke) }, 'absolute')}>${content}</span>`).join('');
      const body = layered ? `${paintLayers(node, content)}<span${attributes({}, 'relative')}>${content}</span>` : content;
      return `${indent}<div${name}${attributes(style, ...position, 'whitespace-pre-wrap', 'break-words')}>${body}${outlines}</div>\n`;
    }
    if (node.kind === 'image') {
      const src = images.get(node.assetPath)?.src ?? '';
      const crop = node.fit === 'contain' ? defaultImageCrop : node.crop ?? defaultImageCrop;
      const imageStyle = { 'object-fit': node.fit ?? 'cover', 'object-position': `${crop.x * 100}% ${crop.y * 100}%` };
      const source = ` src="${escapeHtml(src)}" alt=""`;
      if (strokes.some((stroke) => stroke.alignment !== 'outside')) {
        // A replaced <img> does not show inset shadows. Paint the outlines over its pixels.
        const { 'box-shadow': border, ...wrapper } = style;
        const pixels = attributes({ ...imageStyle, display: 'block', width: '100%', height: '100%' });
        const overlay = attributes({ inset: '0', 'box-shadow': border, 'pointer-events': 'none' }, 'absolute');
        return `${indent}<div${name}${attributes(wrapper, ...position)}><img${pixels}${source}><span aria-hidden="true"${overlay}></span></div>\n`;
      }
      return `${indent}<img${name}${attributes({ ...style, ...imageStyle }, ...position)}${source}>\n`;
    }
    const paints = layered ? paintLayers(node) : '';
    const inset = insetStrokes ? `<span aria-hidden="true"${attributes({ inset: '0', 'box-shadow': insetStrokes,
      'border-radius': 'inherit', 'pointer-events': 'none' }, 'absolute')}></span>` : '';
    if (node.kind === 'frame' && node.childIds.length) {
      const layout = node.layout;
      if (node.clip !== false) position.push('overflow-hidden');
      const mask = designFrameMask(document, node);
      const contentStyle: Styles = mask ? { width: '100%', height: heightMode === 'hug' ? 'auto' : '100%',
        'clip-path': defs.clip(positionedDesignOutline(mask.node, scene[mask.id])) } : style;
      const contentClasses: Utility[] = mask ? ['relative'] : position;
      if (layout) {
        contentStyle.padding = designPadding(layout).map(px).join(' ');
        contentStyle.gap = px(layout.gap);
        if (layout.wrap) {
          contentStyle['flex-wrap'] = 'wrap';
          contentStyle['align-content'] = 'flex-start';
        }
        contentClasses.push('flex', layout.direction === 'horizontal' ? 'flex-row' : 'flex-col',
          `items-${layout.align}`, justifyUtility[layout.justify ?? 'start']);
      }
      const children = node.childIds.filter((childId) => childId !== mask?.id).map((childId) => layer(childId, depth + (mask ? 2 : 1), node)).join('');
      const content = mask ? `${indent}  <div${attributes(contentStyle, ...contentClasses)}>\n${children}${indent}  </div>\n` : children;
      return `${indent}<div${name}${attributes(style, ...position)}>\n${paints}${content}${inset}${indent}</div>\n`;
    }
    return `${indent}<div${name}${attributes(style, ...position)}>${paints}${inset}</div>\n`;
  }
  const rootStyle = attributes(responsiveRoot ? { width: '100%' } : { width: px(bounds.width), height: px(bounds.height) }, 'relative');
  const body = `<div${rootStyle}>\n${ids.map((id) => layer(id, 1)).join('')}</div>`;
  const definitions = defs.markup();
  const svg = definitions ? `<svg aria-hidden="true" style="position:absolute;width:0;height:0">${definitions}</svg>\n` : '';
  const fallback = [...used].map((item) => `.${item}{${utilities[item]}}`).join('');
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>body{margin:0}*{box-sizing:border-box}${fallback}</style>\n</head>\n<body>\n${svg}${body}\n</body>\n</html>\n`;
}

function applyAppearance(style: Styles, node: DesignNode, box: DesignLayerBox, strokes: readonly DesignStroke[], layered: boolean) {
  const shadow = node.shadow && !node.shadow.hidden ? node.shadow : undefined;
  const shadowValue = shadow ? `${px(shadow.x)} ${px(shadow.y)} ${px(shadow.blur)} ${colorWithOpacity(shadow.color, shadow.opacity ?? 0.38)}` : '';
  if (node.kind === 'text') {
    const text = designTextStyle(node);
    style.color = layered ? 'transparent' : compositeDesignFill(node);
    if (!layered && visibleDesignFills(node).some((fill) => fill.gradient)) {
      style.background = designCssBackground(node);
      style['background-clip'] = 'text';
      style.color = 'transparent';
    }
    style.font = `${text.fontWeight} ${px(text.fontSize)}/${text.lineHeight} ${text.fontFamily}`;
    style['letter-spacing'] = px(text.letterSpacing);
    style['text-align'] = text.textAlign;
    if (shadowValue) style['text-shadow'] = shadowValue;
    if (strokes[0]) style['-webkit-text-stroke'] = textStroke(strokes[0]);
    return;
  }
  if (node.kind !== 'image' && !layered) style.background = designCssBackground(node);
  const radius = layerCornerRadius(node, box.width, box.height);
  if (node.kind === 'ellipse') style['border-radius'] = '50%';
  else if (radius) style['border-radius'] = Array.isArray(radius) ? radius.map(px).join(' ') : px(radius);
  const shadows: string[] = [];
  const insets: string[] = [];
  for (const stroke of [...strokes].reverse()) {
    const strokeColor = colorWithOpacity(stroke.color, stroke.opacity);
    if (stroke.alignment !== 'inside') shadows.push(`0 0 0 ${px(stroke.alignment === 'outside' ? stroke.width : stroke.width / 2)} ${strokeColor}`);
    if (stroke.alignment !== 'outside') insets.push(`inset 0 0 0 ${px(stroke.alignment === 'inside' ? stroke.width : stroke.width / 2)} ${strokeColor}`);
  }
  if (!layered) shadows.push(...insets);
  if (shadowValue) shadows.push(shadowValue);
  if (shadows.length) style['box-shadow'] = shadows.join(', ');
  return layered ? insets.join(', ') : undefined;
}
