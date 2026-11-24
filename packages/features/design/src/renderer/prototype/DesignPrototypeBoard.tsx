import { Fragment, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useToast } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument, DesignInteraction } from '../../contracts/index.js';
import type { CaptureDesignWebImages, DesignWebImages } from '../canvas/use-design-web-previews.js';
import type { Bounds } from '../design-geometry.js';
import type { LoadDesignImage } from '../design-images.js';
import type { DesignScene } from '../design-layout.js';
import { designExportFontRequests, loadExportImages, loadExportWebImages, type DesignExportSelection } from '../export/design-export-scene.js';
import { renderDesignSvg } from '../export/export-design-svg.js';
import { DesignFontsContext } from '../text/use-design-fonts.js';
import { designShapeOutline, designTransformMatrix } from '../vectors/design-shape-outline.js';
import { designPrototypeHotspots } from './design-prototype.js';

const emptyAssets = { images: new Map<string, HTMLImageElement>(), fontCss: '' };

export default function DesignPrototypeBoard({ id, document, scene, boards, referenceSize, loadImage, captureWebImages,
  interactive, showHotspots, onAction, onScaleChange, translate: t }: Readonly<{
  id: string;
  document: DesignDocument;
  scene: DesignScene;
  boards: readonly string[];
  referenceSize: Pick<Bounds, 'width' | 'height'>;
  loadImage: LoadDesignImage;
  captureWebImages: CaptureDesignWebImages;
  interactive: boolean;
  showHotspots: boolean;
  onAction(interaction: DesignInteraction): void;
  onScaleChange?(scale: number): void;
  translate: RendererTranslate;
}>) {
  const [assets, setAssets] = useState(emptyAssets);
  const artwork = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const toast = useToast();
  const loadFontCss = useContext(DesignFontsContext)?.css;
  const bounds = scene[id].paintBounds;
  const name = document.nodes[id].name || t('feature.design.artboard');
  const selection = useMemo(() => ({ document, scene, ids: [id] }), [document, id, scene]);
  const [captured, setCaptured] = useState<{ selection: DesignExportSelection; images: DesignWebImages }>();
  const webImages = captured?.selection === selection ? captured.images : undefined;
  useEffect(() => {
    const controller = new AbortController();
    void loadExportWebImages(selection, captureWebImages, controller.signal, t).then((images) => {
      if (images && !controller.signal.aborted) setCaptured({ selection, images });
    }).catch(() => { if (!controller.signal.aborted) toast.error(t('feature.design.webLoadFailed')); });
    return () => controller.abort();
  }, [captureWebImages, selection, t, toast]);
  const source = useMemo(() => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    renderDesignSvg({ ...selection, webImages }, bounds, assets.images, name, assets.fontCss),
  ), [assets, bounds, name, selection, webImages]);
  const hotspots = useMemo(() => interactive ? designPrototypeHotspots(document, scene, id).filter(({ interaction }) =>
    !('targetId' in interaction) || boards.includes(interaction.targetId)) : [], [boards, document, id, interactive, scene]);
  useEffect(() => {
    let active = true;
    // The SVG is rendered as an image. It cannot see the canvas document's FontFaceSet.
    void Promise.all([loadExportImages(selection, loadImage), loadFontCss?.(designExportFontRequests(selection), false)])
      .then(([images, fontCss]) => { if (active) setAssets({ images, fontCss: fontCss ?? '' }); })
      .catch((error: unknown) => { if (active) toast.error(t('feature.design.loadFailed', { error: String(error) })); });
    return () => { active = false; };
  }, [loadFontCss, loadImage, selection, t, toast]);
  useLayoutEffect(() => {
    const element = artwork.current;
    if (!element || !onScaleChange) return;
    const report = (width: number) => { if (width > 0) onScaleChange(width / bounds.width); };
    report(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => report(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [bounds.width, onScaleChange]);

  // Overlays use the page's scale, limited by the space they can actually fit into.
  const sizing = {
    '--design-prototype-board-width': `${bounds.width}px`,
    '--design-prototype-fit-width': `${100 * bounds.width / referenceSize.width}cqw`,
    '--design-prototype-fit-height': `${100 * bounds.width / referenceSize.height}cqh`,
    '--design-prototype-height-limit': `${100 * bounds.width / bounds.height}cqh`,
  } as CSSProperties;
  return <div className="design-prototype-board" ref={artwork} style={sizing}>
    <img src={source} alt={name} draggable={false} width={bounds.width} height={bounds.height} />
    {hotspots.length ? <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      className="design-prototype-hotspots" data-show-hotspots={showHotspots}>
      <defs>{[...new Set(hotspots.flatMap(({ clips }) => clips))].map((id) => {
        const box = scene[id];
        return <clipPath id={`${prefix}-${id}`} key={id} transform={`matrix(${designTransformMatrix(box).join(' ')})`}>
          {designShapeOutline(document.nodes[id], box.width, box.height).map((path, index) =>
            <path key={index} d={path.data} clipRule={path.fillRule} transform={path.transform && `matrix(${path.transform.join(' ')})`} />)}
        </clipPath>;
      })}</defs>
      {hotspots.map(({ id: layerId, interaction, clips }) => {
        const node = document.nodes[layerId];
        const hit = scene[layerId];
        const target = <rect width={hit.width} height={hit.height} fill="transparent" role="button" tabIndex={0}
          aria-label={node.name || (node.kind === 'text' && node.text) || t(`feature.design.prototype.${interaction.kind}`)}
          transform={`matrix(${designTransformMatrix(hit).join(' ')})`}
          onClick={() => onAction(interaction)} onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            onAction(interaction);
          }} />;
        return <Fragment key={layerId}>{clips.reduceRight((child, id) =>
          <g clipPath={`url(#${prefix}-${id})`}>{child}</g>, target)}</Fragment>;
      })}
    </svg> : null}
  </div>;
}
