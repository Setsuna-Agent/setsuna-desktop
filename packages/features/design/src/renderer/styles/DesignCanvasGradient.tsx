import { useRef, type CSSProperties, type PointerEvent, type RefObject } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignGradient } from '../../contracts/index.js';
import { rotatePoint, toLocal, toWorld, type Point } from '../design-geometry.js';
import type { DesignLayerBox } from '../design-layout.js';
import { colorWithOpacity } from '../design-paint.js';
import {
  designGradientGeometry, designGradientStopOffset, designGradientStopPoint, designGradientWithAxis,
  type designGradientPaintSpace,
} from './design-gradient-geometry.js';
import { toCanvasScreen, toCanvasWorld, type CanvasViewport } from '../use-design-canvas-gestures.js';
import './design-canvas-gradient.css';

type Grip = 'start' | 'end' | number;
type Press = { pointerId: number; grip: Grip; origin: Point; offset: number };

export function DesignCanvasGradient({ source, gradient, pose, space, viewport, surface, disabled, selectedStop, onSelectStop, onPreview, onSave, translate: t }: Readonly<{
  source: DesignGradient;
  gradient: DesignGradient;
  pose: DesignLayerBox;
  space: ReturnType<typeof designGradientPaintSpace>;
  viewport: CanvasViewport;
  surface: RefObject<HTMLDivElement>;
  disabled: boolean;
  selectedStop: number;
  onSelectStop(index: number): void;
  onPreview(value: DesignGradient | undefined): void;
  onSave(value: DesignGradient, selectedStop: number): Promise<void>;
  translate: RendererTranslate;
}>) {
  const press = useRef<Press>();
  const saving = useRef(false);
  const { shape, bounds } = space;
  const { width, height } = pose;
  const geometry = designGradientGeometry(gradient, bounds);
  const base = designGradientGeometry(source, bounds);
  const angular = source.kind === 'angular';
  const { scale } = viewport;

  function screen(point: Point) {
    const world = toWorld(pose, { x: (point.x - shape.x) * width / shape.width, y: (point.y - shape.y) * height / shape.height });
    return { x: viewport.x + world.x * scale, y: viewport.y + world.y * scale };
  }

  function pointer(event: PointerEvent<HTMLButtonElement>) {
    const element = surface.current;
    if (!element) return;
    const local = toLocal(pose, toCanvasWorld(viewport, toCanvasScreen(element, { x: event.clientX, y: event.clientY })));
    return { x: shape.x + local.x * shape.width / width, y: shape.y + local.y * shape.height / height };
  }

  function change(active: Press, point: Point): DesignGradient {
    const delta = { x: point.x - active.origin.x, y: point.y - active.origin.y };
    const distance = Math.hypot(delta.x * width / shape.width, delta.y * height / shape.height) * scale;
    if (distance < 1) return source;
    const { start, end, radius } = base;
    const shift = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
    const grip = active.grip;
    if (typeof grip === 'number') {
      const stop = source.stops[grip];
      let wanted = shift(designGradientStopPoint(base, angular, stop.offset));
      if (angular) {
        const turn = Math.atan2(point.y - start.y, point.x - start.x) - Math.atan2(active.origin.y - start.y, active.origin.x - start.x);
        const angle = base.radians + stop.offset * Math.PI * 2;
        wanted = { x: start.x + Math.cos(angle + turn) * radius, y: start.y + Math.sin(angle + turn) * radius };
      }
      active.offset = designGradientStopOffset(base, angular, wanted, active.offset);
      if (active.offset === stop.offset) return source;
      return { ...source, stops: source.stops.map((stop, index) => index === grip ? { ...stop, offset: active.offset } : stop) };
    }
    const next = { start: grip === 'start' ? shift(start) : start,
      end: grip === 'end' || source.kind !== 'linear' ? shift(end) : end };
    const a = screen(next.start);
    const b = screen(next.end);
    return Math.hypot(a.x - b.x, a.y - b.y) >= 4 ? designGradientWithAxis(source, next, bounds) : source;
  }

  function release(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    event.stopPropagation();
    const active = press.current;
    if (!active || active.pointerId !== event.pointerId) return;
    press.current = undefined;
    const point = commit && !disabled ? pointer(event) : undefined;
    const next = point ? change(active, point) : source;
    if (next === source) { onPreview(undefined); return; }
    saving.current = true;
    onPreview(next);
    void onSave(next, typeof active.grip === 'number' ? active.grip : selectedStop).finally(() => { saving.current = false; });
  }

  function button(grip: Grip, point: Point, label: string, color?: string) {
    const isStop = typeof grip === 'number';
    return <button key={grip} type="button" className="design-canvas-gradient__handle"
      data-design-gradient-handle="" data-color-stop={isStop || undefined} aria-pressed={isStop ? selectedStop === grip : undefined}
      title={label} aria-label={label} disabled={disabled} tabIndex={-1}
      style={{ left: point.x, top: point.y, '--design-gradient-stop-color': color } as CSSProperties}
      onKeyDown={(event) => {
        if (press.current) {
          if (event.key === 'Escape') { press.current = undefined; onPreview(undefined); }
          event.preventDefault();
          event.stopPropagation();
        } else if (event.key.startsWith('Arrow') || event.code === 'Space') {
          // Keep focus on the handle without nudging the layer or entering pan mode.
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (press.current || saving.current) return;
        const origin = pointer(event);
        if (!origin) return;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        if (isStop) onSelectStop(grip);
        press.current = { pointerId: event.pointerId, grip, origin, offset: isStop ? source.stops[grip].offset : 0 };
      }} onPointerMove={(event) => {
        const active = press.current;
        if (!active || active.pointerId !== event.pointerId || disabled) return;
        event.stopPropagation();
        const point = pointer(event);
        if (point) {
          const next = change(active, point);
          onPreview(next === source ? undefined : next);
        }
      }} onPointerUp={(event) => release(event, true)} onPointerCancel={(event) => release(event, false)}
      onLostPointerCapture={(event) => release(event, false)} />;
  }

  function line(start: Point, end: Point, key?: number) {
    return <span key={key} className="design-canvas-gradient__line" aria-hidden="true" style={{
      left: start.x, top: start.y, width: Math.hypot(end.x - start.x, end.y - start.y),
      transform: `rotate(${Math.atan2(end.y - start.y, end.x - start.x)}rad)`,
    }} />;
  }

  const start = screen(geometry.start);
  const end = screen(geometry.end);
  const ring = source.kind === 'radial' || angular;
  const diamond = source.kind === 'diamond'
    ? [0, 0.25, 0.5, 0.75].map((phase) => screen(designGradientStopPoint(geometry, true, phase))) : undefined;
  const normal = rotatePoint({ x: 0, y: 16 }, Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI);
  return <div className="design-canvas-gradient">
    {ring ? <span className="design-canvas-gradient__ring" aria-hidden="true" style={{ left: start.x, top: start.y,
      width: geometry.radius * 2 * width / shape.width * scale, height: geometry.radius * 2 * height / shape.height * scale,
      transform: `translate(-50%, -50%) rotate(${pose.angle}deg)` }} /> : null}
    {diamond?.map((point, index) => line(point, diamond[(index + 1) % diamond.length], index))}
    {line(start, end)}
    {button('start', start, t(source.kind === 'linear' ? 'feature.design.gradientStart' : 'feature.design.gradientCenter'))}
    {button('end', end, t(source.kind === 'radial' || source.kind === 'diamond' ? 'feature.design.gradientRadius' : 'feature.design.gradientEnd'))}
    {gradient.stops.map((stop, index) => {
      const point = screen(designGradientStopPoint(geometry, angular, stop.offset));
      const chipGap = angular && stop.offset === 1 ? 32 : 16;
      const length = Math.hypot(point.x - start.x, point.y - start.y) || 1;
      const chip = angular ? { x: point.x + (point.x - start.x) * chipGap / length, y: point.y + (point.y - start.y) * chipGap / length }
        : { x: point.x + normal.x, y: point.y + normal.y };
      return button(index, chip, t('feature.design.gradientStop', { number: index + 1 }), colorWithOpacity(stop.color, stop.opacity));
    })}
  </div>;
}
