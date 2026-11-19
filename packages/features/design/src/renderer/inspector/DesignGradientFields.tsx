import { ArrowLeftRight, Minus, Plus, RotateCw } from 'lucide-react';
import { useContext, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { IconButton, SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designGradientKinds, maxDesignGradientStops, type DesignGradient, type DesignGradientStop } from '../../contracts/index.js';
import type { Bounds } from '../design-geometry.js';
import { changeDesignGradientKind, designGradientAngle, designGradientGeometry, rotateDesignGradient, type DesignGradientTarget } from '../styles/design-gradient-geometry.js';
import { DesignGradientSessionContext, sortDesignGradientStops } from '../styles/DesignGradientSession.js';
import { designColorStyle, DesignStyleContext, DesignStyleSelect, type DesignStyleChoice } from '../styles/DesignStyleSelect.js';
import { colorWithOpacity } from '../design-paint.js';
import { NumberField } from './DesignInspectorFields.js';
import { ColorField } from './DesignPaintField.js';
import { designOptionEdits } from './design-inspector-edit.js';

const fallbackBounds: Bounds = { x: 0, y: 0, width: 1, height: 1 };

export function DesignGradientFields({ gradient, target, bounds = fallbackBounds, disabled, onSave, onPreview, translate: t }: Readonly<{
  gradient: DesignGradient; disabled: boolean; onSave(value: DesignGradient): Promise<boolean>;
  target?: DesignGradientTarget; bounds?: Bounds;
  onPreview(value: DesignGradient | undefined): void; translate: RendererTranslate;
}>) {
  const { styles } = useContext(DesignStyleContext);
  const access = useContext(DesignGradientSessionContext);
  const owner = useId();
  const setSession = access?.setSession;
  const { layerId, stack, index } = target ?? {};
  const session = access?.session?.owner === owner ? access.session : undefined;
  const canvasDraft = session?.draft?.source === gradient ? session.draft.value : undefined;
  const [focusedStop, setFocusedStop] = useState(0);
  const selectedStop = Math.min(session?.selectedStop ?? focusedStop, gradient.stops.length - 1);
  const blocked = disabled || Boolean(canvasDraft);
  useEffect(() => {
    if (!setSession || layerId === undefined || stack === undefined || index === undefined) return;
    setSession({ owner, target: { layerId, stack, index }, selectedStop: 0 });
    return () => { setSession((current) => current?.owner === owner ? undefined : current); };
  }, [index, layerId, owner, setSession, stack]);

  const [draft, setDraft] = useState<{ source: DesignGradient; gradient: DesignGradient; typed: boolean }>();
  const activeDraft = draft?.source === gradient ? draft : undefined;
  function resolveStop(stop: DesignGradientStop) {
    const shared = designColorStyle(styles, stop.styleId);
    return shared ? { ...stop, color: shared.color } : stop;
  }
  function previewGradient(next: DesignGradient | undefined, typed: boolean) {
    setDraft(next ? { source: gradient, gradient: next, typed } : undefined);
    onPreview(next && sortDesignGradientStops(next, selectedStop).value);
  }
  function selectStop(index: number) {
    if (!session) setFocusedStop(index);
    else setSession?.((current) => current?.owner === owner ? { ...current, selectedStop: index } : current);
  }
  function withStop(index: number, patch: Partial<DesignGradientStop>) {
    const stops = gradient.stops.map((stop, at) => at === index ? { ...stop, ...patch } : stop);
    return { ...gradient, stops };
  }
  async function saveStop(index: number, patch: Partial<DesignGradientStop>) {
    const next = sortDesignGradientStops(withStop(index, patch), index);
    const saved = await onSave(next.value);
    if (saved) selectStop(next.selectedStop);
    return saved;
  }
  function addStop() {
    let gap = 0;
    let at = 0;
    for (let index = 1; index < gradient.stops.length; index += 1) {
      const distance = gradient.stops[index].offset - gradient.stops[index - 1].offset;
      if (distance >= gap) { gap = distance; at = index - 1; }
    }
    const previous = gradient.stops[at];
    const next = { ...previous, offset: previous.offset + gap / 2 };
    void onSave({ ...gradient, stops: [...gradient.stops.slice(0, at + 1), next, ...gradient.stops.slice(at + 1)] })
      .then((saved) => { if (saved) selectStop(at + 1); });
  }
  function reverseStops() {
    const stops = [...gradient.stops].reverse().map((stop) => ({ ...stop, offset: 1 - stop.offset }));
    void onSave({ ...gradient, stops }).then((saved) => { if (saved) selectStop(stops.length - 1 - selectedStop); });
  }
  function removeStop(index: number) {
    void onSave({ ...gradient, stops: gradient.stops.filter((_, at) => at !== index) })
      .then((saved) => { if (saved) selectStop(index < selectedStop ? selectedStop - 1 : selectedStop); });
  }
  const kind = t('feature.design.gradient');
  const position = t('feature.design.gradientPosition');
  const opacity = t('feature.design.opacity');
  const angle = designGradientAngle(designGradientGeometry(gradient, bounds));
  const canRotate = gradient.kind !== 'radial';
  return <div className="design-gradient-fields">
    <div className="design-gradient-fields__toolbar">
      <SelectField aria-label={kind} value={gradient.kind} disabled={blocked}
        {...designOptionEdits(designGradientKinds, {
          onSave: (kind) => onSave(changeDesignGradientKind(gradient, kind)),
          onPreview: (kind) => previewGradient(kind === undefined ? undefined : changeDesignGradientKind(gradient, kind), false),
        })}>
        {designGradientKinds.map((kind) => <option key={kind} value={kind}>{t(`feature.design.fillType.${kind}`)}</option>)}
      </SelectField>
      {canRotate ? <NumberField
        label={t('feature.design.gradientAngle')} suffix="°" value={angle} readOnly={blocked}
        previewValue={canvasDraft && designGradientAngle(designGradientGeometry(canvasDraft, bounds))}
        onPreview={(angle) => previewGradient(angle === undefined ? undefined : rotateDesignGradient(gradient, bounds, angle), true)}
        onSave={(angle) => onSave(rotateDesignGradient(gradient, bounds, angle))} /> : null}
      <IconButton size="small" label={t('feature.design.reverseGradient')} disabled={blocked} onClick={reverseStops}>
        <ArrowLeftRight size={14} />
      </IconButton>
      {canRotate ? <IconButton size="small" label={t('feature.design.rotateGradient')} disabled={blocked}
        onClick={() => { void onSave(rotateDesignGradient(gradient, bounds, (angle + 90) % 360)); }}>
        <RotateCw size={14} />
      </IconButton> : null}
    </div>
    <DesignGradientRail stops={(canvasDraft ?? activeDraft?.gradient ?? gradient).stops.map(resolveStop)} gradient={gradient} disabled={blocked} translate={t}
      selectedStop={selectedStop} onSelectStop={selectStop}
      onChange={(index, offset) => previewGradient(offset === undefined ? undefined : withStop(index, { offset }), false)}
      onSave={(index, offset) => saveStop(index, { offset })} />
    <div className="design-gradient-stops" role="group" aria-label={t('feature.design.gradientStops')}>
      <div className="design-gradient-stops__header">
        <span>{t('feature.design.gradientStops')}</span>
        <IconButton size="small" label={t('feature.design.addStop')} disabled={blocked || gradient.stops.length >= maxDesignGradientStops}
          onClick={addStop}><Plus size={14} /></IconButton>
      </div>
      {gradient.stops.map((stop, index) => {
        const { color } = resolveStop(stop);
        const link = ({ id, style }: DesignStyleChoice) => ({ styleId: id, color: style?.kind === 'color' ? style.color : color });
        const sourceName = stop.styleId ? designColorStyle(styles, stop.styleId)?.name ?? t('feature.design.unavailableStyle') : undefined;
        const previewOffset = (canvasDraft ?? (!activeDraft?.typed ? activeDraft?.gradient : undefined))?.stops[index].offset;
        return <div className="design-gradient-stop" key={index} data-selected={selectedStop === index || undefined}
          onFocus={() => selectStop(index)}>
          <NumberField label={position} suffix="%" readOnly={blocked} value={stop.offset * 100}
            previewValue={previewOffset === undefined || previewOffset === stop.offset ? undefined : previewOffset * 100} min={0} max={100}
            onPreview={(offset) => previewGradient(offset === undefined ? undefined : withStop(index, { offset: offset / 100 }), true)}
            onSave={(offset) => saveStop(index, { offset: offset / 100 })} />
          <ColorField label={t('feature.design.gradientStop', { number: index + 1 })} value={color} displayName={sourceName} disabled={blocked}
            onPreview={(color) => previewGradient(color === undefined ? undefined : withStop(index, { color }), true)}
            onSave={(color) => saveStop(index, { color })}
            opacityField={<NumberField label={opacity} suffix="%" readOnly={blocked}
              value={(stop.opacity ?? 1) * 100} min={0} max={100}
              onPreview={(opacity) => previewGradient(opacity === undefined ? undefined : withStop(index, { opacity: opacity / 100 }), true)}
              onSave={(opacity) => saveStop(index, { opacity: opacity / 100 })} />}
            link={<DesignStyleSelect kind="color" value={stop.styleId} disabled={blocked} compact translate={t}
              onPreview={(choice) => previewGradient(choice && withStop(index, link(choice)), false)}
              onChange={(choice) => { void saveStop(index, link(choice)); }} />} />
          <IconButton size="small" label={t('feature.design.removeStop')} disabled={blocked || gradient.stops.length <= 2}
            onClick={() => removeStop(index)}><Minus size={14} /></IconButton>
        </div>;
      })}
    </div>
  </div>;
}

type StopDrag = Readonly<{
  gradient: DesignGradient; pointerId: number; index: number; start: number; width: number; offset: number;
  change(index: number, offset: number | undefined): void;
}>;

function DesignGradientRail({ gradient, stops, disabled, selectedStop, onSelectStop, onChange, onSave, translate: t }: Readonly<{
  gradient: DesignGradient; stops: readonly DesignGradientStop[];
  disabled: boolean; onChange(index: number, offset: number | undefined): void;
  selectedStop: number; onSelectStop(index: number): void;
  onSave(index: number, offset: number): Promise<boolean>; translate: RendererTranslate;
}>) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<StopDrag>();
  const stopsCss = [...stops].sort((a, b) => a.offset - b.offset)
    .map((stop) => `${colorWithOpacity(stop.color, stop.opacity)} ${stop.offset * 100}%`).join(', ');
  useEffect(() => () => {
    const active = drag.current;
    active?.change(active.index, undefined);
    drag.current = undefined;
  }, []);

  function point(start: StopDrag, x: number) {
    if (x === start.start) return start.offset;
    return Math.round(Math.max(0, Math.min(1, start.offset + (x - start.start) / start.width)) * 100) / 100;
  }

  function releaseDrag() {
    const active = drag.current;
    drag.current = undefined;
    active?.change(active.index, undefined);
  }

  function release(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = undefined;
    const offset = point(active, event.clientX);
    if (commit && !disabled && active.gradient === gradient && offset !== active.offset) {
      onChange(active.index, offset);
      void onSave(active.index, offset).finally(() => active.change(active.index, undefined));
    } else active.change(active.index, undefined);
  }

  return <div ref={track} className="design-gradient-track" style={{ '--design-gradient': `linear-gradient(to right, ${stopsCss})` } as CSSProperties}>
    {stops.map((stop, index) => <button type="button" key={index} role="slider" className="design-gradient-track__stop"
      data-selected={selectedStop === index || undefined} onFocus={() => onSelectStop(index)}
      aria-label={t('feature.design.gradientStop', { number: index + 1 })} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(stop.offset * 100)} disabled={disabled}
      style={{ left: `${stop.offset * 100}%`, backgroundColor: colorWithOpacity(stop.color, stop.opacity) }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || drag.current) return;
        const width = track.current?.getBoundingClientRect().width;
        if (!width) return;
        onSelectStop(index);
        drag.current = { gradient, pointerId: event.pointerId, index, start: event.clientX, width, offset: stop.offset, change: onChange };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }} onPointerMove={(event) => {
        const active = drag.current;
        if (!disabled && active?.gradient === gradient && active.pointerId === event.pointerId) onChange(index, point(active, event.clientX));
      }} onPointerUp={(event) => release(event, true)} onPointerCancel={(event) => release(event, false)}
      onLostPointerCapture={(event) => release(event, false)} onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); releaseDrag(); return; }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const step = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01);
        void onSave(index, Math.round(Math.max(0, Math.min(1, stop.offset + step)) * 100) / 100);
      }} />)}
  </div>;

}
