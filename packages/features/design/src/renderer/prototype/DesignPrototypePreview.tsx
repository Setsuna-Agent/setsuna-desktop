import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { Dialog, IconButton, SelectField, useToast } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument, DesignInteraction } from '../../contracts/index.js';
import type { DesignScene } from '../design-layout.js';
import type { LoadDesignImage } from '../design-images.js';
import { loadExportImages } from '../export/design-export-scene.js';
import { renderDesignSvg } from '../export/export-design-svg.js';
import { designShapeOutline, designTransformMatrix } from '../vectors/design-shape-outline.js';
import { advanceDesignPrototype, designPrototypeHotspots, type PrototypeState } from './design-prototype.js';
import './design-prototype.css';

const emptyImages = new Map<string, HTMLImageElement>();
type PreviewProps = Readonly<{
  document: DesignDocument; scene: DesignScene; boards: readonly string[]; start: string;
  loadImage: LoadDesignImage; onClose(): void; translate: RendererTranslate;
}>;

export default function DesignPrototypePreview({ document, scene, boards, start, loadImage, onClose, translate: t }: PreviewProps) {
  const [state, setState] = useState<PrototypeState>(() => ({ board: start, history: [], overlays: [] }));
  const reset = (board: string) => setState({ board, history: [], overlays: [] });
  const activate = (interaction: DesignInteraction) => setState((current) => advanceDesignPrototype(current, interaction, boards));
  const board = boards.includes(state.board) ? state.board : boards[0];
  const overlays = state.overlays.filter((id) => boards.includes(id));
  const pages = board ? [board, ...overlays] : [];
  return <Dialog title={t('feature.design.prototype.preview')} width={1120} onClose={onClose} footer={<div className="design-prototype-controls">
    <IconButton size="small" label={t('feature.design.prototype.back')} disabled={!state.history.length && !state.overlays.length}
      onClick={() => activate({ kind: 'back' })}><ArrowLeft size={16} /></IconButton>
    <SelectField aria-label={t('feature.design.prototype.target')} value={board ?? ''} onValueChange={(id) => { if (id) reset(id); }}>
      {boards.map((id) => <option value={id} key={id}>{document.nodes[id].name || t('feature.design.artboard')}</option>)}
    </SelectField>
    <IconButton size="small" label={t('feature.design.prototype.restart')} onClick={() => reset(start)}><RotateCcw size={15} /></IconButton>
  </div>}>
    <div className="design-prototype-viewport">
      {pages.map((id, index) => <div key={id} className={index ? 'design-prototype-overlay' : 'design-prototype-page'}
        aria-hidden={index !== pages.length - 1}>
        <PrototypeBoard id={id} document={document} scene={scene} loadImage={loadImage}
          interactive={index === pages.length - 1} onAction={activate} translate={t} />
      </div>)}
    </div>
  </Dialog>;
}

function PrototypeBoard({ id, document, scene, loadImage, interactive, onAction, translate: t }:
  Pick<PreviewProps, 'document' | 'scene' | 'loadImage' | 'translate'> &
  Readonly<{ id: string; interactive: boolean; onAction(interaction: DesignInteraction): void }>) {
  const [images, setImages] = useState<ReadonlyMap<string, HTMLImageElement>>(emptyImages);
  const prefix = useId();
  const toast = useToast();
  const box = scene[id];
  const bounds = box.paintBounds;
  const name = document.nodes[id].name || t('feature.design.artboard');
  const source = useMemo(() => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    renderDesignSvg({ document, scene, ids: [id] }, bounds, images, name),
  ), [bounds, document, id, images, name, scene]);
  const hotspots = useMemo(() => interactive ? designPrototypeHotspots(document, scene, id) : [], [document, id, interactive, scene]);
  useEffect(() => {
    let active = true;
    void loadExportImages({ document, scene, ids: [id] }, loadImage).then((images) => { if (active) setImages(images); })
      .catch((error: unknown) => { if (active) toast.error(t('feature.design.loadFailed', { error: String(error) })); });
    return () => { active = false; };
  }, [document, id, loadImage, scene, t, toast]);
  return <div className="design-prototype-board" style={{ width: bounds.width }}>
    <img src={source} alt={name} draggable={false} width={bounds.width} height={bounds.height} />
    {hotspots.length ? <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} className="design-prototype-hotspots">
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
