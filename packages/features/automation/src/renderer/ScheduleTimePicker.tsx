import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, Popover, TextField, WheelPicker, type WheelPickerOption } from '@setsuna-desktop/renderer-ui';
import { daysInScheduleMonth, parseScheduleTimeInput, scheduleTimeParts, updateScheduleTime, type ScheduleTimeField } from './schedule-time-input.js';
import './schedule-time-picker.css';

type ScheduleTimePickerProps = {
  disabled?: boolean;
  value: string;
  onChange(value: string): void;
  translate: RendererTranslate;
};

const MONTHS = numberOptions(1, 12);
const HOURS = numberOptions(0, 23);
const MINUTES = numberOptions(0, 59);

export function ScheduleTimePicker({ disabled, value, onChange, translate: t }: ScheduleTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => value.replace('T', ' '));
  const lastCommitted = useRef(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      setDraft(value.replace('T', ' '));
    }
  }, [value]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const parts = scheduleTimeParts(value);
  const date = parts.date;
  const displayValue = value.replace('T', ' ').replaceAll('-', '/');
  const TimeIcon = date ? CalendarDays : Clock3;
  const validDraft = parseScheduleTimeInput(draft, Boolean(date));
  useEffect(() => {
    input.current?.setCustomValidity(validDraft ? '' : t(date ? 'feature.automation.time.invalidDateTime' : 'feature.automation.time.invalid'));
  }, [date, t, validDraft]);
  const select = (field: ScheduleTimeField, next: string) => {
    const updated = updateScheduleTime(value, field, Number(next));
    setDraft(updated.replace('T', ' '));
    lastCommitted.current = updated;
    onChange(updated);
  };
  const column = (field: ScheduleTimeField, selected: number, options: WheelPickerOption[]) => (
    <div className="automation-time-picker__column" key={field}>
      <span>{t(`feature.automation.time.${field}`)}</span>
      <WheelPicker aria-label={t(`feature.automation.time.${field}`)} options={options} value={String(selected)}
        onValueChange={(next) => select(field, next)} />
    </div>
  );

  return (
    <div className="automation-time-picker">
      <TextField ref={input} disabled={disabled} required aria-label={t('feature.automation.time')}
        value={draft} spellCheck={false} autoComplete="off"
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = parseScheduleTimeInput(next, Boolean(date));
          if (parsed) { lastCommitted.current = parsed; onChange(parsed); }
        }}
        onBlur={() => { if (validDraft) setDraft(validDraft.replace('T', ' ')); }} />
      <Popover open={open && !disabled} onOpenChange={setOpen} placement="bottomRight"
        className={`automation-time-picker__popover${date ? ' automation-time-picker__popover--date' : ''}`}
        content={(
          <div className="automation-time-picker__panel">
            <div className="automation-time-picker__group">
              {date ? <>
                {column('year', date.year, yearOptions(date.year))}
                {column('month', date.month, MONTHS)}
                {column('day', date.day, numberOptions(1, daysInScheduleMonth(date.year, date.month)))}
              </> : null}
              {column('hour', parts.hour, HOURS)}
              <span className="automation-time-picker__separator" aria-hidden="true">:</span>
              {column('minute', parts.minute, MINUTES)}
            </div>
            <footer><Button type="button" size="small" onClick={() => setOpen(false)}>{t('feature.automation.time.done')}</Button></footer>
          </div>
        )}>
        <IconButton disabled={disabled} type="button" label={`${t('feature.automation.time')}: ${displayValue}`} aria-expanded={open && !disabled}>
          <TimeIcon size={15} aria-hidden="true" />
        </IconButton>
      </Popover>
    </div>
  );
}

function yearOptions(selected: number): WheelPickerOption[] {
  const current = new Date().getFullYear();
  return numberOptions(Math.max(1, Math.min(selected, current) - 1), Math.min(9999, Math.max(selected, current) + 10));
}

function numberOptions(start: number, end: number): WheelPickerOption[] {
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const value = String(start + index);
    return { value, label: value.padStart(2, '0') };
  });
}
