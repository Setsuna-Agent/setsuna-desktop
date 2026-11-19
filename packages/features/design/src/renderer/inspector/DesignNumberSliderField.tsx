import { Slider } from '@setsuna-desktop/renderer-ui';
import { useEffect, useId, useRef, useState, type ComponentProps, type PointerEvent as ReactPointerEvent } from 'react';
import { NumberField } from './DesignInspectorFields.js';

type SliderDrag = {
  saveDraft?(): void;
  canceled?: boolean;
  release(): void;
  clearPreview(): void;
};

export function DesignNumberSliderField({ sliderMax, sliderStep = 1, onSave, onPreview, ...field }:
  ComponentProps<typeof NumberField> & Readonly<{ sliderMax: number; sliderStep?: number }>,
) {
  const owner = useId();
  const drag = useRef<SliderDrag>();
  const [draft, setDraft] = useState<{ control: 'number' | 'slider'; value: number }>();
  const { label, min = 0, value, previewValue, readOnly } = field;
  const disabled = readOnly || previewValue !== undefined || sliderMax <= min;

  useEffect(() => () => {
    const active = drag.current;
    drag.current = undefined;
    active?.release();
    if (active?.saveDraft) active.clearPreview();
  }, []);

  function showDraft(control: 'number' | 'slider', next: number | undefined) {
    if (next === undefined) setDraft((current) => current?.control === control ? undefined : current);
    else setDraft({ control, value: next });
  }

  function finish(commit: boolean) {
    const active = drag.current;
    if (!active) return;
    drag.current = undefined;
    active.release();
    if (!active.saveDraft) return;
    if (commit) active.saveDraft();
    active.clearPreview();
    showDraft('slider', undefined);
  }

  function start(event: ReactPointerEvent<HTMLInputElement>) {
    if (disabled || event.button !== 0 || drag.current) return;
    const { currentTarget: input, pointerId } = event;
    const view = input.ownerDocument.defaultView;
    const cancel = () => { finish(false); };
    function end(event: PointerEvent) {
      if (event.pointerId === pointerId) finish(event.type === 'pointerup' && !input.disabled);
    }
    // Let the native range track the pointer. Observe release even when it is outside the field.
    view?.addEventListener('pointerup', end, true);
    view?.addEventListener('pointercancel', end, true);
    view?.addEventListener('blur', cancel);
    drag.current = {
      release() {
        view?.removeEventListener('pointerup', end, true);
        view?.removeEventListener('pointercancel', end, true);
        view?.removeEventListener('blur', cancel);
      },
      clearPreview: () => onPreview?.(undefined, owner),
    };
    input.focus({ preventScroll: true });
  }

  return <div className="design-inspector__number-slider">
    <NumberField {...field} previewValue={previewValue ?? (draft?.control === 'slider' ? draft.value : undefined)} onSave={onSave}
      onPreview={(next, source) => { showDraft('number', next); onPreview?.(next, source); }} />
    <Slider aria-label={label} min={min} max={sliderMax} step={sliderStep} value={previewValue ?? draft?.value ?? value ?? min}
      disabled={disabled} onPointerDown={start} onBlur={() => finish(false)} onKeyDown={(event) => {
        const active = drag.current;
        if (!active || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        // Ignore any native range updates until the canceled pointer is released.
        active.canceled = true;
        active.saveDraft = undefined;
        active.clearPreview();
        showDraft('slider', undefined);
      }} onChange={(event) => {
        const next = event.currentTarget.valueAsNumber;
        if (disabled || !Number.isFinite(next)) return;
        const active = drag.current;
        if (!active) {
          if (next !== value) void onSave(next);
        } else if (!active.canceled) {
          active.saveDraft = () => { if (next !== value) void onSave(next); };
          showDraft('slider', next);
          onPreview?.(next, owner);
        }
      }} />
  </div>;
}
