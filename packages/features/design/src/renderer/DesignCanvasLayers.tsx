import { createContext, memo, useContext } from 'react';
import { Ellipse, Group, Image, Label, Rect, Tag, Text } from 'react-konva';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { resolveDesignNodeStyles, type DesignDocument, type DesignPathGeometry } from '../contracts/index.js';
import { designFrameMask } from '../contracts/design-references.js';
import { designStylesForModes } from '../contracts/design-styles.js';
import { DesignAlignedStroke } from './DesignAlignedStroke.js';
import type { DrawingPreview } from './canvas/design-drawing.js';
import { isGeneratedScriptLayer } from './canvas/design-script-layers.js';
import { fitDesignWebDevice, type DesignWebImages } from './canvas/use-design-web-previews.js';
import { DesignCanvasImage, DesignImageShape } from './DesignCanvasImage.js';
import { designProjectedSourceId } from './components/design-components.js';
import { intersectBounds, toWorld, unreflect, type Bounds, type Point } from './design-geometry.js';
import { designPaintImagePaths, type LoadDesignImage } from './design-images.js';
import type { DesignShaderRender } from './shaders/design-canvas-shader.js';
import type { DesignScene } from './design-layout.js';
import { designStrokeNeedsSeparateLayer, layerCornerRadius, layerPaint, visibleDesignStrokes, type DesignPaintPreview } from './design-paint.js';
import { designTextFont } from './design-text.js';
import { DesignCanvasText } from './text/DesignCanvasText.js';
import { designCanvasFillProps, designCanvasFills, designPaintAt, emptyDesignPaintImages, hasLayeredDesignPaint, type DesignPaintImages } from './styles/design-gradients.js';
import { DesignCanvasPaintImages } from './styles/DesignCanvasPaintImages.js';
import { designPrototypeBoardFor } from './prototype/design-prototype.js';
import type { LayerPlacements } from './use-design-canvas-gestures.js';
import { DesignCanvasVector } from './vectors/DesignCanvasVector.js';
import { designMaskPath } from './vectors/design-shape-outline.js';

type CanvasRender = Readonly<{
  range: Bounds;
  editingId: string | null;
  inspect?: boolean;
  paintPreview?: DesignPaintPreview;
  cropPreview?: Readonly<{ id: string; value: Point }>;
  pathPreview?: Readonly<{ id: string; geometry: DesignPathGeometry }>;
  drawingPreviews?: readonly DrawingPreview[];
  floating?: Readonly<{ id: string; center: Point }>;
  inlineWebId?: string;
  loadImage: LoadDesignImage;
  translate: RendererTranslate;
}>;
type ExportRender = Readonly<{ rootIds: readonly string[]; images: ReadonlyMap<string, HTMLImageElement> }>;
type DesignCanvasLayersProps = Readonly<{
  document: DesignDocument;
  scene: DesignScene;
  placements?: LayerPlacements;
  canvas?: CanvasRender;
  output?: ExportRender;
  shaders?: DesignShaderRender;
  webImages?: DesignWebImages;
}>;

const ArtboardScaleContext = createContext(1);

export function DesignCanvasLayers({ scale = 1, ...props }: DesignCanvasLayersProps & { scale?: number }) {
  // Only artboard decorations use screen pixels. Zooming should not rebuild the document paint.
  return <ArtboardScaleContext.Provider value={scale}><DesignCanvasLayerTree {...props} /></ArtboardScaleContext.Provider>;
}

const DesignCanvasLayerTree = memo(function DesignCanvasLayerTree({ document, scene, placements, canvas, output, shaders, webImages }: DesignCanvasLayersProps) {
  const floating = canvas?.floating;
  const drawings = new Map<string | null, DrawingPreview[]>();
  for (const stroke of canvas?.drawingPreviews ?? []) {
    const siblings = drawings.get(stroke.parentId);
    if (siblings) siblings.push(stroke);
    else drawings.set(stroke.parentId, [stroke]);
  }
  const paintScopes = new Map<string | undefined, DesignDocument['styles']>();
  function paintStyles(id: string) {
    const boardId = designPrototypeBoardFor(id, scene);
    if (!paintScopes.has(boardId)) {
      const board = boardId ? document.nodes[boardId] : undefined;
      paintScopes.set(boardId, designStylesForModes(document.styles, document.documentId, board?.kind === 'frame' ? board.variableModeIds : undefined));
    }
    return paintScopes.get(boardId);
  }

  function drawingAt(parentId: string | null) {
    return drawings.get(parentId)?.map(({ id, node }) => {
      const strokes = visibleDesignStrokes(node);
      const separate = designStrokeNeedsSeparateLayer(strokes[0]);
      return <Group key={id} x={node.x + node.width / 2} y={node.y + node.height / 2}
        offsetX={node.width / 2} offsetY={node.height / 2} rotation={node.rotation}
        scaleX={node.flipX ? -1 : 1} scaleY={node.flipY ? -1 : 1} listening={false}>
        <DesignCanvasVector geometry={node.geometry} width={node.width} height={node.height} node={node}
          paint={layerPaint(node, separate ? undefined : strokes[0])} outlines={separate ? strokes : []}
          images={emptyDesignPaintImages} interactive={false} />
      </Group>;
    });
  }

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
    const painted = draft ? resolveDesignNodeStyles(draft, paintStyles(id)) : node;
    const paintNode = painted.kind === 'text' && node.kind === 'text' && painted.text !== node.text
      ? { ...painted, text: node.text, runs: node.runs } : painted;
    const strokes = visibleDesignStrokes(paintNode);
    const [firstStroke] = strokes;
    const glyph = node.kind === 'text' || node.kind === 'vector';
    const liveWeb = canvas?.inlineWebId === id;
    const webImage = node.kind === 'web' && !liveWeb ? webImages?.get(id) : undefined;
    const centered = !webImage && !hasLayeredDesignPaint(paintNode) && !designStrokeNeedsSeparateLayer(firstStroke)
      && (glyph || !firstStroke?.alignment || firstStroke.alignment === 'center');
    const paint = layerPaint(paintNode, centered ? firstStroke : undefined);
    const outlines = centered ? (strokes.length > 1 ? strokes.slice(1) : []) : strokes;
    const radius = layerCornerRadius(node, width, height);
    const mask = node.kind === 'frame' ? designFrameMask(document, node) : undefined;
    const children = node.kind === 'frame' ? <>
      {node.childIds.filter((id) => id !== mask?.id).map((childId) => renderLayer(childId, moving))}
      {drawingAt(id)}
    </> : null;
    const maskedChildren = mask ? <Group clipFunc={() => designMaskPath(mask.node, { ...scene[mask.id], ...placements?.[mask.id] })}>
      {children}
    </Group> : children;
    const image = node.kind === 'image' ? output?.images.get(node.assetPath) : undefined;
    const imageNode = node.kind === 'image' && canvas?.cropPreview?.id === source ? { ...node, crop: canvas.cropPreview.value } : node;
    const frameTitle = canvas && node.kind === 'frame' && !node.group && box.parentId === null
      ? node.name || canvas.translate('feature.design.artboard') : undefined;

    const paintPaths = canvas ? designPaintImagePaths(paintNode, true) : [];
    const shaderFill = shaders && { render: shaders, size: { width, height } };
    function renderPaint(images: DesignPaintImages) {
      const fills = node.kind === 'frame' || node.kind === 'rectangle' || node.kind === 'ellipse' || node.kind === 'web' || node.kind === 'script'
        ? designCanvasFills(paintNode, { x: node.kind === 'ellipse' ? -width / 2 : 0,
          y: node.kind === 'ellipse' ? -height / 2 : 0, width, height }, images, shaderFill) : [];
      return <>
        {node.kind === 'frame' ? <>
          {fills.map((fill, index) => <Rect key={index} name="design-frame-interior" width={width} height={height}
            cornerRadius={radius} {...designCanvasFillProps(fill)} {...designPaintAt(paint, index, fills.length)} />)}
          {clipsChildren || node.instanceOf ? <Group listening={!node.instanceOf} clipFunc={clipsChildren ? (context) => {
            context.beginPath();
            context.roundRect(0, 0, width, height, radius);
          } : undefined}>{maskedChildren}</Group> : maskedChildren}
        </> : null}
        {node.kind === 'rectangle' ? fills.map((fill, index) => <Rect key={index} width={width} height={height} cornerRadius={radius}
          {...designCanvasFillProps(fill)} {...designPaintAt(paint, index, fills.length)} />) : null}
        {node.kind === 'web' || node.kind === 'script' ? <>
          <Rect width={width} height={height} cornerRadius={radius} fill="rgba(108,124,144,0.14)" {...paint} />
          {fills.map((fill, index) => <Rect key={index} width={width} height={height} cornerRadius={radius} {...designCanvasFillProps(fill)} />)}
          {webImage ? <Group clipFunc={(context) => {
            context.beginPath();
            context.roundRect(0, 0, width, height, radius);
          }}>
            <Image image={webImage.image} {...fitDesignWebDevice({ width, height }, webImage.device)} listening={false} />
          </Group> : liveWeb ? null : <Text text={(node.kind === 'web' ? node.url && new URL(node.url).host : node.scriptPath?.split('/').at(-1)) ?? node.name}
            width={width} height={height} align="center" verticalAlign="middle" wrap="none" ellipsis padding={8}
            fontFamily={designTextFont} fontSize={14} fill="#717b89" listening={false} />}
        </> : null}
        {node.kind === 'ellipse' ? fills.map((fill, index) => <Ellipse key={index} x={width / 2} y={height / 2} radiusX={width / 2} radiusY={height / 2}
          {...designCanvasFillProps(fill)} {...designPaintAt(paint, index, fills.length)} />) : null}
        {paintNode.kind === 'vector' ? <DesignCanvasVector
          geometry={canvas?.pathPreview?.id === source ? canvas.pathPreview.geometry : paintNode.geometry}
          width={width} height={height} node={paintNode} paint={paint} outlines={outlines} images={images} shader={shaderFill} interactive={Boolean(canvas)} /> : null}
        {paintNode.kind === 'text' ? <>
          <Rect width={width} height={height} fill="transparent" />
          <DesignCanvasText node={paintNode} width={width} height={height} paint={paint} outlines={outlines} images={images} shader={shaderFill} />
        </> : null}
        {imageNode.kind === 'image' && canvas ? <DesignCanvasImage key={imageNode.assetPath} node={imageNode}
          width={width} height={height} loadImage={canvas.loadImage} translate={canvas.translate} paint={paint} /> : null}
        {image && node.kind === 'image' ? <DesignImageShape node={node} image={image} width={width} height={height} paint={paint} /> : null}
        {glyph ? null : outlines.map((stroke, index) => <DesignAlignedStroke key={index} stroke={stroke} width={width}
          height={height} radius={radius} ellipse={node.kind === 'ellipse'} images={images} />)}
      </>;
    }

    const inspectRoot = canvas?.inspect && box.parentId === null;
    const paintedLayer = canvas && paintPaths.length ? <DesignCanvasPaintImages paths={paintPaths} loadImage={canvas.loadImage}>
      {renderPaint}
    </DesignCanvasPaintImages> : renderPaint(output?.images ?? emptyDesignPaintImages);
    // Shader samplers use this group to read the layer's paint without its artboard label.
    const shaderPaint = shaders && 'fills' in paintNode && paintNode.fills?.some((fill) => fill.shader);
    const groupPaint = inspectRoot || shaderPaint || (node.opacity ?? 1) !== 1;
    return <Group key={id} id={id} name="design-hit-layer"
      {...center} offsetX={width / 2} offsetY={height / 2} rotation={rotation}
      scaleX={scaleX} scaleY={scaleY} listening={(inspectRoot || !box.locked) && !floatingCenter && !isGeneratedScriptLayer(id)}>
      {/* Treat the entire locked sample as one canvas target, including transparent areas. */}
      {inspectRoot ? <Rect width={width} height={height} fill="transparent" /> : null}
      {groupPaint ? <Group name="design-layer-paint" opacity={node.opacity ?? 1} listening={!inspectRoot}>{paintedLayer}</Group> : paintedLayer}
      {frameTitle ? <ArtboardDecoration title={frameTitle} width={width} height={height} radius={radius}
        outline={!strokes.length} scaleX={scaleX} scaleY={scaleY} /> : null}
    </Group>;
  }

  return <>
    {(output?.rootIds ?? document.rootIds).map((id) => renderLayer(id, false, Boolean(output)))}
    {floating ? renderLayer(floating.id, false, false, floating.center) : null}
    {drawingAt(null)}
  </>;
});

function ArtboardDecoration({ title, width, height, radius, outline, scaleX, scaleY }: Readonly<{
  title: string; width: number; height: number; radius: number | number[]; outline: boolean; scaleX: number; scaleY: number;
}>) {
  const scale = useContext(ArtboardScaleContext);
  return <>
    {outline ? <Rect width={width} height={height} cornerRadius={radius}
      stroke="rgba(68,54,87,0.20)" strokeWidth={1 / scale} fillEnabled={false} listening={false} /> : null}
    <Group {...unreflect(width, height, { scaleX, scaleY })}>
      <ArtboardLabel title={title} width={width} scale={scale} />
    </Group>
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
