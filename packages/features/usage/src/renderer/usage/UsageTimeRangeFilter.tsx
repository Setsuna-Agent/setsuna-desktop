import { Button, Popover, WheelPicker, type WheelPickerOption } from '@setsuna-desktop/renderer-ui';

import { CalendarDays, TriangleAlert } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import {
  defaultUsageCustomTimeRange,
  inspectUsageCustomRange,
  parseUsageCustomTimeValue,
  updateUsageCustomTimeValue,
  usageQueryForCustomRange,
  type UsageCustomTimeRange,
  type UsageCustomTimeParts,
  type UsageTimePreset,
  type UsageTimeRangeId,
} from './usageTimeRange.js';
import { useUsageView } from './view-context.js';

type UsageTimeRangeFilterProps = {
  activeRange: UsageTimeRangeId;
  error: string | null;
  loading: boolean;
  onApplyCustom: (range: UsageCustomTimeRange) => void;
  onSelectPreset: (preset: UsageTimePreset) => void;
};

const PRESETS: UsageTimePreset[] = ['all', 'today', '24h', '7d', '30d'];

export function UsageTimeRangeFilter({
  activeRange,
  error,
  loading,
  onApplyCustom,
  onSelectPreset,
}: UsageTimeRangeFilterProps) {
  const { translate: t } = useUsageView();
  const [customOpen, setCustomOpen] = useState(false);
  const [customRange, setCustomRange] = useState<UsageCustomTimeRange>(() => (
    defaultUsageCustomTimeRange()
  ));
  const customRangeValid = Boolean(usageQueryForCustomRange(customRange));

  const applyCustomRange = () => {
    if (!customRangeValid) return;
    onApplyCustom(customRange);
    setCustomOpen(false);
  };

  return (
    <section className="settings-usage-time-filter" aria-label={t('feature.usage.timeRange')}>
      <div className="settings-usage-time-filter__main">
        <div className="settings-usage-time-filter__presets" role="group" aria-label={t('feature.usage.quickRanges')}>
          {PRESETS.map((preset) => (
            <Button variant="ghost"
              className={activeRange === preset && !customOpen ? 'is-active' : ''}
              key={preset}
              type="button"
              aria-pressed={activeRange === preset && !customOpen}
              onClick={() => {
                setCustomOpen(false);
                onSelectPreset(preset);
              }}
            >
              {presetLabel(preset, t)}
            </Button>
          ))}
          <Popover
            content={(
              <UsageCustomRangeEditor
                loading={loading}
                range={customRange}
                valid={customRangeValid}
                onApply={applyCustomRange}
                onCancel={() => setCustomOpen(false)}
                onChange={setCustomRange}
              />
            )}
            open={customOpen}
            placement="bottomRight"
            className="settings-usage-time-filter-popover"
            style={{ padding: 0 }}
            trigger="click"
            onOpenChange={(open) => setCustomOpen(open)}
          >
            <Button variant="ghost"
              className={customOpen || activeRange === 'custom' ? 'is-active' : ''}
              type="button"
              aria-expanded={customOpen}
              aria-pressed={activeRange === 'custom'}
            >
              {t('feature.usage.custom')}
            </Button>
          </Popover>
        </div>
      </div>
      {error ? <p className="settings-usage-time-filter__error" role="alert">{error}</p> : null}
    </section>
  );
}

function UsageCustomRangeEditor({
  loading,
  range,
  valid,
  onApply,
  onCancel,
  onChange,
}: {
  loading: boolean;
  range: UsageCustomTimeRange;
  valid: boolean;
  onApply: () => void;
  onCancel: () => void;
  onChange: Dispatch<SetStateAction<UsageCustomTimeRange>>;
}) {
  const { translate: t } = useUsageView();
  // 校验失败时按原因精确定位提示：解析失败标对应字段，“结束早于开始”标两个字段。
  const issue = inspectUsageCustomRange(range);
  const issueMessage = issue === 'end-before-start'
    ? t('feature.usage.rangeEndBeforeStart')
    : issue
      ? t('feature.usage.rangeUnparsable')
      : null;
  return (
    <div className="settings-usage-custom-range">
      <header className="settings-usage-custom-range__header">
        <span className="settings-usage-custom-range__header-icon" aria-hidden="true">
          <CalendarDays size={17} strokeWidth={1.8} />
        </span>
        <div>
          <strong>{t('feature.usage.customTitle')}</strong>
        </div>
      </header>
      <div className="settings-usage-custom-range__fields">
        <UsageCustomRangeField
          invalid={issue === 'invalid-from' || issue === 'end-before-start'}
          label={t('feature.usage.from')}
          value={range.from}
          onChange={(patch) => onChange((current) => ({
            ...current,
            from: updateUsageCustomTimeValue(current.from, patch),
          }))}
        />
        <UsageCustomRangeField
          invalid={issue === 'invalid-to' || issue === 'end-before-start'}
          label={t('feature.usage.to')}
          value={range.to}
          onChange={(patch) => onChange((current) => ({
            ...current,
            to: updateUsageCustomTimeValue(current.to, patch),
          }))}
        />
      </div>
      <footer className="settings-usage-custom-range__footer">
        {issueMessage ? (
          <p className="settings-usage-custom-range__hint" role="alert">
            <TriangleAlert aria-hidden="true" size={13} strokeWidth={2.2} />
            <span>{issueMessage}</span>
          </p>
        ) : null}
        <div className="settings-usage-custom-range__actions">
          <Button variant="ghost" type="button" onClick={onCancel}>{t('feature.usage.cancel')}</Button>
          <Button variant="primary"
            className="is-primary"
            disabled={!valid || loading}
            type="button"
            onClick={onApply}
          >
            {t('feature.usage.applyRange')}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function UsageCustomRangeField({
  invalid,
  label,
  value,
  onChange,
}: {
  invalid: boolean;
  label: string;
  value: string;
  onChange: (patch: Partial<UsageCustomTimeParts>) => void;
}) {
  const { translate: t } = useUsageView();
  const parts = parseUsageCustomTimeValue(value);

  return (
    <div className={['settings-usage-custom-range__field', invalid ? 'is-invalid' : ''].filter(Boolean).join(' ')}>
      <span>{label}</span>
      {parts ? (
        <div className="settings-usage-custom-range__wheels">
          <div className="settings-usage-custom-range__group">
            <WheelPicker
              aria-label={`${label} ${t('feature.usage.year')}`}
              options={yearOptions(parts.year)}
              value={String(parts.year)}
              onValueChange={(year) => onChange({ year: Number(year) })}
            />
            <WheelPicker
              aria-label={`${label} ${t('feature.usage.month')}`}
              options={rangeOptions(1, 12)}
              value={String(parts.month)}
              onValueChange={(month) => onChange({ month: Number(month) })}
            />
            <WheelPicker
              aria-label={`${label} ${t('feature.usage.day')}`}
              options={rangeOptions(1, daysInMonth(parts.year, parts.month))}
              value={String(parts.day)}
              onValueChange={(day) => onChange({ day: Number(day) })}
            />
          </div>
          <div className="settings-usage-custom-range__group">
            <WheelPicker
              aria-label={`${label} ${t('feature.usage.hour')}`}
              options={rangeOptions(0, 23)}
              value={String(parts.hour)}
              onValueChange={(hour) => onChange({ hour: Number(hour) })}
            />
            <WheelPicker
              aria-label={`${label} ${t('feature.usage.minute')}`}
              options={rangeOptions(0, 59)}
              value={String(parts.minute)}
              onValueChange={(minute) => onChange({ minute: Number(minute) })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 保留当前年附近的范围，避免出现无意义的超长年份列表。 */
function yearOptions(year: number): WheelPickerOption[] {
  const start = Math.min(year, new Date().getFullYear()) - 5;
  return rangeOptions(start, Math.max(year, new Date().getFullYear()) + 1);
}

function rangeOptions(start: number, end: number): WheelPickerOption[] {
  const options: WheelPickerOption[] = [];
  for (let value = start; value <= end; value += 1) options.push(String(value));
  return options;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function presetLabel(preset: UsageTimePreset, t: RendererTranslate): string {
  if (preset === 'all') return t('feature.usage.allTime');
  if (preset === 'today') return t('feature.usage.today');
  if (preset === '24h') return '24h';
  if (preset === '7d') return '7d';
  return '30d';
}
