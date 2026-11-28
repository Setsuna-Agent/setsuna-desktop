import { designFontFamilies, designLayerShaderPaths, type DesignDocument, type DesignNode } from '../../contracts/index.js';
import { designFrameMask } from '../../contracts/design-references.js';
import { designFontNameKey } from '../../contracts/design-fonts.js';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { CaptureDesignWebImages, DesignWebImages, DesignWebLayer } from '../canvas/use-design-web-previews.js';
import { directionOfRotation, intersectBounds, toLocal, transformedLocalBounds, unionBounds, type Bounds } from '../design-geometry.js';
import { designLayerImagePaths, type LoadDesignImage } from '../design-images.js';
import type { DesignLayerBox, DesignScene } from '../design-layout.js';
import { designFills, designStrokeBounds, designStrokeOutset, visibleDesignStrokes } from '../design-paint.js';
import type { DesignFontRequest } from '../text/design-font-loader.js';
import { designTextSegments } from '../text/design-rich-text.js';
import { designArrowInkBounds } from '../vectors/design-vector.js';

export type DesignExportSelection = Readonly<{
  document: DesignDocument; scene: DesignScene; ids: readonly string[]; paintedLayerIds?: ReadonlySet<string>;
  networkAccess?: boolean; webImages?: DesignWebImages;
}>;

function visitDesignExportLayers({ document, scene, ids, paintedLayerIds }: DesignExportSelection, apply: (node: DesignNode, id: string) => void) {
  function visit(id: string) {
    if (!scene[id]?.visible) return;
    const node = document.nodes[id];
    if (!paintedLayerIds || paintedLayerIds.has(id)) apply(node, id);
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

export function designArtboardPaintLayerIds(selection: DesignExportSelection): ReadonlySet<string> {
  const painted = new Set<string>();
  visitDesignExportPaint(selection, (node, box, id, clip) => {
    if (clip && intersectBounds(clip, paintedBounds(node, box))) painted.add(id);
  }, true);
  return painted;
}

function visitDesignExportPaint({ document, scene, ids }: DesignExportSelection,
  apply: (node: DesignNode, box: DesignLayerBox, id: string, clip?: Bounds) => void,
  cropArtboards = false,
) {
  function visit(id: string, clip?: Bounds | null, artboard?: DesignLayerBox) {
    const node = document.nodes[id];
    if (!scene[id].visible || clip === null || (artboard && node.opacity === 0)) return;
    const box = artboard ? boxInArtboard(node, scene[id], artboard) : scene[id];
    apply(node, box, id, clip);
    if (node.kind === 'frame') {
      let childClip = node.clip === false ? clip : clip ? intersectBounds(clip, box.paintBounds) : box.paintBounds;
      // An object sampler reads the frame's own raster, including pixels outside the published crop.
      if (artboard && clip && samplesOwnContent(node) && intersectBounds(clip, paintedBounds(node, box))) {
        childClip = node.clip === false && childClip ? unionBounds([childClip, box.paintBounds]) : box.paintBounds;
      }
      const mask = designFrameMask(document, node);
      const maskBounds = mask && (artboard ? boxInArtboard(mask.node, scene[mask.id], artboard) : scene[mask.id]).paintBounds;
      const maskedClip = maskBounds && childClip !== null
        ? childClip ? intersectBounds(childClip, maskBounds) : maskBounds : childClip;
      node.childIds.forEach((child) => { if (child !== mask?.id) visit(child, maskedClip, artboard); });
    }
  }
  for (const id of ids) {
    const artboard = cropArtboards ? scene[id] : undefined;
    visit(id, artboard && { x: 0, y: 0, width: artboard.width, height: artboard.height }, artboard);
  }
}

function boxInArtboard(node: DesignNode, box: DesignLayerBox, artboard: DesignLayerBox): DesignLayerBox {
  // Capture strips the artboard's rotation and reflections before clipping.
  const { x, y } = toLocal(artboard, { x: box.absoluteX, y: box.absoluteY });
  const pose = { absoluteX: x, absoluteY: y, angle: (box.angle - artboard.angle) * directionOfRotation(artboard),
    scaleX: box.scaleX * artboard.scaleX, scaleY: box.scaleY * artboard.scaleY };
  const { width, height } = box;
  const arrow = node.kind === 'vector' ? designArrowInkBounds(node, width, height) : undefined;
  return { ...box, ...pose, paintBounds: transformedLocalBounds(arrow ?? { x: 0, y: 0, width, height }, pose) };
}

function samplesOwnContent(node: DesignNode): boolean {
  return designFills(node).some(({ hidden, opacity, shader }) => !hidden && opacity !== 0
    && Object.values(shader?.uniforms ?? {}).some((value) => typeof value === 'object' && 'kind' in value && value.kind === 'object'));
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
