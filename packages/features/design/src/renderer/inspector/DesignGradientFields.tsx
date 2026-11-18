import { Minus, Plus } from 'lucide-react';
import { useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { IconButton, SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignGradient, DesignGradientStop } from '../../contracts/index.js';
import { DesignStyleContext, DesignStyleSelect } from '../styles/DesignStyleSelect.js';
import { colorWithOpacity } from '../design-paint.js';
import { NumberField, PaintField } from './DesignInspectorFields.js';

export function DesignGradientFields({ gradient, disabled, onSave, onPreview, translate: t }: Readonly<{
  gradient: DesignGradient; disabled: boolean; onSave(value: DesignGradient): Promise<boolean>;
  onPreview(value: DesignGradient | undefined): void; translate: RendererTranslate;
}>) {
  const { styles } = useContext(DesignStyleContext);
  const [draft, setDraft] = useState<{ gradient: DesignGradient; index: number; offset: number }>();
  const preview = draft?.gradient === gradient ? draft : undefined;
  const resolvedStops = gradient.stops.map((stop) => {
    const shared = stop.styleId && styles && Object.hasOwn(styles, stop.styleId) ? styles[stop.styleId] : undefined;
    return shared?.kind === 'color' ? { ...stop, color: shared.color } : stop;
  });
  function withStop(index: number, patch: Partial<DesignGradientStop>): DesignGradient {
    const stops = gradient.stops.map((stop, at) => at === index ? { ...stop, ...patch } : stop);
    return { ...gradient, stops: stops.sort((a, b) => a.offset - b.offset) };
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
    void onSave({ ...gradient, stops: [...gradient.stops.slice(0, at + 1), next, ...gradient.stops.slice(at + 1)] });
  }
  const kind = t('feature.design.fillType');
  const position = t('feature.design.gradientPosition');
  const opacity = t('feature.design.opacity');
  return <div className="design-gradient-fields">
    <div className="design-inspector__pair">
      <SelectField aria-label={kind} value={gradient.kind} disabled={disabled} onValueChange={(kind) => {
        if (kind === 'linear' || kind === 'radial') void onSave({ ...gradient, kind });
      }}>
        <option value="linear">{t('feature.design.fillType.linear')}</option>
        <option value="radial">{t('feature.design.fillType.radial')}</option>
      </SelectField>
      {gradient.kind === 'linear' ? <NumberField label={t('feature.design.gradientAngle')} prefix="∠" suffix="°"
        value={gradient.angle ?? 90} readOnly={disabled} onSave={(angle) => onSave({ ...gradient, angle })} /> : null}
    </div>
    <DesignGradientRail stops={resolvedStops} gradient={gradient} draft={preview} disabled={disabled} translate={t}
      onChange={(index, offset) => {
        setDraft(offset === undefined ? undefined : { gradient, index, offset });
        onPreview(offset === undefined ? undefined : withStop(index, { offset }));
      }} onSave={(index, offset) => onSave(withStop(index, { offset }))} />
    <div className="design-gradient-stops" role="group" aria-label={t('feature.design.gradientStops')}>
      <div className="design-gradient-stop">
        <div className="design-gradient-stop__labels" aria-hidden="true">
          <span>{t('feature.design.color')}</span><span>{position}</span><span>{opacity}</span>
        </div>
        <IconButton className="design-gradient-fields__add" size="small" label={t('feature.design.addStop')}
          disabled={disabled || gradient.stops.length >= 16} onClick={addStop}><Plus size={14} /></IconButton>
      </div>
      {gradient.stops.map((stop, index) => {
        const { color } = resolvedStops[index];
        return <div className="design-gradient-stop" key={index}>
          <div className="design-inspector__paint-controls design-gradient-stop__controls">
            <div className="design-gradient-stop__color">
              <PaintField label={t('feature.design.gradientStop', { number: index + 1 })} value={color} disabled={disabled}
                onPreview={(color) => onPreview(color === undefined ? undefined : withStop(index, { color, styleId: undefined }))}
                onSave={(color) => onSave(withStop(index, { color, styleId: undefined }))} />
            </div>
            <div className="design-gradient-stop__numbers">
              <NumberField label={position} prefix={position} suffix="%" readOnly={disabled}
                value={stop.offset * 100} previewValue={preview?.index === index ? preview.offset * 100 : undefined}
                min={0} max={100} onSave={(offset) => onSave(withStop(index, { offset: offset / 100 }))} />
              <NumberField label={opacity} prefix={opacity} suffix="%" readOnly={disabled}
                value={(stop.opacity ?? 1) * 100} min={0} max={100}
                onSave={(opacity) => onSave(withStop(index, { opacity: opacity / 100 }))} />
            </div>
          </div>
          <div className="design-inspector__paint-actions design-gradient-stop__actions">
            <DesignStyleSelect kind="color" value={stop.styleId} disabled={disabled} compact translate={t}
              onChange={(styleId, style) => { void onSave(withStop(index, { styleId, color: style?.kind === 'color' ? style.color : color })); }} />
            <IconButton size="small" label={t('feature.design.removeStop')} disabled={disabled || gradient.stops.length <= 2}
              onClick={() => { void onSave({ ...gradient, stops: gradient.stops.filter((_, at) => at !== index) }); }}><Minus size={14} /></IconButton>
          </div>
        </div>;
      })}
    </div>
  </div>;
}

type StopDrag = Readonly<{
  gradient: DesignGradient; pointerId: number; index: number; start: number; width: number; offset: number;
  change(index: number, offset: number | undefined): void;
}>;

function DesignGradientRail({ gradient, stops, draft, disabled, onChange, onSave, translate: t }: Readonly<{
  gradient: DesignGradient; stops: readonly DesignGradientStop[]; draft?: Readonly<{ index: number; offset: number }>;
  disabled: boolean; onChange(index: number, offset: number | undefined): void;
  onSave(index: number, offset: number): Promise<boolean>; translate: RendererTranslate;
}>) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<StopDrag>();
  const positions = stops.map((stop, index) => draft?.index === index ? { ...stop, offset: draft.offset } : stop);
  const stopsCss = [...positions].sort((a, b) => a.offset - b.offset)
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
    {positions.map((stop, index) => <button type="button" key={index} role="slider" className="design-gradient-track__stop"
      aria-label={t('feature.design.gradientStop', { number: index + 1 })} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(stop.offset * 100)} disabled={disabled}
      style={{ left: `${stop.offset * 100}%`, backgroundColor: colorWithOpacity(stop.color, stop.opacity) }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || drag.current) return;
        const width = track.current?.getBoundingClientRect().width;
        if (!width) return;
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
