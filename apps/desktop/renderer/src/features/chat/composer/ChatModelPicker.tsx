import { Button, Dropdown, TextField, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { ProviderConfigState, ProviderModelConfig, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { ChevronDown, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { BrandIconMark } from '../../../shared/branding/BrandIconMark.js';
import { resolveModelBrand } from '../../../shared/branding/providerBranding.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { AppTooltip } from '../../../shared/ui/primitives.js';
import { chatModelOptionKey, chatModelOptions, chatModelSearchText, groupChatModelOptions, type ChatModelOption } from './chatModelOptions.js';
import { createChatThinkingMenu, type ChatThinkingControl } from './chatThinkingMenu.js';
import { ChatModelDetails } from './ChatModelDetails.js';

export function ChatModelPicker({
  config,
  disabled,
  fallbackModelCode,
  model,
  openSignal,
  onSelect,
  provider,
  thinkingControl,
}: {
  config: RuntimeConfigState | null;
  disabled?: boolean;
  fallbackModelCode?: string;
  model: ProviderModelConfig | null;
  openSignal?: number;
  onSelect: (providerId: string, modelId: string) => void;
  provider: ProviderConfigState | null;
  thinkingControl: ChatThinkingControl;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const handledOpenSignalRef = useRef(0);
  const options = useMemo(() => chatModelOptions(config), [config]);
  const selectedKey = provider && model ? `model:${chatModelOptionKey(provider.id, model.id)}` : '';
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = useMemo(
    () => normalizedQuery ? options.filter((option) => chatModelSearchText(option).includes(normalizedQuery)) : options,
    [normalizedQuery, options],
  );
  const thinkingMenu = createChatThinkingMenu(thinkingControl, t);
  const modelSelectorTitle = t(model ? 'chat.model.switch' : 'chat.model.select');
  const modelBrand = provider && model ? resolveModelBrand(model, provider) : null;

  const changeOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery('');
  }, []);

  useEffect(() => {
    if (!openSignal || handledOpenSignalRef.current === openSignal) return;
    handledOpenSignalRef.current = openSignal;
    if (!disabled && config) setOpen(true);
  }, [config, disabled, openSignal]);

  useEffect(() => {
    if (disabled || !config) changeOpen(false);
  }, [changeOpen, config, disabled]);

  const modelGroups: MenuItem[] = groupChatModelOptions(visibleOptions).map((group) => ({
    key: `provider:${group.provider.id}`,
    type: 'group',
    label: group.provider.name || t('chat.model.unnamedProvider'),
    className: 'chat-model-menu__provider',
    children: group.options.map((option) => ({
      key: `model:${option.key}`,
      label: <ModelOptionLabel option={option} />,
      tooltip: <ChatModelDetails option={option} />,
      tooltipClassName: 'chat-model-details-tooltip',
      onClick: ({ domEvent }) => {
        // Keep the model and its thinking options together until the user finishes choosing.
        domEvent.preventDefault();
        if (disabled || !config) return;
        onSelect(option.provider.id, option.model.id);
        setQuery('');
      },
    })),
  }));
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Search input owns text/IME keys; Radix owns navigation after focus leaves the input.
    if (event.key === 'Escape') return;
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) {
      event.preventDefault();
      const rows = event.currentTarget.closest('[role="menu"]')
        ?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])');
      const last = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
      const row = last ? rows?.[rows.length - 1] : rows?.[0];
      if (event.key === 'Enter') row?.click();
      else row?.focus();
    }
  };

  const items: MenuItem[] = [];
  if (thinkingMenu) items.push(
    {
      key: 'thinking',
      type: 'group',
      label: t(thinkingControl.config.efforts.length ? 'chat.composer.thinkingEffort' : 'chat.composer.thinking'),
      children: thinkingMenu.items,
    },
    { key: 'thinking-divider', type: 'divider' },
  );
  items.push({
    key: 'models',
    label: t('chat.model.label'),
    extra: <span className="chat-model-menu__current-model">{model?.name ?? fallbackModelCode ?? t('chat.model.noneSelected')}</span>,
    submenuClassName: 'chat-model-menu__models',
    submenuInitialFocusRef: searchRef,
    children: [{
      key: 'model-search',
      type: 'group',
      label: <TextField
        ref={searchRef}
        className="chat-model-menu__search"
        aria-label={t('chat.model.search')}
        placeholder={t('chat.model.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleSearchKeyDown}
      />,
      children: [{
        key: 'model-list',
        type: 'group',
        className: 'chat-model-menu__list',
        children: modelGroups.length ? modelGroups : [{
          key: 'empty',
          disabled: true,
          label: config ? t('chat.model.noMatch') : t('chat.model.notConfigured'),
        }],
      }],
    }],
  });

  return (
    <span className="chat-model-picker">
      <Dropdown
        rootClassName="chat-model-menu"
        placement="topRight"
        disabled={disabled || !config}
        open={open}
        onOpenChange={changeOpen}
        menu={{ items, selectedKeys: [selectedKey, ...(thinkingMenu ? [thinkingMenu.selectedKey] : [])] }}
      >
        <AppTooltip title={modelSelectorTitle} placement="top" disabled={open}>
          <Button variant="ghost" size="small" className="chat-model-selector" disabled={disabled || !config}>
            {!provider || !model || modelBrand ? (
              <span className="chat-model-selector__mark">
                {provider && model ? (
                  <BrandIconMark brand={modelBrand} fallbackName={model.name || model.code} size="compact" />
                ) : <Zap className="chat-model-selector__placeholder-icon" size={13} />}
              </span>
            ) : null}
            <span className="chat-model-selector__name">{model?.name ?? fallbackModelCode ?? t('chat.model.noneSelected')}</span>
            {thinkingMenu && thinkingControl.enabled ? <span className="chat-model-selector__effort">{thinkingMenu.label}</span> : null}
            <ChevronDown size={12} aria-hidden="true" />
          </Button>
        </AppTooltip>
      </Dropdown>
    </span>
  );
}

function ModelOptionLabel({ option }: { option: ChatModelOption }) {
  return (
    <span className="chat-model-menu__model">
      <BrandIconMark brand={resolveModelBrand(option.model, option.provider)} fallbackName={option.model.name || option.model.code} size="compact" />
      <span className="chat-model-menu__model-name">{option.model.name || option.model.code}</span>
    </span>
  );
}
