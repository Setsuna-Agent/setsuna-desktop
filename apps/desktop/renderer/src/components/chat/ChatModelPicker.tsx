import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Tooltip } from 'antd';
import { Brain, Check, Image as ImageIcon, Zap } from 'lucide-react';
import type { ProviderConfigState, ProviderModelConfig, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { useOutsideClose } from './chatComposerControlUtils.js';

type ModelOption = {
  key: string;
  model: ProviderModelConfig;
  provider: ProviderConfigState;
};

const modelPickerCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

export function ChatModelPicker({
  config,
  disabled,
  openSignal,
  onSelect,
}: {
  config: RuntimeConfigState | null;
  disabled?: boolean;
  openSignal?: number;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const options = useMemo(() => modelOptions(config), [config]);
  const activeProvider = config?.providers.find((provider) => provider.id === config.activeProviderId) ?? config?.providers[0] ?? null;
  const activeModel = activeProvider?.models.find((model) => model.enabled) ?? activeProvider?.models[0] ?? null;
  const activeKey = activeProvider && activeModel ? modelOptionKey(activeProvider.id, activeModel.id) : '';
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = useMemo(
    () => (normalizedQuery ? options.filter((option) => modelSearchText(option).includes(normalizedQuery)) : options),
    [normalizedQuery, options],
  );
  const modelSelectorTitle = activeModel ? '切换模型' : '选择模型';

  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const selectModel = useCallback(
    (option: ModelOption) => {
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
          <div className="chat-skill-command-menu__list chat-command-menu__list chat-model-command-menu__list">
            {visibleOptions.length ? (
              visibleOptions.map((option, index) => {
                const selected = option.key === activeKey;
                const focused = index === activeIndex;
                return (
                  <button
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
                    <span className="chat-command-menu__item-title chat-model-command-menu__item-title">{option.model.name}</span>
                    <span className="chat-model-command-menu__capabilities">
                      {option.model.thinkingEnabled ? <Brain size={12} /> : null}
                      {option.model.supportsImages ? <ImageIcon size={12} /> : null}
                    </span>
                    <span className="chat-command-menu__item-scope chat-model-command-menu__provider">{option.provider.name || '未命名厂商'}</span>
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
          <Zap className="chat-model-selector__mark" size={13} />
          <span className="chat-model-selector__name">{activeModel?.name ?? '未选择模型'}</span>
        </Button>
      </Tooltip>
    </span>
  );
}

function modelOptions(config: RuntimeConfigState | null): ModelOption[] {
  if (!config) return [];
  return config.providers
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: modelOptionKey(provider.id, model.id),
        provider,
        model,
      })),
    )
    .sort((left, right) => {
      const providerResult = modelPickerCollator.compare(modelProviderSortKey(left), modelProviderSortKey(right));
      if (providerResult) return providerResult;
      const modelResult = modelPickerCollator.compare(modelNameSortKey(left), modelNameSortKey(right));
      return modelResult || modelPickerCollator.compare(left.key, right.key);
    });
}

function modelOptionKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function modelSearchText(option: ModelOption): string {
  return `${option.model.name} ${option.model.code} ${option.provider.name} ${option.provider.id}`.toLowerCase();
}

function modelProviderSortKey(option: ModelOption): string {
  return (option.provider.name || option.provider.id || '未命名厂商').toLowerCase();
}

function modelNameSortKey(option: ModelOption): string {
  return (option.model.name || option.model.code || '').toLowerCase();
}
