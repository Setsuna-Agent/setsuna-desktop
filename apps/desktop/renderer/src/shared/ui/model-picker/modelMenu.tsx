import { TextField, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { Translate } from '../../i18n/I18nProvider.js';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { BrandIconMark } from '../../branding/BrandIconMark.js';
import { resolveModelBrand } from '../../branding/providerBranding.js';
import { ModelDetails } from './ModelDetails.js';
import { modelSearchText, groupModelOptions, type ModelOption } from './modelOptions.js';
import './model-picker.css';

/** Chat and task forms share search, provider groups, branding and keyboard selection. */
export function createModelMenu({ options, query, onQueryChange, onSelect, searchRef, translate: t, emptyLabel, leadingItems = [] }: {
  options: readonly ModelOption[];
  query: string;
  onQueryChange(query: string): void;
  onSelect(option: ModelOption, event: Event): void;
  searchRef: RefObject<HTMLInputElement>;
  translate: Translate;
  emptyLabel: ReactNode;
  leadingItems?: readonly MenuItem[];
}): MenuItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = normalizedQuery ? options.filter((option) => modelSearchText(option).includes(normalizedQuery)) : options;
  const groups: MenuItem[] = groupModelOptions(visibleOptions).map((group) => ({
    key: `provider:${group.provider.id}`, type: 'group',
    label: group.provider.name || t('chat.model.unnamedProvider'),
    className: 'model-picker-menu__provider',
    children: group.options.map((option) => ({
      key: `model:${option.key}`,
      label: <span className="model-picker-menu__model">
        <BrandIconMark brand={resolveModelBrand(option.model, option.provider)} fallbackName={option.model.name || option.model.code} size="compact" />
        <span className="model-picker-menu__model-name">{option.model.name || option.model.code}</span>
      </span>,
      tooltip: <ModelDetails option={option} />,
      tooltipClassName: 'model-details-tooltip',
      onClick: ({ domEvent }) => onSelect(option, domEvent),
    })),
  }));
  return [{
    key: 'model-search', type: 'group',
    label: <TextField ref={searchRef} className="model-picker-menu__search"
      aria-label={t('chat.model.search')} placeholder={t('chat.model.search')} value={query}
      onChange={(event) => onQueryChange(event.target.value)} onKeyDown={handleModelSearchKeyDown} />,
    children: [{
      key: 'model-list', type: 'group', className: 'model-picker-menu__list',
      children: [...leadingItems, ...(groups.length ? groups : [{ key: 'empty', disabled: true, label: emptyLabel }])],
    }],
  }];
}

function handleModelSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  // Keep text and IME input out of Radix's menu typeahead; hand navigation to its rows.
  if (event.key === 'Escape') return;
  event.stopPropagation();
  if (event.nativeEvent.isComposing) return;
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) return;
  event.preventDefault();
  const rows = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])');
  const last = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
  const row = last ? rows?.[rows.length - 1] : rows?.[0];
  if (event.key === 'Enter') row?.click();
  else row?.focus();
}
