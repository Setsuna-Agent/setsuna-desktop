/*!
 * Adapted from beUI Color Picker: https://beui.dev/components/motion/color-picker
 * Copyright (c) 2026 Saurabh Chauhan
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { Pipette } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { IconButton } from '../button.js';
import { useUiLabels } from '../locale.js';
import { EASE_OUT, SPRING_LAYOUT, SPRING_PRESS } from '../motion.js';
import { Popover, type PopoverProps } from '../popover.js';
import { ToastNotice } from '../toast/provider.js';
import { cn } from '../utils.js';
import { clamp, hexToHsv, hsvToHex, type Hsv } from './color.js';
import { ColorChannelFields } from './color-channel-fields.js';

export type PickerColor = Readonly<{ color: string; opacity?: number }>;

export type ColorPickerProps = Readonly<{
  /** Hex color with an optional intrinsic alpha channel. */
  value: string;
  label: string;
  disabled?: boolean;
  mixed?: boolean;
  className?: string;
}> & Pick<PopoverProps, 'placement' | 'sideOffset' | 'getAnchorRect'> & Readonly<{
  opacity?: undefined;
  onValuePreview?(color: string | undefined): void;
  onValueCommit(color: string): Promise<boolean>;
  onColorPreview?: never;
  onColorCommit?: never;
} | {
  opacity: number;
  onColorPreview?(color: PickerColor | undefined): void;
  onColorCommit(color: PickerColor): Promise<boolean>;
  onValuePreview?: never;
  onValueCommit?: never;
}>;

export function ColorPicker({ value, opacity, label, placement, sideOffset, getAnchorRect, disabled = false, mixed = false, className,
  onValuePreview, onValueCommit, onColorPreview, onColorCommit }: ColorPickerProps) {
  const [preview, setPreview] = useState<{ value: string; opacity: number | undefined; paint: PickerColor }>();
  const active = preview?.value === value && preview.opacity === opacity ? preview.paint : undefined;
  const hasAlpha = /^#[\da-f]{8}$/iu.test(value);
  const color = hasAlpha ? value.slice(0, 7) : value;
  const alpha = hasAlpha ? Number.parseInt(value.slice(7), 16) / 255 : 1;
  const activeOpacity = active?.opacity ?? opacity;
  return <Popover placement={placement} sideOffset={sideOffset} getAnchorRect={getAnchorRect} className="sd-color-picker" contentLabel={label} hideWhenDetached
    content={<ColorPickerControls value={color} opacity={opacity} mixed={mixed} disabled={disabled}
      onPreview={(paint) => {
        setPreview(paint ? { value, opacity, paint } : undefined);
        onValuePreview?.(paint?.color);
        onColorPreview?.(paint);
      }} onCommit={onColorCommit ?? ((paint) => onValueCommit?.(paint.color) ?? Promise.resolve(false))} />}>
    <IconButton label={label} size="small" disabled={disabled} className={cn('sd-color-picker__trigger', className)}>
      <ColorPickerSwatch color={active?.color ?? color} opacity={hasAlpha ? (activeOpacity ?? 1) * alpha : activeOpacity} mixed={mixed && !active} />
    </IconButton>
  </Popover>;
}

export function ColorPickerSwatch({ color, opacity, mixed }: Readonly<PickerColor & { mixed?: boolean }>) {
  return <span className="sd-color-picker__swatch" data-mixed={mixed || undefined} data-translucent={opacity !== undefined && opacity < 1 || undefined}>
    {mixed ? null : <span style={{ background: color, opacity }} />}
  </span>;
}

export function ColorPickerControls({ value, opacity, disabled = false, mixed = false, onPreview, onCommit }: Readonly<{
  value: string;
  opacity?: number;
  disabled?: boolean;
  mixed?: boolean;
  onPreview(paint: PickerColor | undefined): void;
  onCommit(paint: PickerColor): Promise<boolean>;
}>) {
  const [draft, setDraft] = useState(() => ({ source: value, sourceOpacity: opacity, color: hexToHsv(value), opacity }));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const preview = useRef<{ paint: PickerColor; notify: typeof onPreview }>();
  const current = draft.source === value && draft.sourceOpacity === opacity
    ? draft : { source: value, sourceOpacity: opacity, color: hexToHsv(value, draft.color), opacity };
  const color = current.color;
  if (current !== draft) setDraft(current);
  const hex = hsvToHex(color);
  const blocked = disabled || saving;
  useEffect(() => clearPreview, []);

  function clearPreview() {
    const active = preview.current;
    preview.current = undefined;
    active?.notify(undefined);
  }

  function reset() {
    setDraft({ source: value, sourceOpacity: opacity, color: hexToHsv(value, color), opacity });
    clearPreview();
  }

  async function persist(next: PickerColor) {
    savingRef.current = true;
    setSaving(true);
    try {
      if (!await onCommit(next)) reset();
    } catch {
      reset();
    } finally {
      clearPreview();
      savingRef.current = false;
      setSaving(false);
    }
  }

  function update(patch: Partial<Hsv> & { opacity?: number }, commit: boolean) {
    if (blocked || savingRef.current) return;
    const next = {
      h: clamp(patch.h ?? color.h, 0, 360),
      s: clamp(patch.s ?? color.s, 0, 100),
      v: clamp(patch.v ?? color.v, 0, 100),
    };
    const nextOpacity = patch.opacity ?? current.opacity;
    const chosen = { color: hsvToHex(next), opacity: nextOpacity };
    setDraft({ source: value, sourceOpacity: opacity, color: next, opacity: nextOpacity });
    if (!mixed && chosen.color === value.toLowerCase() && chosen.opacity === opacity) {
      clearPreview();
      return;
    }
    if (preview.current?.paint.color !== chosen.color || preview.current?.paint.opacity !== chosen.opacity) {
      preview.current = { paint: chosen, notify: onPreview };
      onPreview(chosen);
    }
    if (commit) void persist(chosen);
  }

  return <div className="sd-color-picker__content" onKeyDown={(event) => event.stopPropagation()}>
    <ColorArea color={color} hex={hex} disabled={blocked} onUpdate={update} onCancel={reset} />
    <HueTrack color={color} disabled={blocked} onUpdate={update} onCancel={reset} />
    {current.opacity === undefined ? null : <AlphaTrack color={hex} opacity={current.opacity} disabled={blocked}
      onUpdate={(opacity, commit) => update({ opacity }, commit)} onCancel={reset} />}
    <ColorChannelFields hex={hex} color={color} opacity={current.opacity} disabled={blocked}
      leading={<EyeDropperButton disabled={blocked} onSample={(sample) => update(hexToHsv(sample, color), true)} />}
      onUpdate={update} onCancel={reset} />
  </div>;
}

type ColorControl = Readonly<{
  color: Hsv;
  disabled: boolean;
  onUpdate(patch: Partial<Hsv>, commit: boolean): void;
  onCancel(): void;
}>;

function ColorArea({ color, hex, disabled, onUpdate, onCancel }: ColorControl & { hex: string }) {
  const labels = useUiLabels().colorPicker;
  const drag = useColorDrag((x, y, commit) => onUpdate({ s: x * 100, v: (1 - y) * 100 }, commit), onCancel, disabled);
  const saturation = Math.round(color.s);
  const brightness = Math.round(color.v);
  return <div {...drag.handlers} ref={drag.railRef} className="sd-color-picker__area"
    data-disabled={disabled || undefined}
    style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${color.h} 100% 50%))` }}>
    <ColorThumb refElement={drag.thumbRef} x={color.s} y={100 - color.v} hex={hex} dragging={drag.dragging}
      label={labels.area} valueText={`${labels.saturation} ${saturation}%, ${labels.brightness} ${brightness}%`}
      value={saturation} max={100} disabled={disabled} onKeyDown={(event) => {
        if (disabled) return;
        const step = keyStep(event);
        if (!step) return;
        event.preventDefault();
        if (step === 'min' || step === 'max') onUpdate({ s: step === 'min' ? 0 : 100 }, true);
        else if (step.axis === 'x') onUpdate({ s: saturation + step.delta }, true);
        else onUpdate({ v: brightness + step.delta }, true);
      }} />
  </div>;
}

function HueTrack({ color, disabled, onUpdate, onCancel }: ColorControl) {
  const labels = useUiLabels().colorPicker;
  const drag = useColorDrag((x, _y, commit) => onUpdate({ h: x * 360 }, commit), onCancel, disabled);
  const hue = Math.round(color.h);
  return <div {...drag.handlers} className="sd-color-picker__hue" data-disabled={disabled || undefined}>
    <div className="sd-color-picker__rail" ref={drag.railRef}>
      <ColorThumb refElement={drag.thumbRef} x={color.h / 3.6} hex={`hsl(${color.h} 100% 50%)`} dragging={drag.dragging}
        label={labels.hue} valueText={`${hue}°`} value={hue} max={360} disabled={disabled} onKeyDown={(event) => {
          if (disabled) return;
          const step = keyStep(event);
          if (!step) return;
          event.preventDefault();
          onUpdate({ h: step === 'min' ? 0 : step === 'max' ? 360 : hue + step.delta }, true);
        }} />
    </div>
  </div>;
}

function AlphaTrack({ color, opacity, disabled, onUpdate, onCancel }: Readonly<{
  color: string; opacity: number; disabled: boolean; onUpdate(opacity: number, commit: boolean): void; onCancel(): void;
}>) {
  const label = useUiLabels().colorPicker.opacity;
  const drag = useColorDrag((x, _y, commit) => onUpdate(Math.round(x * 100) / 100, commit), onCancel, disabled);
  const percent = Math.round(opacity * 100);
  return <div {...drag.handlers} className="sd-color-picker__alpha" data-disabled={disabled || undefined}
    style={{ '--sd-color-alpha': `linear-gradient(to right, transparent, ${color})` } as CSSProperties}>
    <div className="sd-color-picker__rail" ref={drag.railRef}>
      <ColorThumb refElement={drag.thumbRef} x={percent} hex={color} dragging={drag.dragging} label={label}
        valueText={`${percent}%`} value={percent} max={100} disabled={disabled} onKeyDown={(event) => {
          if (disabled) return;
          const step = keyStep(event);
          if (!step) return;
          event.preventDefault();
          onUpdate(step === 'min' ? 0 : step === 'max' ? 1 : clamp(percent + step.delta, 0, 100) / 100, true);
        }} />
    </div>
  </div>;
}

function useColorDrag(onPoint: (x: number, y: number, commit: boolean) => void, onCancel: () => void, disabled: boolean) {
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; update: typeof onPoint }>();
  const [dragging, setDragging] = useState(false);

  function point(event: PointerEvent<HTMLDivElement>, update: typeof onPoint, commit: boolean) {
    const bounds = railRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return false;
    update(clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      clamp((event.clientY - bounds.top) / bounds.height, 0, 1), commit);
    return true;
  }

  function finish(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const active = pointer.current;
    if (!active || event.pointerId !== active.id) return;
    pointer.current = undefined;
    setDragging(false);
    if (!commit || disabled || !point(event, active.update, true)) onCancel();
  }

  return { railRef, thumbRef, dragging, handlers: {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (disabled || event.button !== 0 || pointer.current) return;
      // Keep the value and commit target from the start of this gesture.
      pointer.current = { id: event.pointerId, update: onPoint };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // An active pointer may already have been released by the platform.
      }
      thumbRef.current?.focus({ preventScroll: true });
      setDragging(true);
      point(event, onPoint, false);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const active = pointer.current;
      if (!disabled && active && event.pointerId === active.id) point(event, active.update, false);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, false),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event, false),
  } };
}

function keyStep(event: KeyboardEvent): { axis: 'x' | 'y'; delta: number } | 'min' | 'max' | undefined {
  const step = event.shiftKey ? 10 : 1;
  switch (event.key) {
    case 'ArrowLeft': return { axis: 'x', delta: -step };
    case 'ArrowRight': return { axis: 'x', delta: step };
    case 'ArrowUp': return { axis: 'y', delta: step };
    case 'ArrowDown': return { axis: 'y', delta: -step };
    case 'PageUp': return { axis: 'y', delta: 10 };
    case 'PageDown': return { axis: 'y', delta: -10 };
    case 'Home': return 'min';
    case 'End': return 'max';
    default: return undefined;
  }
}

function useGlide(target: number) {
  const reducedMotion = useReducedMotion();
  const spring = useSpring(target, SPRING_LAYOUT);
  useEffect(() => {
    if (reducedMotion) spring.jump(target);
    else spring.set(target);
  }, [reducedMotion, spring, target]);
  return useTransform(spring, (value) => `${clamp(value, 0, 100)}%`);
}

function ColorThumb({ refElement, x, y, hex, dragging, label, value, max, valueText, disabled, onKeyDown }: Readonly<{
  refElement: RefObject<HTMLDivElement>;
  x: number;
  y?: number;
  hex: string;
  dragging: boolean;
  label: string;
  value: number;
  max: number;
  valueText: string;
  disabled: boolean;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
}>) {
  const horizontal = useGlide(x);
  const vertical = useGlide(y ?? 50);
  const reducedMotion = useReducedMotion();
  const lift = dragging && !reducedMotion;
  return <motion.div ref={refElement} className="sd-color-picker__thumb" style={{ left: horizontal, top: vertical }}
    role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}
    aria-valuetext={valueText} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0} onKeyDown={onKeyDown}>
    <motion.span className="sd-color-picker__thumb-fill" style={{ backgroundColor: hex }}
      animate={{ scale: lift ? 0.78 : 1 }} transition={SPRING_PRESS} />
    <AnimatePresence>
      {lift ? <motion.span className="sd-color-picker__loupe" aria-hidden="true" style={{ backgroundColor: hex }}
        initial={{ opacity: 0, scale: 0.3, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: SPRING_PRESS }}
        exit={{ opacity: 0, scale: 0.3, y: 12, transition: { duration: 0.12, ease: EASE_OUT } }} /> : null}
    </AnimatePresence>
  </motion.div>;
}

type EyeDropperConstructor = new () => { open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }> };

function EyeDropperButton({ disabled, onSample }: Readonly<{ disabled: boolean; onSample(color: string): void }>) {
  const labels = useUiLabels().colorPicker;
  const sampler = useRef<AbortController>();
  const [sampling, setSampling] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => sampler.current?.abort(), []);
  const EyeDropper = (globalThis as typeof globalThis & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
  if (!EyeDropper) return null;

  async function sample(Dropper: EyeDropperConstructor) {
    if (sampler.current) return;
    const request = new AbortController();
    sampler.current = request;
    setSampling(true);
    setFailed(false);
    try {
      const { sRGBHex } = await new Dropper().open({ signal: request.signal });
      if (!request.signal.aborted) onSample(sRGBHex);
    } catch (error) {
      if (!request.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) {
        setFailed(true);
      }
    } finally {
      sampler.current = undefined;
      if (!request.signal.aborted) setSampling(false);
    }
  }

  return <>
    <IconButton label={labels.sample} size="small" disabled={disabled || sampling}
      className="sd-color-picker__eyedropper" onClick={() => { void sample(EyeDropper); }}>
      <Pipette size={15} />
    </IconButton>
    {failed ? <ToastNotice message={labels.sampleError} /> : null}
  </>;
}
