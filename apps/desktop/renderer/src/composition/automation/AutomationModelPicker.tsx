import type { AutomationModelPickerProps } from '@setsuna-desktop/feature-automation/renderer';
import { useModelProviderSnapshot } from '@setsuna-desktop/feature-model-provider/renderer';
import { Dropdown, type MenuItem } from '@setsuna-desktop/renderer-ui';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChatModelMenu } from '../../features/chat/composer/model-picker/chatModelMenu.js';
import { chatModelOptionKey, chatModelOptions } from '../../features/chat/composer/chatModelOptions.js';
import { BrandIconMark } from '../../shared/branding/BrandIconMark.js';
import { resolveModelBrand } from '../../shared/branding/providerBranding.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import './automation-model-picker.css';

export function AutomationModelPicker({ models, value, disabled, translate, onChange }: AutomationModelPickerProps) {
  const { state } = useModelProviderSnapshot();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => {
    const available = new Set(models.map((model) => chatModelOptionKey(model.providerId, model.modelId)));
    // The runtime owns availability; the existing provider projection supplies branding and details.
    return chatModelOptions(state).filter((option) => available.has(option.key));
  }, [models, state]);
  const selectedKey = value ? `model:${chatModelOptionKey(value.providerId, value.modelId)}` : 'default';
  const selected = options.find((option) => `model:${option.key}` === selectedKey);
  const defaultLabel = translate('feature.automation.defaultModel');
  const label = selected?.model.name || selected?.model.code || (value ? value.modelId : defaultLabel);
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  }, []);
  useEffect(() => {
    if (disabled || !state) changeOpen(false);
  }, [changeOpen, disabled, state]);
  const leadingItems: MenuItem[] = query.trim() ? [] : [{
    key: 'default', label: defaultLabel,
    onClick: () => { if (!disabled) onChange(undefined); },
  }, { key: 'default-divider', type: 'divider' }];
  const items = createChatModelMenu({
    options, query, onQueryChange: setQuery, searchRef, translate: t, leadingItems,
    emptyLabel: t(state ? 'chat.model.noMatch' : 'chat.model.notConfigured'),
    onSelect: (option) => {
      if (!disabled) onChange({ providerId: option.provider.id, modelId: option.model.id });
    },
  });
  return (
    <Dropdown modal rootClassName="chat-model-menu__models sd-menu-surface--neutral" placement="bottomRight"
      disabled={disabled || !state} open={open} onOpenChange={changeOpen} initialFocusRef={searchRef}
      menu={{ items, selectedKeys: [selectedKey] }}>
      <button type="button" className={`automation-model-picker sd-field sd-select-field${open ? ' is-open' : ''}`}
        aria-label={translate('feature.automation.model')} disabled={disabled || !state} title={label}>
        <span className="sd-select-field__value automation-model-picker__value">
          {selected ? <BrandIconMark brand={resolveModelBrand(selected.model, selected.provider)} fallbackName={label} size="compact" /> : null}
          <span>{label}</span>
        </span>
        <ChevronDown className="sd-select-field__chevron" size={15} aria-hidden="true" />
      </button>
    </Dropdown>
  );
}
