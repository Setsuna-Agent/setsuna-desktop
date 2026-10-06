import { Button, Dropdown, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { ProviderConfigState, ProviderModelConfig, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { ChevronDown, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandIconMark } from '../../../shared/branding/BrandIconMark.js';
import { resolveModelBrand } from '../../../shared/branding/providerBranding.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { AppTooltip } from '../../../shared/ui/primitives.js';
import { modelOptionKey, modelOptions } from '../../../shared/ui/model-picker/modelOptions.js';
import { createChatThinkingMenu, type ChatThinkingControl } from './chatThinkingMenu.js';
import { createModelMenu } from '../../../shared/ui/model-picker/modelMenu.js';

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
  const options = useMemo(() => modelOptions(config), [config]);
  const selectedKey = provider && model ? `model:${modelOptionKey(provider.id, model.id)}` : '';
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
    submenuClassName: 'model-picker-menu sd-menu-surface--neutral',
    submenuInitialFocusRef: searchRef,
    children: createModelMenu({
      options, query, onQueryChange: setQuery, searchRef, translate: t,
      emptyLabel: t(config ? 'chat.model.noMatch' : 'chat.model.notConfigured'),
      onSelect: (option, event) => {
        // Keep the model and its thinking options together until the user finishes choosing.
        event.preventDefault();
        if (disabled || !config) return;
        onSelect(option.provider.id, option.model.id);
        setQuery('');
      },
    }),
  });

  return (
    <span className="chat-model-picker">
      <Dropdown
        rootClassName="chat-model-menu sd-menu-surface--neutral"
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
