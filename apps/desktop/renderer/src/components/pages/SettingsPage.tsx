import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Brain, Cpu, Database, HardDrive, Image as ImageIcon, KeyRound, Moon, Plus, RefreshCw, Save, SlidersHorizontal, Sun, Trash2, Type } from 'lucide-react';
import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeAvailableModel,
  RuntimeAvailableModelsResponse,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeFetchModelsInput,
  RuntimeMemoryRecord,
  RuntimeUsageResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { Button, EmptyState, IconButton, SelectField, StatusBadge, TextArea, TextField } from '../primitives.js';
import { formatTokens } from '../workspace/model.js';
import {
  fontFamilyOptions,
  fontSizeOptions,
  useAppearancePreferences,
  type FontFamilyMode,
} from '../../hooks/useAppearancePreferences.js';
import { useThemeTransition, type ThemeMode } from '../../hooks/useThemeTransition.js';

type SettingsSectionId = 'general' | 'localLlm' | 'runtime' | 'memory';

const settingsSections: Array<{ id: SettingsSectionId; label: string; icon: ReactNode }> = [
  { id: 'general', label: '通用', icon: <SlidersHorizontal size={14} /> },
  { id: 'localLlm', label: '本地模型', icon: <HardDrive size={14} /> },
  { id: 'runtime', label: '运行时', icon: <Cpu size={14} /> },
  { id: 'memory', label: '记忆', icon: <Database size={14} /> },
];

const settingsSectionLabels: Record<SettingsSectionId, string> = {
  general: '通用',
  localLlm: '本地模型',
  runtime: '运行时',
  memory: '记忆',
};

export function SettingsPage({
  config,
  usage,
  memories,
  memoryDraft,
  activeProject,
  onBack,
  onFetchProviderModels,
  onSaveProviders,
  onSaveRuntimePreferences,
  onMemoryDraftChange,
  onSaveMemory,
  onDeleteMemory,
}: {
  config: RuntimeConfigState | null;
  usage: RuntimeUsageResponse | null;
  memories: RuntimeMemoryRecord[];
  memoryDraft: string;
  activeProject?: WorkspaceProject;
  onBack: () => void;
  onFetchProviderModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSaveProviders: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
  onSaveRuntimePreferences: (input: Pick<RuntimeConfigInput, 'memoryEnabled' | 'approvalPolicy' | 'permissionProfile'>) => Promise<void>;
  onMemoryDraftChange: (value: string) => void;
  onSaveMemory: () => void;
  onDeleteMemory: (memory: RuntimeMemoryRecord) => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const activeProvider = config?.providers.find((provider) => provider.id === config.activeProviderId) ?? config?.providers[0];
  const activeProviderName = activeProvider ? `${activeProvider.name || activeProvider.id} · ${config?.providers.length ?? 0} 厂商` : 'local-test';
  const content =
    activeSection === 'general' ? (
      <GeneralSettings />
    ) : activeSection === 'localLlm' ? (
      config ? (
        <LocalModelSettings config={config} usage={usage} onFetchModels={onFetchProviderModels} onSave={onSaveProviders} />
      ) : (
        <EmptyState title="Config unavailable" />
      )
    ) : activeSection === 'runtime' ? (
      config ? <RuntimePolicySettings config={config} onSave={onSaveRuntimePreferences} /> : <EmptyState title="Config unavailable" />
    ) : (
      <MemoryPanel
        memories={memories}
        draft={memoryDraft}
        activeProject={activeProject}
        onDraftChange={onMemoryDraftChange}
        onSave={onSaveMemory}
        onDelete={onDeleteMemory}
      />
    );

  return (
    <main className="desktop-settings-panel">
      <div className="chat-user-settings chat-user-settings--page">
        <nav className="chat-user-settings__nav">
          <button className="chat-user-settings__page-back" type="button" onClick={onBack}>
            <ArrowLeft size={14} />
            <span>返回应用</span>
          </button>
          <div className="chat-user-settings__title">设置</div>
          <div className="chat-user-settings__tabs">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                className={activeSection === section.id ? 'is-active' : ''}
                type="button"
                onClick={() => setActiveSection(section.id)}
              >
                {section.icon}
                <span>{section.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <section className="chat-user-settings__content">
          <header className="chat-user-settings__page-heading">
            <h1>{settingsSectionLabels[activeSection]}</h1>
            <span>{activeSection === 'localLlm' ? activeProviderName : config?.dataPath ?? 'Local runtime'}</span>
          </header>
          {content}
        </section>
      </div>
    </main>
  );
}

function GeneralSettings() {
  const { fontFamily, fontSize, setFontFamily, setFontSize } = useAppearancePreferences();
  const { mode, setThemeModeWithTransition } = useThemeTransition();
  const selectedFont = fontFamilyOptions.find((item) => item.value === fontFamily) ?? fontFamilyOptions[0];
  const fontSizeIndex = Math.max(0, fontSizeOptions.indexOf(fontSize));

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__section--general">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">字体</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Type size={14} />
              <span>界面字体</span>
            </span>
            <SelectField
              className="settings-local-control"
              value={fontFamily}
              style={{ fontFamily: selectedFont.css }}
              onChange={(event) => setFontFamily(event.currentTarget.value as FontFamilyMode)}
            >
              {fontFamilyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <div className="chat-user-settings__font-preview" style={{ fontFamily: selectedFont.css }}>
            <div className="chat-user-settings__font-preview-panel">
              <span className="chat-user-settings__font-preview-label">Plain Text</span>
              <div className="chat-user-settings__font-preview-plain">
                <strong>Setsuna Desktop</strong>
                <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz</p>
                <p>普通文本预览：中文、英文、数字 1234567890 与路径显示。</p>
              </div>
            </div>
            <div className="chat-user-settings__font-preview-panel">
              <span className="chat-user-settings__font-preview-label">Code</span>
              <div className="chat-user-settings__font-preview-code">
                <code>pnpm typecheck && pnpm test</code>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">外观</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <SlidersHorizontal size={14} />
              <span>页面缩放</span>
            </span>
            <div className="chat-user-settings__slider">
              <input
                aria-label="页面缩放"
                type="range"
                min={0}
                max={fontSizeOptions.length - 1}
                step={1}
                value={fontSizeIndex}
                onChange={(event) => setFontSize(fontSizeOptions[Number(event.currentTarget.value)] ?? '100')}
              />
              <div className="settings-scale-control__marks" aria-hidden="true">
                {fontSizeOptions.map((option) => (
                  <span key={option}>{option === '100' ? '100%' : ''}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Sun size={14} />
              <span>主题色彩</span>
            </span>
            <div className="chat-user-settings__theme-options" role="radiogroup" aria-label="主题色彩">
              {[
                { value: 'light' as ThemeMode, label: '浅色', icon: <Sun size={14} /> },
                { value: 'dark' as ThemeMode, label: '深色', icon: <Moon size={14} /> },
              ].map((option) => {
                const selected = mode === option.value;
                return (
                  <button
                    key={option.value}
                    className={`chat-user-settings__theme-option ${selected ? 'is-active' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={(event) => setThemeModeWithTransition(option.value, event)}
                  >
                    <span className="chat-user-settings__theme-option-icon">{option.icon}</span>
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuntimePolicySettings({
  config,
  onSave,
}: {
  config: RuntimeConfigState;
  onSave: (input: Pick<RuntimeConfigInput, 'memoryEnabled' | 'approvalPolicy' | 'permissionProfile'>) => Promise<void>;
}) {
  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__runtime-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">策略</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <KeyRound size={14} />
              <span>启用记忆</span>
            </span>
            <label className="sd-check">
              <input
                type="checkbox"
                checked={config.memoryEnabled}
                onChange={(event) => void onSave({ memoryEnabled: event.currentTarget.checked })}
              />
              <span>开启</span>
            </label>
          </div>
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <SlidersHorizontal size={14} />
              <span>审批策略</span>
            </span>
            <SelectField
              className="settings-local-control"
              value={config.approvalPolicy}
              onChange={(event) => void onSave({ approvalPolicy: event.currentTarget.value as RuntimeConfigState['approvalPolicy'] })}
            >
              <option value="suggest">建议确认</option>
              <option value="on-request">按需确认</option>
              <option value="strict">严格确认</option>
            </SelectField>
          </label>
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <SlidersHorizontal size={14} />
              <span>权限范围</span>
            </span>
            <SelectField
              className="settings-local-control"
              value={config.permissionProfile}
              onChange={(event) => void onSave({ permissionProfile: event.currentTarget.value as RuntimeConfigState['permissionProfile'] })}
            >
              <option value="read-only">只读</option>
              <option value="workspace-write">工作区写入</option>
              <option value="danger-full-access">完全访问</option>
            </SelectField>
          </label>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">本地存储</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Cpu size={14} />
              <span>配置文件</span>
            </span>
            <code>{config.configPath}</code>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Database size={14} />
              <span>数据目录</span>
            </span>
            <code>{config.dataPath}</code>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryPanel({
  memories,
  draft,
  activeProject,
  onDraftChange,
  onSave,
  onDelete,
}: {
  memories: RuntimeMemoryRecord[];
  draft: string;
  activeProject?: WorkspaceProject;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onDelete: (memory: RuntimeMemoryRecord) => void;
}) {
  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__memory-section">
      <div className="chat-user-settings__memory-heading">
        <div className="chat-user-settings__group-title">{activeProject ? `${activeProject.name} 记忆` : '全局记忆'}</div>
        <p>记忆只保存在本机，可按当前项目或全局范围被本地 runtime 召回。</p>
      </div>
      <div className="chat-user-settings__group chat-user-settings__memory-card">
        <div className="memory-compose">
          <TextArea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={activeProject ? `记住到 ${activeProject.name}...` : '记住到全局...'}
          />
          <Button variant="primary" disabled={!draft.trim()} onClick={onSave}>
            保存
          </Button>
        </div>
        <div className="memory-list">
          {memories.length ? (
            memories.map((memory) => (
              <div className="memory-row" key={memory.id}>
                <div className="memory-row__content">
                  <span>{memory.scope === 'project' ? '项目' : '全局'}</span>
                  <p>{memory.content}</p>
                </div>
                <IconButton label="Delete memory" variant="danger" onClick={() => onDelete(memory)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))
          ) : (
            <EmptyState title="暂无本地记忆" body="保存的记忆只保留在这台设备上，可被本地运行时召回。" />
          )}
        </div>
      </div>
    </div>
  );
}

function UsageSummary({ usage }: { usage: RuntimeUsageResponse | null }) {
  const summary = usage?.summary;
  return (
    <div className="usage-strip">
      <div>
        <span>总计</span>
        <strong>{formatTokens(summary?.totalTokens ?? 0)}</strong>
      </div>
      <div>
        <span>输入</span>
        <strong>{formatTokens(summary?.inputTokens ?? 0)}</strong>
      </div>
      <div>
        <span>输出</span>
        <strong>{formatTokens(summary?.outputTokens ?? 0)}</strong>
      </div>
      <div>
        <span>次数</span>
        <strong>{summary?.recordCount ?? 0}</strong>
      </div>
    </div>
  );
}

function LocalModelSettings({
  config,
  onFetchModels,
  usage,
  onSave,
}: {
  config: RuntimeConfigState;
  onFetchModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  usage: RuntimeUsageResponse | null;
  onSave: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
}) {
  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__local-llm-section">
      <div className="settings-callout">
        <StatusBadge tone="success">本地</StatusBadge>
        <span>模型调用由本地 runtime 直连已配置的供应商，renderer 不请求远端 Agent API。</span>
      </div>
      <UsageSummary usage={usage} />
      <ProviderSettings config={config} onFetchModels={onFetchModels} onSave={onSave} />
    </div>
  );
}

function ProviderSettings({
  config,
  onFetchModels,
  onSave,
}: {
  config: RuntimeConfigState;
  onFetchModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSave: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
}) {
  const [providers, setProviders] = useState<ProviderConfigState[]>(() => normalizeSettingsProviders(config.providers));
  const [apiKeysByProviderId, setApiKeysByProviderId] = useState<Record<string, string>>({});
  const [fetchStateByProviderId, setFetchStateByProviderId] = useState<Record<string, ModelFetchState>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProviders(normalizeSettingsProviders(config.providers));
    setApiKeysByProviderId({});
    setFetchStateByProviderId({});
  }, [config.activeProviderId, config.providers]);

  const updateProvider = (providerId: string, updater: (provider: ProviderConfigState) => ProviderConfigState) => {
    setProviders((current) => current.map((provider) => (provider.id === providerId ? updater(provider) : provider)));
  };

  const updateModel = (providerId: string, modelId: string, updater: (model: ProviderModelConfig) => ProviderModelConfig) => {
    updateProvider(providerId, (provider) => ({
      ...provider,
      models: provider.models.map((model) => (model.id === modelId ? updater(model) : model)),
    }));
  };

  const setProviderApiKey = (providerId: string, value: string) => {
    setApiKeysByProviderId((current) => ({ ...current, [providerId]: value }));
  };

  const addProvider = () => {
    setProviders((current) => [...current, defaultProviderConfig()]);
  };

  const removeProvider = (providerId: string) => {
    setProviders((current) => {
      const next = current.filter((provider) => provider.id !== providerId);
      return next.length ? next : [defaultProviderConfig()];
    });
    setApiKeysByProviderId((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
  };

  const addModel = (providerId: string) => {
    updateProvider(providerId, (provider) => ensureProviderActiveModel({
      ...provider,
      models: [...provider.models, defaultProviderModel('', provider.models.length === 0)],
    }));
  };

  const removeModel = (providerId: string, modelId: string) => {
    updateProvider(providerId, (provider) => ensureProviderActiveModel({
      ...provider,
      models: provider.models.filter((model) => model.id !== modelId),
    }));
  };

  const selectDefaultModel = (providerId: string, modelId: string) => {
    updateProvider(providerId, (provider) => ({
      ...provider,
      models: provider.models.map((model) => ({ ...model, enabled: model.id === modelId })),
    }));
  };

  const fetchModels = (provider: ProviderConfigState) => {
    setFetchStateByProviderId((current) => ({
      ...current,
      [provider.id]: { ...(current[provider.id] ?? emptyModelFetchState()), error: '', fetching: true },
    }));
    void onFetchModels({
      providerId: provider.id,
      provider: LOCAL_PROVIDER_KIND,
      baseUrl: provider.baseUrl,
      apiKey: apiKeysByProviderId[provider.id] || undefined,
    })
      .then((result) => {
        updateProvider(provider.id, (currentProvider) => ({
          ...currentProvider,
          models: mergeFetchedModels(currentProvider.models, result.models),
        }));
        setFetchStateByProviderId((current) => ({
          ...current,
          [provider.id]: { models: result.models, error: '', fetching: false },
        }));
      })
      .catch((error) => {
        setFetchStateByProviderId((current) => ({
          ...current,
          [provider.id]: {
            ...(current[provider.id] ?? emptyModelFetchState()),
            error: error instanceof Error ? error.message : String(error),
            fetching: false,
          },
        }));
      });
  };

  const save = () => {
    setSaving(true);
    void onSave(providers.map(prepareProviderForSave), apiKeysByProviderId).finally(() => setSaving(false));
  };

  const enabledProviderCount = providers.filter((provider) => provider.enabled).length;

  return (
    <div className="chat-user-settings__local-provider-stack">
      <div className="chat-user-settings__local-provider-toolbar">
        <span>{`${providers.length} 厂商 · ${enabledProviderCount} 启用`}</span>
        <Button icon={<Plus size={14} />} onClick={addProvider}>添加厂商</Button>
      </div>
      <div className="chat-user-settings__local-provider-list">
        {providers.map((provider, providerIndex) => {
          const fetchState = fetchStateByProviderId[provider.id] ?? emptyModelFetchState();
          return (
            <div className="chat-user-settings__local-provider-card" key={provider.id}>
              <div className="chat-user-settings__local-provider-head">
                <div className="chat-user-settings__local-provider-title">
                  <HardDrive size={14} />
                  <span>{provider.name || `厂商 ${providerIndex + 1}`}</span>
                </div>
                <div className="chat-user-settings__local-provider-actions">
                  <label className="sd-check">
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={(event) => updateProvider(provider.id, (item) => ({ ...item, enabled: event.currentTarget.checked }))}
                    />
                    <span>启用</span>
                  </label>
                  <span className="chat-user-settings__provider-meta">{provider.models.length} models</span>
                  {providers.length > 1 ? (
                    <IconButton label="删除厂商" variant="danger" onClick={() => removeProvider(provider.id)}>
                      <Trash2 size={14} />
                    </IconButton>
                  ) : null}
                </div>
              </div>
              <div className="chat-user-settings__group chat-user-settings__local-provider-form">
                <div className="chat-user-settings__row">
                  <span className="chat-user-settings__row-label">协议</span>
                  <code className="settings-local-protocol">OpenAI-compatible · AI SDK</code>
                </div>
                <label className="chat-user-settings__row">
                  <span className="chat-user-settings__row-label">供应商名称</span>
                  <TextField className="settings-local-control" value={provider.name} onChange={(event) => updateProvider(provider.id, (item) => ({ ...item, name: event.target.value }))} />
                </label>
                <label className="chat-user-settings__row">
                  <span className="chat-user-settings__row-label">服务地址</span>
                  <TextField
                    className="settings-local-control"
                    value={provider.baseUrl}
                    placeholder="http://127.0.0.1:11434/v1"
                    onChange={(event) => {
                      setFetchStateByProviderId((current) => ({ ...current, [provider.id]: emptyModelFetchState() }));
                      updateProvider(provider.id, (item) => ({ ...item, baseUrl: event.target.value }));
                    }}
                  />
                </label>
                <label className="chat-user-settings__row">
                  <span className="chat-user-settings__row-label">API Key {provider.apiKeySet ? <em>{provider.apiKeyPreview}</em> : null}</span>
                  <TextField
                    className="settings-local-control"
                    type="password"
                    value={apiKeysByProviderId[provider.id] ?? ''}
                    onChange={(event) => setProviderApiKey(provider.id, event.target.value)}
                    placeholder={provider.apiKeySet ? '留空则保留当前密钥' : '本地服务可留空'}
                  />
                </label>
              </div>
              <div className="settings-model-list">
                <div className="settings-model-list__head">
                  <span>模型</span>
                  <div className="settings-model-list__actions">
                    <Button icon={<RefreshCw size={14} />} disabled={fetchState.fetching} onClick={() => fetchModels(provider)}>
                      {fetchState.fetching ? '获取中' : '自动获取'}
                    </Button>
                    <Button icon={<Plus size={14} />} onClick={() => addModel(provider.id)}>添加模型</Button>
                  </div>
                </div>
                <div className="settings-model-grid settings-model-grid--head">
                  <span>默认</span>
                  <span>显示名称</span>
                  <span>模型 ID</span>
                  <span>输出</span>
                  <span>能力</span>
                  <span>思考等级</span>
                  <span />
                </div>
                {provider.models.map((model) => (
                  <div className="settings-model-grid settings-model-row" key={model.id}>
                    <label className="settings-model-default">
                      <input
                        type="radio"
                        name={`default-model-${provider.id}`}
                        checked={model.enabled}
                        onChange={() => selectDefaultModel(provider.id, model.id)}
                      />
                    </label>
                    <TextField
                      className="settings-local-control"
                      value={model.name}
                      placeholder="显示名称"
                      onChange={(event) => updateModel(provider.id, model.id, (item) => ({ ...item, name: event.target.value }))}
                    />
                    <TextField
                      className="settings-local-control"
                      value={model.code}
                      placeholder="llama3.1"
                      onChange={(event) => updateModel(provider.id, model.id, (item) => updateModelCode(item, event.target.value))}
                    />
                    <TextField
                      className="settings-local-control"
                      type="number"
                      min={1}
                      value={model.maxOutputTokens}
                      onChange={(event) => updateModel(provider.id, model.id, (item) => ({
                        ...item,
                        maxOutputTokens: positiveInt(Number(event.target.value), DEFAULT_MODEL_MAX_OUTPUT_TOKENS),
                      }))}
                    />
                    <div className="settings-model-capabilities">
                      <label className="sd-check settings-model-check">
                        <input
                          type="checkbox"
                          checked={model.thinkingEnabled}
                          onChange={(event) => updateModel(provider.id, model.id, (item) => setThinkingEnabled(item, event.currentTarget.checked))}
                        />
                        <Brain size={13} />
                        <span>思考</span>
                      </label>
                      <label className="sd-check settings-model-check">
                        <input
                          type="checkbox"
                          checked={Boolean(model.supportsImages)}
                          onChange={(event) => updateModel(provider.id, model.id, (item) => ({ ...item, supportsImages: event.currentTarget.checked }))}
                        />
                        <ImageIcon size={13} />
                        <span>图片</span>
                      </label>
                    </div>
                    <div className="settings-thinking-levels">
                      <div className="settings-thinking-levels__chips">
                        {REASONING_EFFORTS.map((effort) => (
                          <label className="settings-thinking-chip" key={effort}>
                            <input
                              type="checkbox"
                              checked={model.thinkingEfforts.includes(effort)}
                              disabled={!model.thinkingEnabled}
                              onChange={() => updateModel(provider.id, model.id, (item) => toggleThinkingEffort(item, effort))}
                            />
                            <span>{effort}</span>
                          </label>
                        ))}
                      </div>
                      {model.thinkingEnabled && model.thinkingEfforts.length ? (
                        <SelectField
                          aria-label="默认思考等级"
                          className="settings-thinking-default"
                          value={normalizedDefaultThinkingEffort(model) ?? model.thinkingEfforts[0]}
                          onChange={(event) => updateModel(provider.id, model.id, (item) => ({ ...item, defaultThinkingEffort: event.currentTarget.value }))}
                        >
                          {model.thinkingEfforts.map((effort) => (
                            <option key={effort} value={effort}>{effort}</option>
                          ))}
                        </SelectField>
                      ) : null}
                    </div>
                    <IconButton label="删除模型" variant="danger" disabled={provider.models.length <= 1} onClick={() => removeModel(provider.id, model.id)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                ))}
                {fetchState.error ? <div className="settings-model-fetch-state settings-model-fetch-state--error">{fetchState.error}</div> : null}
                {!fetchState.error && fetchState.models.length ? <div className="settings-model-fetch-state">{`已获取 ${fetchState.models.length} 个模型，保存后生效。`}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="settings-form__footer">
        <span>
          <KeyRound size={14} />
          密钥不会出现在渲染进程响应中。
        </span>
        <Button variant="primary" icon={<Save size={15} />} disabled={saving} onClick={save}>
          保存
        </Button>
      </div>
    </div>
  );
}

const LOCAL_PROVIDER_KIND: ProviderConfigState['provider'] = 'openai-compatible';
const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 68000;
const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

type ReasoningEffort = typeof REASONING_EFFORTS[number];
type ModelFetchState = {
  models: RuntimeAvailableModel[];
  error: string;
  fetching: boolean;
};

function emptyModelFetchState(): ModelFetchState {
  return { models: [], error: '', fetching: false };
}

function normalizeSettingsProviders(providers: ProviderConfigState[]): ProviderConfigState[] {
  const normalized = (providers.length ? providers : [defaultProviderConfig()]).map((provider) => ({
    ...provider,
    provider: LOCAL_PROVIDER_KIND,
    name: provider.name || 'Local provider',
    models: normalizeProviderModels(provider.models),
  }));
  return normalized.length ? normalized : [defaultProviderConfig()];
}

function normalizeProviderModels(models: ProviderModelConfig[]): ProviderModelConfig[] {
  const normalized = (models.length ? models : [defaultProviderModel('')]).map((model, index) => normalizeProviderModel(model, index === 0));
  const activeModelId = normalized.find((model) => model.enabled)?.id ?? normalized[0]?.id;
  return normalized.map((model) => ({ ...model, enabled: model.id === activeModelId }));
}

function normalizeProviderModel(model: ProviderModelConfig, fallbackEnabled = false): ProviderModelConfig {
  const code = model.code?.trim() ?? '';
  const thinkingEfforts = normalizeThinkingEfforts(model.thinkingEfforts);
  return {
    ...model,
    id: model.id || modelIdFromCode(code),
    name: model.name || code || 'New model',
    code,
    enabled: model.enabled ?? fallbackEnabled,
    maxOutputTokens: positiveInt(model.maxOutputTokens, DEFAULT_MODEL_MAX_OUTPUT_TOKENS),
    thinkingEnabled: Boolean(model.thinkingEnabled),
    thinkingEfforts,
    defaultThinkingEffort: normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }),
    supportsImages: Boolean(model.supportsImages),
  };
}

function defaultProviderConfig(): ProviderConfigState {
  return {
    id: uniqueLocalId('provider'),
    name: 'Local provider',
    provider: LOCAL_PROVIDER_KIND,
    baseUrl: 'http://127.0.0.1:11434/v1',
    enabled: true,
    apiKeySet: false,
    apiKeyPreview: '',
    models: [defaultProviderModel('', true)],
  };
}

function defaultProviderModel(code: string, enabled = true): ProviderModelConfig {
  return {
    id: modelIdFromCode(code),
    name: code || 'New model',
    code,
    enabled,
    maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
    thinkingEnabled: false,
    thinkingEfforts: [],
    supportsImages: false,
  };
}

function prepareProviderForSave(provider: ProviderConfigState): ProviderConfigState {
  return {
    ...provider,
    provider: LOCAL_PROVIDER_KIND,
    models: normalizeProviderModels(provider.models).map((model) => ({
      ...model,
      defaultThinkingEffort: normalizedDefaultThinkingEffort(model),
    })),
  };
}

function ensureProviderActiveModel(provider: ProviderConfigState): ProviderConfigState {
  return { ...provider, models: normalizeProviderModels(provider.models) };
}

function mergeFetchedModels(previousModels: ProviderModelConfig[], fetchedModels: RuntimeAvailableModel[]): ProviderModelConfig[] {
  const previousByCode = new Map(previousModels.map((model) => [model.code, model]));
  const previousByName = new Map(previousModels.map((model) => [model.name, model]));
  const previousActiveCode = previousModels.find((model) => model.enabled)?.code;
  const activeCode = fetchedModels.some((model) => model.id === previousActiveCode) ? previousActiveCode : fetchedModels[0]?.id;
  const merged = fetchedModels.map((model) => {
    const previous = previousByCode.get(model.id) ?? previousByName.get(model.name);
    const code = model.id.trim();
    return normalizeProviderModel({
      ...defaultProviderModel(code, code === activeCode),
      id: previous?.id || modelIdFromCode(code),
      name: model.name?.trim() || code,
      maxOutputTokens: model.maxOutputTokens ?? previous?.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
      thinkingEnabled: model.thinkingEnabled ?? previous?.thinkingEnabled ?? false,
      thinkingEfforts: model.thinkingEfforts ?? previous?.thinkingEfforts ?? [],
      defaultThinkingEffort: model.defaultThinkingEffort ?? previous?.defaultThinkingEffort,
      supportsImages: model.supportsImages ?? previous?.supportsImages ?? false,
    }, code === activeCode);
  });
  return normalizeProviderModels(merged);
}

function updateModelCode(model: ProviderModelConfig, code: string): ProviderModelConfig {
  const trimmed = code.trim();
  return {
    ...model,
    code,
    name: model.name && model.name !== model.code ? model.name : trimmed,
  };
}

function setThinkingEnabled(model: ProviderModelConfig, thinkingEnabled: boolean): ProviderModelConfig {
  const thinkingEfforts = thinkingEnabled && !model.thinkingEfforts.length ? ['medium'] : model.thinkingEfforts;
  return {
    ...model,
    thinkingEnabled,
    thinkingEfforts,
    defaultThinkingEffort: thinkingEnabled ? normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }) : undefined,
  };
}

function toggleThinkingEffort(model: ProviderModelConfig, effort: ReasoningEffort): ProviderModelConfig {
  const next = new Set(normalizeThinkingEfforts(model.thinkingEfforts));
  if (next.has(effort)) {
    next.delete(effort);
  } else {
    next.add(effort);
  }
  const thinkingEfforts = REASONING_EFFORTS.filter((item) => next.has(item));
  return {
    ...model,
    thinkingEfforts,
    thinkingEnabled: model.thinkingEnabled && thinkingEfforts.length > 0,
    defaultThinkingEffort: normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }),
  };
}

function normalizedDefaultThinkingEffort(model: ProviderModelConfig): ReasoningEffort | undefined {
  if (!model.thinkingEnabled) return undefined;
  return normalizeDefaultThinkingEffort(model);
}

function normalizeDefaultThinkingEffort(model: Pick<ProviderModelConfig, 'defaultThinkingEffort' | 'thinkingEfforts'>): ReasoningEffort | undefined {
  const efforts = normalizeThinkingEfforts(model.thinkingEfforts);
  const defaultEffort = model.defaultThinkingEffort;
  if (isReasoningEffort(defaultEffort) && efforts.includes(defaultEffort)) return defaultEffort;
  return efforts[0];
}

function normalizeThinkingEfforts(value: string[] | undefined): ReasoningEffort[] {
  const seen = new Set(value?.filter(isReasoningEffort) ?? []);
  return REASONING_EFFORTS.filter((effort) => seen.has(effort));
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high';
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function modelIdFromCode(code: string): string {
  return code.trim() || uniqueLocalId('model');
}

function uniqueLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}
