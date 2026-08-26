import { Popover } from 'antd';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import {
  defaultUsageCustomTimeRange,
  usageQueryForCustomRange,
  type UsageCustomTimeRange,
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
            <button
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
            </button>
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
            destroyOnHidden
            open={customOpen}
            placement="bottomRight"
            classNames={{ root: 'settings-usage-time-filter-popover' }}
            styles={{ container: { padding: 0 }, content: { padding: 0 } }}
            trigger="click"
            onOpenChange={(open) => setCustomOpen(open)}
          >
            <button
              className={customOpen || activeRange === 'custom' ? 'is-active' : ''}
              type="button"
              aria-expanded={customOpen}
              aria-pressed={activeRange === 'custom'}
            >
              {t('feature.usage.custom')}
            </button>
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
  onChange: (range: UsageCustomTimeRange) => void;
}) {
  const { translate: t } = useUsageView();
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
          invalid={!valid}
          label={t('feature.usage.from')}
          value={range.from}
          onChange={(from) => onChange({ ...range, from })}
        />
        <UsageCustomRangeField
          invalid={!valid}
          label={t('feature.usage.to')}
          value={range.to}
          onChange={(to) => onChange({ ...range, to })}
        />
      </div>
      <footer className="settings-usage-custom-range__footer">
        <div className="settings-usage-custom-range__actions">
          <button type="button" onClick={onCancel}>{t('feature.usage.cancel')}</button>
          <button
            className="is-primary"
            disabled={!valid || loading}
            type="button"
            onClick={onApply}
          >
            {t('feature.usage.applyRange')}
          </button>
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
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-usage-custom-range__field">
      <span>{label}</span>
      <input
        aria-invalid={invalid}
        autoComplete="off"
        maxLength={16}
        placeholder="YYYY/MM/DD HH:mm"
        spellCheck={false}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
      />
    </label>
  );
}

function presetLabel(preset: UsageTimePreset, t: RendererTranslate): string {
  if (preset === 'all') return t('feature.usage.allTime');
  if (preset === 'today') return t('feature.usage.today');
  if (preset === '24h') return '24h';
  if (preset === '7d') return '7d';
  return '30d';
}
