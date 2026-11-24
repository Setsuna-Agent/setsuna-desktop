import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Focus, Minimize, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { lazy, Suspense, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Button, Dialog, Dropdown, IconButton, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument, DesignInteraction } from '../../contracts/index.js';
import type { CaptureDesignWebImages } from '../canvas/use-design-web-previews.js';
import type { LoadDesignImage } from '../design-images.js';
import type { DesignScene } from '../design-layout.js';
import { DesignPrototypeZoomControls, type DesignPrototypeZoom } from './DesignPrototypeZoomControls.js';
import { advanceDesignPrototype, type PrototypeState } from './design-prototype.js';
import './design-prototype.css';

const DesignPrototypeBoard = lazy(() => import('./DesignPrototypeBoard.js'));
type ScrollPosition = Readonly<{ left: number; top: number }>;
type BoardSlide = 'forward' | 'backward';
type Playback = Readonly<{ route: PrototypeState; historyScroll: readonly ScrollPosition[]; scrollTo: ScrollPosition; slide?: BoardSlide }>;
type ZoomAnchor = Readonly<{ viewport: HTMLElement; artwork: HTMLElement; x: number; y: number }>;

function startPlayback(board: string, slide?: BoardSlide): Playback {
  return { route: { board, history: [], overlays: [] }, historyScroll: [], scrollTo: { left: 0, top: 0 }, slide };
}

function boardSlide(boards: readonly string[], from: string, to: string): BoardSlide | undefined {
  if (from === to) return;
  return boards.indexOf(to) < boards.indexOf(from) ? 'backward' : 'forward';
}

function updateEdgeNavigation(event: PointerEvent<HTMLDivElement>) {
  if (event.pointerType !== 'mouse') return;
  const player = event.currentTarget;
  if (!(event.target instanceof Node) || !player.contains(event.target)) {
    delete player.dataset.edge;
    return;
  }
  const { left, right, width } = player.getBoundingClientRect();
  const band = Math.min(80, width / 4);
  // The edge has no hit layer of its own, so links and scrollbars stay interactive.
  const edge = event.clientX - left < band ? 'left' : right - event.clientX < band ? 'right' : undefined;
  if (edge === player.dataset.edge) return;
  if (edge) player.dataset.edge = edge;
  else delete player.dataset.edge;
}

export function DesignPrototypePreview({ document, scene, boards, start, loadImage, captureWebImages, onClose, translate: t }: Readonly<{
  document: DesignDocument; scene: DesignScene; boards: readonly string[]; start: string;
  loadImage: LoadDesignImage; captureWebImages: CaptureDesignWebImages; onClose(): void; translate: RendererTranslate;
}>) {
  const [playback, setPlayback] = useState(() => startPlayback(start));
  const [zoom, setZoom] = useState<DesignPrototypeZoom>('window');
  const [fittedScale, setFittedScale] = useState(1);
  const [showHotspots, setShowHotspots] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const activeOverlay = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<ZoomAnchor>();
  const { route, scrollTo, slide } = playback;
  const boardIndex = Math.max(0, boards.indexOf(route.board));
  const board = boards[boardIndex];
  const previousBoard = boardIndex > 0 ? boards[boardIndex - 1] : undefined;
  const nextBoard = boards[boardIndex + 1];
  const overlays = route.overlays.filter((id) => boards.includes(id));
  const topOverlay = overlays.at(-1);
  const referenceSize = board ? scene[board]?.paintBounds : undefined;
  const canGoBack = Boolean(topOverlay || route.history.some((id) => boards.includes(id)));
  const boardName = (id: string) => document.nodes[id]?.name || t('feature.design.artboard');

  useLayoutEffect(() => {
    if (page.current) {
      page.current.scrollLeft = scrollTo.left;
      page.current.scrollTop = scrollTo.top;
    }
  }, [board, scrollTo]);

  useLayoutEffect(() => {
    (topOverlay ? activeOverlay.current : page.current)?.focus({ preventScroll: true });
  }, [board, topOverlay]);

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    zoomAnchor.current = undefined;
    if (!anchor?.artwork.isConnected) return;
    const { viewport, artwork, x, y } = anchor;
    viewport.scrollLeft = artwork.offsetLeft + x * artwork.clientWidth - viewport.clientWidth / 2;
    viewport.scrollTop = artwork.offsetTop + y * artwork.clientHeight - viewport.clientHeight / 2;
  }, [zoom]);

  function changeZoom(next: DesignPrototypeZoom) {
    if (next === zoom) return;
    const viewport = topOverlay ? activeOverlay.current : page.current;
    const artwork = viewport?.querySelector<HTMLElement>('.design-prototype-board');
    if (viewport && artwork?.clientWidth && artwork.clientHeight) {
      // Keep the same point of the artwork centered as its scroll area changes.
      zoomAnchor.current = { viewport, artwork,
        x: (viewport.scrollLeft + viewport.clientWidth / 2 - artwork.offsetLeft) / artwork.clientWidth,
        y: (viewport.scrollTop + viewport.clientHeight / 2 - artwork.offsetTop) / artwork.clientHeight };
    }
    setZoom(next);
  }

  function activate(interaction: DesignInteraction) {
    const currentScroll = { left: page.current?.scrollLeft ?? 0, top: page.current?.scrollTop ?? 0 };
    setPlayback((current) => {
      const route = advanceDesignPrototype(current.route, interaction, boards);
      if (route === current.route) return current;
      const depth = route.history.length;
      const previousDepth = current.route.history.length;
      const slide = boardSlide(boards, current.route.board, route.board);
      // Each visit owns its scroll position, including repeated visits to the same artboard.
      if (depth > previousDepth) return { route, historyScroll: [...current.historyScroll, currentScroll], scrollTo: { left: 0, top: 0 }, slide };
      if (depth < previousDepth) return { route, historyScroll: current.historyScroll.slice(0, depth),
        scrollTo: current.historyScroll[depth] ?? { left: 0, top: 0 }, slide };
      return { ...current, route };
    });
  }

  function restart() {
    const first = boards.includes(start) ? start : boards[0];
    if (first) setPlayback((current) => startPlayback(first, boardSlide(boards, current.route.board, first)));
  }

  function renderBoard(id: string, interactive: boolean) {
    if (!referenceSize) return null;
    return <Suspense fallback={<span className="sd-spinner design-prototype-loading" aria-hidden="true" />}>
      <DesignPrototypeBoard key={id} id={id} document={document} scene={scene} boards={boards} referenceSize={referenceSize}
        loadImage={loadImage} captureWebImages={captureWebImages} interactive={interactive}
        showHotspots={showHotspots} onAction={activate}
        onScaleChange={id === board && typeof zoom !== 'number' ? setFittedScale : undefined} translate={t} />
    </Suspense>;
  }

  const presentationOptions: MenuItem = {
    key: 'presentation-options', label: t('feature.design.prototype.options'), icon: <SlidersHorizontal size={14} />,
    children: [
      { key: 'back', label: t('feature.design.prototype.back'), icon: <ArrowLeft size={14} />, disabled: !canGoBack,
        onClick: () => activate({ kind: 'back' }) },
      { key: 'restart', label: t('feature.design.prototype.restart'), icon: <RotateCcw size={14} />, onClick: restart },
      { key: 'hotspots', label: t('feature.design.prototype.hotspots'), icon: <Focus size={14} />,
        onClick: () => setShowHotspots((shown) => !shown) },
    ],
  };

  return <Dialog className="design-prototype-presentation" width="var(--app-scaled-viewport-width, 100dvw)"
    aria-label={t('feature.design.prototype.preview')} showClose={false} dismissible={false} onClose={onClose}
    onEscapeKeyDown={(event) => {
      event.preventDefault();
      if (topOverlay) activate({ kind: 'close' });
      else onClose();
    }}>
    <div className="design-prototype-player" data-zoom={typeof zoom === 'number' ? 'manual' : zoom}
      onPointerMove={updateEdgeNavigation} onPointerLeave={(event) => { delete event.currentTarget.dataset.edge; }}
      style={typeof zoom === 'number' ? { '--design-prototype-scale': zoom } as CSSProperties : undefined}>
      <div className="design-prototype-viewport">
        {board ? <div className="design-prototype-screen" data-board-slide={slide} ref={page} role="region" aria-label={boardName(board)}
          tabIndex={0} aria-hidden={topOverlay ? true : undefined} {...{ inert: topOverlay ? '' : undefined }}>
          {renderBoard(board, !topOverlay)}
        </div> : null}
        {overlays.map((id) => <div key={id} className="design-prototype-screen design-prototype-overlay"
          ref={id === topOverlay ? activeOverlay : undefined} role="region" aria-label={boardName(id)}
          tabIndex={0} aria-hidden={id !== topOverlay || undefined} {...{ inert: id === topOverlay ? undefined : '' }}>
          {renderBoard(id, id === topOverlay)}
        </div>)}
      </div>
      {previousBoard ? <IconButton className="design-prototype-edge" data-side="left" label={t('feature.design.prototype.previousBoard')}
        onClick={() => activate({ kind: 'navigate', targetId: previousBoard })}><ChevronLeft size={22} strokeWidth={1.8} aria-hidden="true" /></IconButton> : null}
      {nextBoard ? <IconButton className="design-prototype-edge" data-side="right" label={t('feature.design.prototype.nextBoard')}
        onClick={() => activate({ kind: 'navigate', targetId: nextBoard })}><ChevronRight size={22} strokeWidth={1.8} aria-hidden="true" /></IconButton> : null}
      {board ? <Dropdown modal placement="bottomLeft" menu={{
        selectedKeys: [`board:${board}`, ...(showHotspots ? ['hotspots'] : [])],
        items: [...boards.map((id): MenuItem => ({
          key: `board:${id}`, label: boardName(id), onClick: () => activate({ kind: 'navigate', targetId: id }),
        })), presentationOptions],
      }}>
        <Button className="design-prototype-corner design-prototype-current-board" size="small" variant="ghost"
          aria-label={t('feature.design.prototype.currentBoard')} title={boardName(board)}>
          <span>{boardName(board)}</span><ChevronDown size={13} aria-hidden="true" />
        </Button>
      </Dropdown> : null}
      <IconButton className="design-prototype-corner design-prototype-exit" size="small"
        label={t('feature.design.prototype.exit')} onClick={onClose}><Minimize size={15} /></IconButton>
      {board ? <DesignPrototypeZoomControls zoom={zoom} scale={typeof zoom === 'number' ? zoom : fittedScale}
        onChange={changeZoom} translate={t} /> : null}
    </div>
  </Dialog>;
}
