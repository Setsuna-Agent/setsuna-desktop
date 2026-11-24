import { designFontFamilies, designLayerShaderPaths, type DesignDocument, type DesignNode } from '../../contracts/index.js';
import { designFrameMask } from '../../contracts/design-references.js';
import { designFontNameKey } from '../../contracts/design-fonts.js';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { CaptureDesignWebImages, DesignWebImages, DesignWebLayer } from '../canvas/use-design-web-previews.js';
import { intersectBounds, transformedLocalBounds, unionBounds, type Bounds } from '../design-geometry.js';
import { designLayerImagePaths, type LoadDesignImage } from '../design-images.js';
import type { DesignLayerBox, DesignScene } from '../design-layout.js';
import { designStrokeBounds, designStrokeOutset, visibleDesignStrokes } from '../design-paint.js';
import type { DesignFontRequest } from '../text/design-font-loader.js';
import { designTextSegments } from '../text/design-rich-text.js';
import { designArrowInkBounds } from '../vectors/design-vector.js';

export type DesignExportSelection = Readonly<{ document: DesignDocument; scene: DesignScene; ids: readonly string[]; networkAccess?: boolean; webImages?: DesignWebImages }>;

function visitDesignExportLayers({ document, scene, ids }: DesignExportSelection, apply: (node: DesignNode, id: string) => void) {
  function visit(id: string) {
    if (!scene[id]?.visible) return;
    const node = document.nodes[id];
    apply(node, id);
    if (node.kind === 'frame') node.childIds.forEach(visit);
  }
  ids.forEach(visit);
}

function designExportAssetPaths(selection: DesignExportSelection, pathsFor: (node: DesignNode, visibleOnly: boolean) => readonly string[]) {
  const paths = new Set<string>();
  visitDesignExportLayers(selection, (node) => pathsFor(node, true).forEach((path) => paths.add(path)));
  return [...paths];
}

export const designExportImagePaths = (selection: DesignExportSelection) => designExportAssetPaths(selection, designLayerImagePaths);
export const designExportShaderPaths = (selection: DesignExportSelection) => designExportAssetPaths(selection, designLayerShaderPaths);

export function designExportScriptIds(selection: DesignExportSelection) {
  const ids: string[] = [];
  visitDesignExportLayers(selection, (node, id) => { if (node.kind === 'script' && node.scriptPath) ids.push(id); });
  return ids;
}

export function designExportWebLayers(selection: DesignExportSelection): readonly DesignWebLayer[] {
  const layers: DesignWebLayer[] = [];
  visitDesignExportPaint(selection, (node, box, id, clip) => {
    if (node.kind === 'web' && node.url && (!clip || intersectBounds(clip, box.paintBounds))) {
      layers.push({ id, node: { ...node, url: node.url }, box });
    }
  });
  return layers;
}

export async function loadExportWebImages(selection: DesignExportSelection, capture: CaptureDesignWebImages, signal: AbortSignal, t: RendererTranslate) {
  const layers = designExportWebLayers(selection);
  if (!layers.length) return;
  const images = await capture(layers, signal, selection.networkAccess);
  if (!images || layers.some(({ id }) => !images.has(id))) throw new Error(t('feature.design.webLoadFailed'));
  return images;
}

export async function loadExportImages(selection: DesignExportSelection, loadImage: LoadDesignImage) {
  return new Map(await Promise.all(designExportImagePaths(selection).map(async (path) => [path, await loadImage(path, { fresh: true })] as const)));
}

const systemFontFamilies = new Set<string>(designFontFamilies);

export function designExportFontRequests({ document, scene, ids }: Pick<DesignExportSelection, 'document' | 'ids'> & { scene?: DesignScene }) {
  const requests = new Map<string, DesignFontRequest>();
  function visit(id: string) {
    const node = document.nodes[id];
    if (scene ? !scene[id]?.visible : node.hidden) return;
    if (node.kind === 'text') for (const { text, run } of designTextSegments(node.text, node.runs)) {
      const family = run?.fontFamily ?? node.fontFamily;
      if (!family || !text || systemFontFamilies.has(family)) continue;
      const weight = run?.fontWeight ?? node.fontWeight ?? 400;
      const style = node.fontStyle ?? 'normal';
      requests.set(JSON.stringify([designFontNameKey(family), weight, style]), { family, weight, style });
    }
    if (node.kind === 'frame') node.childIds.filter((child) => child !== node.maskId).forEach(visit);
  }
  ids.forEach(visit);
  return [...requests.values()];
}

function visitDesignExportPaint({ document, scene, ids }: DesignExportSelection,
  apply: (node: DesignNode, box: DesignLayerBox, id: string, clip?: Bounds) => void,
) {
  function visit(id: string, clip?: Bounds | null) {
    const box = scene[id];
    if (!box.visible || clip === null) return;
    const node = document.nodes[id];
    apply(node, box, id, clip);
    if (node.kind === 'frame') {
      const childClip = node.clip === false ? clip : clip ? intersectBounds(clip, box.paintBounds) : box.paintBounds;
      const mask = designFrameMask(document, node);
      const maskBounds = mask && scene[mask.id].paintBounds;
      const maskedClip = maskBounds && childClip !== null
        ? childClip ? intersectBounds(childClip, maskBounds) : maskBounds : childClip;
      node.childIds.forEach((child) => { if (child !== mask?.id) visit(child, maskedClip); });
    }
  }
  ids.forEach((id) => visit(id));
}

export function designExportBounds(selection: DesignExportSelection): Bounds | undefined {
  const bounds: Bounds[] = [];
  visitDesignExportPaint(selection, (node, box, _id, clip) => {
    const ink = paintedBounds(node, box);
    const visible = clip ? intersectBounds(clip, ink) : ink;
    if (visible) bounds.push(visible);
  });
  return unionBounds(bounds);
}

function paintedBounds(node: DesignNode, box: DesignLayerBox): Bounds {
  const shadow = node.shadow?.hidden || node.shadow?.opacity === 0 ? undefined : node.shadow;
  const arrowInk = node.kind === 'vector' ? designArrowInkBounds(node, box.width, box.height) : undefined;
  const outside = arrowInk ? 0 : visibleDesignStrokes(node).reduce((outset, stroke) => {
    const alignment = node.kind === 'text' || node.kind === 'vector' ? 'center' : stroke.alignment;
    return Math.max(outset, designStrokeOutset(stroke.width, alignment));
  }, 0);
  if (!arrowInk && !outside && !shadow) return box.paintBounds;
  const local = arrowInk ?? designStrokeBounds({ x: 0, y: 0, width: box.width, height: box.height }, outside, 'outside');
  const outline = transformedLocalBounds(local, box);
  if (!shadow) return outline;
  const blurred = designStrokeBounds({ ...local, x: local.x + shadow.x, y: local.y + shadow.y }, shadow.blur * 2, 'outside');
  return unionBounds([outline, transformedLocalBounds(blurred, box)]) ?? outline;
}
