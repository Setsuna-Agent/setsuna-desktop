import { ToastNotice } from '@setsuna-desktop/renderer-ui';
import type { RuntimeUsageBucket, UsageProviderDescriptor } from '../../contracts/index.js';
import { usageRangeLabel } from './usage-format.js';
import { isUsageTimePreset, USAGE_TIME_PRESETS, type UsageFilters } from './usageFilters.js';
import { useUsageView } from './view-context.js';

type UsageFilterBarProps = {
  error: string | null;
  filters: UsageFilters;
  /** 选项来自未筛选的全量分桶，避免选中某项后其他选项从列表中消失。 */
  modelBuckets: readonly RuntimeUsageBucket[];
  providerBuckets: readonly RuntimeUsageBucket[];
  providers: readonly UsageProviderDescriptor[];
  onChange: (filters: UsageFilters) => void;
};

/**
 * 厂商/模型名通常较长，弹出菜单不跟随紧凑的触发器宽度；筛选位于页面右侧，
 * 加宽后的菜单与触发器右缘对齐、向下展开。
 */
const NAME_MENU = { menuAlign: 'end', menuMinWidth: 260 } as const;

export function UsageFilterBar({
  error,
  filters,
  modelBuckets,
  providerBuckets,
  providers,
  onChange,
}: UsageFilterBarProps) {
  const { host: { BrandIcon }, translate: t, ui: { SelectField } } = useUsageView();
  const modelProvider = new Map(modelBuckets.map((bucket) => [bucket.key, bucket]));
  const brandIcon = (kind: 'model' | 'provider') => (value: string) => {
    if (!value) return null;
    const bucket = kind === 'model' ? modelProvider.get(value) : undefined;
    return (
      <BrandIcon
        kind={kind}
        name={value}
        providers={providers}
        providerId={bucket?.dominantProviderId}
        providerName={bucket?.dominantProvider}
      />
    );
  };

  return (
    <div className="settings-usage-filters">
      <div className="settings-usage-filters__fields" role="group" aria-label={t('feature.usage.filters')}>
        <SelectField
          aria-label={t('feature.usage.timeRange')}
          className="settings-usage-filters__field"
          value={filters.range}
          onValueChange={(range) => {
            if (isUsageTimePreset(range)) onChange({ ...filters, range });
          }}
        >
          {USAGE_TIME_PRESETS.map((range) => (
            <option key={range} value={range}>{usageRangeLabel(range, t)}</option>
          ))}
        </SelectField>
        <SelectField
          aria-label={t('feature.usage.provider')}
          className="settings-usage-filters__field"
          {...NAME_MENU}
          renderOptionIcon={brandIcon('provider')}
          value={filters.provider}
          onValueChange={(provider) => onChange({ ...filters, provider })}
        >
          <option value="">{t('feature.usage.allProviders')}</option>
          {optionKeys(providerBuckets, filters.provider).map((key) => <option key={key} value={key}>{key}</option>)}
        </SelectField>
        <SelectField
          aria-label={t('feature.usage.model')}
          className="settings-usage-filters__field"
          {...NAME_MENU}
          renderOptionIcon={brandIcon('model')}
          value={filters.model}
          onValueChange={(model) => onChange({ ...filters, model })}
        >
          <option value="">{t('feature.usage.allModels')}</option>
          {optionKeys(modelBuckets, filters.model).map((key) => <option key={key} value={key}>{key}</option>)}
        </SelectField>
      </div>
      {error ? <ToastNotice message={error} /> : null}
    </div>
  );
}

/** 按用量排序的选项键；当前选中项即使已不在最新数据中也保留，防止下拉框静默回退到“全部”。 */
function optionKeys(buckets: readonly RuntimeUsageBucket[], selected: string): string[] {
  const keys = buckets.map((bucket) => bucket.key);
  return selected && !keys.includes(selected) ? [...keys, selected] : keys;
}
