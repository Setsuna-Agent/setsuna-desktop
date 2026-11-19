import { Ellipse, Group, Label, Rect, Tag, Text } from 'react-konva';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { resolveDesignNodeStyles, type DesignDocument, type DesignPathGeometry } from '../contracts/index.js';
import { designFrameMask } from '../contracts/design-references.js';
import { DesignAlignedStroke } from './DesignAlignedStroke.js';
import { DesignCanvasImage, DesignImageShape } from './DesignCanvasImage.js';
import { designProjectedSourceId } from './components/design-components.js';
import { intersectBounds, toWorld, unreflect, type Bounds, type Point } from './design-geometry.js';
import { designLayerImagePaths, type LoadDesignImage } from './design-images.js';
import type { DesignScene } from './design-layout.js';
import { layerCornerRadius, layerPaint, visibleDesignStrokes, type DesignPaintPreview } from './design-paint.js';
import { designTextFont } from './design-text.js';
import { DesignCanvasText } from './text/DesignCanvasText.js';
import { designCanvasFills, designPaintAt, emptyDesignPaintImages, hasLayeredDesignPaint, type DesignPaintImages } from './styles/design-gradients.js';
import { DesignCanvasPaintImages } from './styles/DesignCanvasPaintImages.js';
import type { LayerPlacements } from './use-design-canvas-gestures.js';
import { DesignCanvasVector } from './vectors/DesignCanvasVector.js';
import { designMaskPath } from './vectors/design-shape-outline.js';

type CanvasRender = Readonly<{
  range: Bounds;
  scale: number;
  editingId: string | null;
  paintPreview?: DesignPaintPreview;
  cropPreview?: Readonly<{ id: string; value: Point }>;
  pathPreview?: Readonly<{ id: string; geometry: DesignPathGeometry }>;
  floating?: Readonly<{ id: string; center: Point }>;
  loadImage: LoadDesignImage;
  translate: RendererTranslate;
}>;
type ExportRender = Readonly<{ rootIds: readonly string[]; images: ReadonlyMap<string, HTMLImageElement> }>;

export function DesignCanvasLayers({ document, scene, placements, canvas, output }: Readonly<{
  document: DesignDocument;
  scene: DesignScene;
  placements?: LayerPlacements;
  canvas?: CanvasRender;
  output?: ExportRender;
}>) {
  const floating = canvas?.floating;

  function renderLayer(id: string, ancestorMoving = false, exportRoot = false, floatingCenter?: Point) {
    if (id === floating?.id && !floatingCenter) return null;
    const node = document.nodes[id];
    const box = scene[id];
    const move = placements?.[id];
    const moving = Boolean(move || floatingCenter) || ancestorMoving;
    const clipsChildren = node.kind === 'frame' && node.clip !== false;
    if (!box.visible || id === canvas?.editingId) return null;
    if (canvas && !moving && (node.kind !== 'frame' || clipsChildren)
      && (!box.visibleBounds || !intersectBounds(canvas.range, box.visibleBounds))) return null;
    const { x, y } = move ?? box;
    const width = move?.width ?? box.width;
    const height = move?.height ?? box.height;
    const center = floatingCenter ?? (exportRoot ? toWorld(box, { x: width / 2, y: height / 2 }) : { x: x + width / 2, y: y + height / 2 });
    const worldPose = exportRoot || Boolean(floatingCenter);
    const rotation = worldPose ? box.angle : move?.rotation ?? node.rotation ?? 0;
    const scaleX = worldPose ? box.scaleX : node.flipX ? -1 : 1;
    const scaleY = worldPose ? box.scaleY : node.flipY ? -1 : 1;
    const source = canvas?.paintPreview || canvas?.cropPreview || canvas?.pathPreview ? designProjectedSourceId(id, node) : id;
    const draft = canvas?.paintPreview?.nodes.get(source);
    const paintNode = draft && document.styles ? resolveDesignNodeStyles(draft, document.styles) : draft ?? node;
    const strokes = visibleDesignStrokes(paintNode);
    const [firstStroke] = strokes;
    const glyph = node.kind === 'text' || node.kind === 'vector';
    const centered = !hasLayeredDesignPaint(paintNode) && (glyph || !firstStroke?.alignment || firstStroke.alignment === 'center');
    const paint = layerPaint(paintNode, centered ? firstStroke : undefined);
    const outlines = centered ? (strokes.length > 1 ? strokes.slice(1) : []) : strokes;
    const radius = layerCornerRadius(node, width, height);
    const mask = node.kind === 'frame' ? designFrameMask(document, node) : undefined;
    const children = node.kind === 'frame' ? node.childIds.filter((id) => id !== mask?.id).map((childId) => renderLayer(childId, moving)) : null;
    const image = node.kind === 'image' ? output?.images.get(node.assetPath) : undefined;
    const imageNode = node.kind === 'image' && canvas?.cropPreview?.id === source ? { ...node, crop: canvas.cropPreview.value } : node;
    const scale = canvas?.scale ?? 1;
    const frameTitle = canvas && node.kind === 'frame' && !node.group && box.parentId === null
      ? node.name || canvas.translate('feature.design.artboard') : undefined;

    const paintPaths = canvas && paintNode.kind !== 'image' ? designLayerImagePaths(paintNode, true) : [];
    function renderPaint(images: DesignPaintImages) {
      const fills = node.kind === 'frame' || node.kind === 'rectangle' || node.kind === 'ellipse'
        ? designCanvasFills(paintNode, { x: node.kind === 'ellipse' ? -width / 2 : 0,
          y: node.kind === 'ellipse' ? -height / 2 : 0, width, height }, images) : [];
      return <>
        {node.kind === 'frame' ? <>
          {fills.map((fill, index) => <Rect key={index} name="design-frame-interior" width={width} height={height}
            cornerRadius={radius} {...fill} {...designPaintAt(paint, index, fills.length)} />)}
          <Group listening={!node.instanceOf} clipFunc={clipsChildren ? (context) => {
            context.beginPath();
            context.roundRect(0, 0, width, height, radius);
          } : undefined}>
            {mask ? <Group clipFunc={() => designMaskPath(mask.node, { ...scene[mask.id], ...placements?.[mask.id] })}>{children}</Group> : children}
          </Group>
        </> : null}
        {node.kind === 'rectangle' ? fills.map((fill, index) => <Rect key={index} width={width} height={height} cornerRadius={radius}
          {...fill} {...designPaintAt(paint, index, fills.length)} />) : null}
        {node.kind === 'ellipse' ? fills.map((fill, index) => <Ellipse key={index} x={width / 2} y={height / 2} radiusX={width / 2} radiusY={height / 2}
          {...fill} {...designPaintAt(paint, index, fills.length)} />) : null}
        {paintNode.kind === 'vector' ? <DesignCanvasVector
          geometry={canvas?.pathPreview?.id === source ? canvas.pathPreview.geometry : paintNode.geometry}
          width={width} height={height} node={paintNode} paint={paint} outlines={outlines} images={images} interactive={Boolean(canvas)} /> : null}
        {paintNode.kind === 'text' ? <>
          <Rect width={width} height={height} fill="transparent" />
          <DesignCanvasText node={paintNode} width={width} height={height} paint={paint} outlines={outlines} images={images} />
        </> : null}
        {imageNode.kind === 'image' && canvas ? <DesignCanvasImage key={imageNode.assetPath} node={imageNode}
          width={width} height={height} loadImage={canvas.loadImage} translate={canvas.translate} paint={paint} /> : null}
        {image && node.kind === 'image' ? <DesignImageShape node={node} image={image} width={width} height={height} paint={paint} /> : null}
        {glyph ? null : outlines.map((stroke, index) => <DesignAlignedStroke key={index} stroke={stroke} width={width}
          height={height} radius={radius} ellipse={node.kind === 'ellipse'} />)}
      </>;
    }

    return <Group key={id} id={id} name="design-hit-layer"
      {...center} offsetX={width / 2} offsetY={height / 2} rotation={rotation}
      scaleX={scaleX} scaleY={scaleY} listening={!box.locked && !floatingCenter}>
      <Group opacity={node.opacity ?? 1}>
        {canvas && paintPaths.length ? <DesignCanvasPaintImages paths={paintPaths} loadImage={canvas.loadImage}>
          {renderPaint}
        </DesignCanvasPaintImages> : renderPaint(output?.images ?? emptyDesignPaintImages)}
      </Group>
      {frameTitle ? <>
        {!strokes.length ? <Rect width={width} height={height} cornerRadius={radius}
          stroke="rgba(68,54,87,0.20)" strokeWidth={1 / scale} fillEnabled={false} listening={false} /> : null}
        <Group {...unreflect(width, height, { scaleX, scaleY })}>
          <ArtboardLabel title={frameTitle} width={width} scale={scale} />
        </Group>
      </> : null}
    </Group>;
  }

  return <>
    {(output?.rootIds ?? document.rootIds).map((id) => renderLayer(id, false, Boolean(output)))}
    {floating ? renderLayer(floating.id, false, false, floating.center) : null}
  </>;
}

function ArtboardLabel({ title, width, scale }: Readonly<{ title: string; width: number; scale: number }>) {
  const label = title.trim().split('\n', 1)[0] || title;
  const maxWidth = Math.max(80, Math.min(240, width * scale));
  return <Label y={-27 / scale}>
    <Tag fill="#4a4255" cornerRadius={5 / scale} />
    <Text text={label} width={label.length * 11 + 12 > maxWidth ? maxWidth / scale : undefined}
      padding={5 / scale} fontSize={11 / scale} fontFamily={designTextFont} fill="#faf6ff" wrap="none" ellipsis />
  </Label>;
}
