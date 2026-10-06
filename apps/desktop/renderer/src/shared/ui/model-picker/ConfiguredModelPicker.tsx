import type { SettingsModelPickerProps } from '@setsuna-desktop/renderer-contracts/settings';
import { Dropdown, type MenuItem } from '@setsuna-desktop/renderer-ui';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandIconMark } from '../../branding/BrandIconMark.js';
import { resolveModelBrand } from '../../branding/providerBranding.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { createModelMenu } from './modelMenu.js';
import { modelOptionKey, type ModelOption } from './modelOptions.js';

export function ConfiguredModelPicker({
  'aria-label': accessibleLabel,
  className = '',
  defaultLabel,
  disabled,
  onChange,
  options,
  unavailableLabel,
  value,
}: Omit<SettingsModelPickerProps, 'models'> & { options: readonly ModelOption[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedKey = value ? `model:${modelOptionKey(value.providerId, value.modelId)}` : 'default';
  const selected = options.find((option) => `model:${option.key}` === selectedKey);
  const label = selected ? selected.model.name || selected.model.code : value ? unavailableLabel : defaultLabel;
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  }, []);

  useEffect(() => {
    if (disabled) changeOpen(false);
  }, [changeOpen, disabled]);

  const leadingItems: MenuItem[] = query.trim() ? [] : [
    { key: 'default', label: defaultLabel, onClick: () => { if (!disabled) onChange(null); } },
    ...(value && !selected ? [{ key: selectedKey, label: unavailableLabel, disabled: true }] : []),
    { key: 'default-divider', type: 'divider' },
  ];
  const items = createModelMenu({
    options, query, onQueryChange: setQuery, searchRef, translate: t, leadingItems,
    emptyLabel: t(options.length ? 'chat.model.noMatch' : 'chat.model.notConfigured'),
    onSelect: (option) => {
      if (!disabled) onChange({ providerId: option.provider.id, modelId: option.model.id });
    },
  });

  return (
    <Dropdown modal rootClassName="model-picker-menu sd-menu-surface--neutral" placement="bottomRight"
      disabled={disabled} open={open} onOpenChange={changeOpen} initialFocusRef={searchRef}
      menu={{ items, selectedKeys: [selectedKey] }}>
      <button type="button" className={`configured-model-picker sd-field sd-select-field${open ? ' is-open' : ''} ${className}`.trim()}
        aria-label={accessibleLabel} disabled={disabled} title={label}>
        <span className="sd-select-field__value configured-model-picker__value">
          {selected ? <BrandIconMark brand={resolveModelBrand(selected.model, selected.provider)} fallbackName={label} size="compact" /> : null}
          <span>{label}</span>
        </span>
        <ChevronDown className="sd-select-field__chevron" size={15} aria-hidden="true" />
      </button>
    </Dropdown>
  );
}
