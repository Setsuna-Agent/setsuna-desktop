import { useState } from 'react';
import { CalendarDays, ChevronDown, Clock3 } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Popover, WheelPicker, type WheelPickerOption } from '@setsuna-desktop/renderer-ui';
import { daysInScheduleMonth, scheduleTimeParts, updateScheduleTime, type ScheduleTimeField } from './schedule-time-input.js';
import './schedule-time-picker.css';

type ScheduleTimePickerProps = {
  value: string;
  onChange(value: string): void;
  translate: RendererTranslate;
};

const MONTHS = numberOptions(1, 12);
const HOURS = numberOptions(0, 23);
const MINUTES = numberOptions(0, 59);

export function ScheduleTimePicker({ value, onChange, translate: t }: ScheduleTimePickerProps) {
  const [open, setOpen] = useState(false);
  const parts = scheduleTimeParts(value);
  const date = parts.date;
  const displayValue = value.replace('T', ' ').replaceAll('-', '/');
  const TimeIcon = date ? CalendarDays : Clock3;
  const select = (field: ScheduleTimeField, next: string) => onChange(updateScheduleTime(value, field, Number(next)));
  const column = (field: ScheduleTimeField, selected: number, options: WheelPickerOption[]) => (
    <div className="automation-time-picker__column" key={field}>
      <span>{t(`feature.automation.time.${field}`)}</span>
      <WheelPicker aria-label={t(`feature.automation.time.${field}`)} options={options} value={String(selected)}
        onValueChange={(next) => select(field, next)} />
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottomRight"
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
      <Button type="button" className="automation-time-picker" aria-label={`${t('feature.automation.time')}: ${displayValue}`} aria-expanded={open}>
        <TimeIcon size={15} aria-hidden="true" />
        <span>{displayValue}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </Button>
    </Popover>
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
