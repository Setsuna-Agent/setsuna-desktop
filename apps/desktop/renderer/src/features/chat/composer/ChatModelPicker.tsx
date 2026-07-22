import type { ProviderConfigState, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { Button, Input, Progress, Tooltip } from 'antd';
import { Check, Image as ImageIcon, Sparkles, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandIconMark } from '../../../shared/branding/BrandIconMark.js';
import { resolveModelBrand } from '../../../shared/branding/providerBranding.js';
import { formatTokenCount, type ChatContextTokenUsage } from '../conversation/chatContextUsage.js';
import { useOutsideClose } from './chatComposerControlUtils.js';
import {
  chatModelOptionKey,
  chatModelOptions,
  chatModelSearchText,
  type ChatModelOption,
} from './chatModelOptions.js';
import { useActiveOptionScroll } from './useActiveOptionScroll.js';

export function ChatModelPicker({
  config,
  contextCompacting = false,
  contextUsage,
  disabled,
  openSignal,
  onSelect,
}: {
  config: RuntimeConfigState | null;
  contextCompacting?: boolean;
  contextUsage?: ChatContextTokenUsage;
  disabled?: boolean;
  openSignal?: number;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const options = useMemo(() => chatModelOptions(config), [config]);
  const activeProvider = activeProviderFromConfig(config);
  const activeModel = activeProvider?.models.find((model) => model.enabled) ?? activeProvider?.models[0] ?? null;
  const activeKey = activeProvider && activeModel ? chatModelOptionKey(activeProvider.id, activeModel.id) : '';
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = useMemo(
    () => (normalizedQuery ? options.filter((option) => chatModelSearchText(option).includes(normalizedQuery)) : options),
    [normalizedQuery, options],
  );
  const modelUsage = modelContextUsage(contextUsage);
  const modelSelectorTitle = activeModel ? modelUsage.tooltipLabel ? `切换模型 · ${modelUsage.tooltipLabel}` : '切换模型' : '选择模型';
  const focusedOptionKey = visibleOptions[activeIndex]?.key;
  const { activeOptionRef, scrollContainerRef } = useActiveOptionScroll<HTMLDivElement, HTMLButtonElement>(focusedOptionKey, open);

  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const selectModel = useCallback(
    (option: ChatModelOption) => {
      onSelect(option.provider.id, option.model.id);
      closePicker();
    },
    [closePicker, onSelect],
  );

  useOutsideClose(rootRef, open, closePicker);

  useEffect(() => {
    if (!openSignal || disabled || !config) return;
    setOpen(true);
  }, [config, disabled, openSignal]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = visibleOptions.findIndex((option) => option.key === activeKey);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [activeKey, open, visibleOptions]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePicker();
        return;
      }
      if (!visibleOptions.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % visibleOptions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + visibleOptions.length) % visibleOptions.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        selectModel(visibleOptions[Math.min(activeIndex, visibleOptions.length - 1)]);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, closePicker, open, selectModel, visibleOptions]);

  return (
    <span ref={rootRef} className="chat-model-picker">
      {open ? (
        <div className="chat-command-menu chat-skill-command-menu chat-model-command-menu" role="listbox" aria-label="模型选择">
          <div className="chat-skill-command-menu__header chat-model-command-menu__header">
            <Input
              allowClear
              autoFocus
              className="chat-model-command-menu__search"
              placeholder="搜索"
              size="small"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div ref={scrollContainerRef} className="chat-skill-command-menu__list chat-command-menu__list chat-model-command-menu__list">
            {visibleOptions.length ? (
              visibleOptions.map((option, index) => {
                const selected = option.key === activeKey;
                const focused = index === activeIndex;
                return (
                  <button
                    ref={focused ? activeOptionRef : undefined}
                    key={option.key}
                    className={`chat-command-menu__item chat-model-command-menu__item ${focused ? 'is-active' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectModel(option);
                    }}
                    onMouseMove={() => setActiveIndex(index)}
                  >
                    <span className="chat-model-command-menu__brand">
                      <BrandIconMark
                        brand={resolveModelBrand(option.model, option.provider)}
                        fallbackName={option.model.name || option.model.code}
                        size="compact"
                      />
                    </span>
                    <span className="chat-command-menu__item-title chat-model-command-menu__item-title">{option.model.name}</span>
                    <span className="chat-model-command-menu__capabilities">
                      {option.model.thinkingEnabled ? <Sparkles size={12} /> : null}
                      {option.model.supportsImages ? <ImageIcon size={12} /> : null}
                      {option.model.contextWindowTokens ? <span className="chat-model-command-menu__ctx">{formatTokenCount(option.model.contextWindowTokens)}</span> : null}
                    </span>
                    <span className="chat-command-menu__item-scope chat-model-command-menu__provider">
                      {option.provider.name || '未命名厂商'}
                    </span>
                    <span className="chat-model-command-menu__check">{selected ? <Check size={13} /> : null}</span>
                  </button>
                );
              })
            ) : (
              <div className="chat-command-menu__state">{config ? '没有匹配模型' : '模型未配置'}</div>
            )}
          </div>
        </div>
      ) : null}
      <Tooltip
        title={modelSelectorTitle}
        placement="top"
        mouseEnterDelay={0.2}
        open={open ? false : undefined}
      >
        <Button
          type="text"
          size="small"
          className="chat-model-selector"
          disabled={disabled || !config}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="chat-model-selector__mark">
            {activeProvider && activeModel ? (
              <BrandIconMark
                brand={resolveModelBrand(activeModel, activeProvider)}
                fallbackName={activeModel.name || activeModel.code}
                size="compact"
              />
            ) : (
              <Zap className="chat-model-selector__placeholder-icon" fill="currentColor" size={13} strokeWidth={0} />
            )}
          </span>
          <span className="chat-model-selector__name">{activeModel?.name ?? '未选择模型'}</span>
          {modelUsage.visible ? (
            <Progress
              aria-label={`当前上下文用量 ${modelUsage.percentLabel}`}
              className="chat-token-progress chat-model-selector__progress"
              percent={modelUsage.percentValue}
              showInfo={false}
              size={14}
              status={contextCompacting ? 'active' : 'normal'}
              strokeWidth={18}
              type="circle"
            />
          ) : null}
        </Button>
      </Tooltip>
    </span>
  );
}

function activeProviderFromConfig(config: RuntimeConfigState | null): ProviderConfigState | null {
  if (!config) return null;
  return config.providers.find((provider) => provider.id === config.activeProviderId && provider.enabled)
    ?? config.providers.find((provider) => provider.enabled)
    ?? config.providers[0]
    ?? null;
}

function modelContextUsage(usage?: ChatContextTokenUsage): {
  percentLabel: string;
  percentValue: number;
  tooltipLabel: string;
  visible: boolean;
} {
  const usedTokens = Math.round(Number(usage?.usedTokens || 0));
  if (usedTokens <= 0) {
    return { percentLabel: '', percentValue: 0, tooltipLabel: '', visible: false };
  }

  const totalTokens = Math.round(Number(usage?.totalTokens || 0));
  const rawPercent = Number(usage?.visiblePercent || usage?.percent || 0);
  const percentValue = Math.min(100, Math.max(0, rawPercent > 0 && rawPercent < 0.1 ? 0.1 : rawPercent));
  const percentLabel = percentValue > 0 ? `${percentValue.toFixed(percentValue > 0 && percentValue < 1 ? 1 : 0)}%` : '已用';
  const tokenLabel = totalTokens > 0
    ? `${formatTokenCount(usedTokens)}/${formatTokenCount(totalTokens)}`
    : `${formatTokenCount(usedTokens)} tokens`;
  return {
    percentLabel,
    percentValue,
    tooltipLabel: `${percentLabel} · ${tokenLabel}`,
    visible: true,
  };
}
