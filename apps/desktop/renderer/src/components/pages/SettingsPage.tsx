import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Popconfirm } from 'antd';
import { Brain, ChevronRight, Cpu, Database, Eye, FileText, FolderOpen, HardDrive, Image as ImageIcon, Info, KeyRound, Monitor, Moon, Pencil, Plus, RefreshCw, Save, SlidersHorizontal, Sun, Trash2, Type } from 'lucide-react';
import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeAvailableModel,
  RuntimeAvailableModelsResponse,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeFetchModelsInput,
  RuntimeMemoryPreview,
  RuntimeMemoryPreviewItem,
  RuntimeUsageResponse,
} from '@setsuna-desktop/contracts';
import { Button, EmptyState, IconButton, PageBackButton, PageHeader, SelectField, StatusBadge, TextArea, TextField } from '../primitives.js';
import { formatTokens } from '../workspace/model.js';
import {
  fontFamilyOptions,
  fontSizeOptions,
  getFontFamilyOptionsForPlatform,
  useAppearancePreferences,
  type FontFamilyMode,
} from '../../hooks/useAppearancePreferences.js';
import type { DesktopUpdaterBridgeState, DesktopUpdaterStateView } from '../../hooks/useDesktopUpdater.js';
import { useThemeTransition, type ThemeMode } from '../../hooks/useThemeTransition.js';

type SettingsSectionId = 'general' | 'personalization' | 'localLlm' | 'runtime' | 'about';
type RuntimePreferenceInput = Pick<RuntimeConfigInput, 'globalPrompt' | 'storagePath' | 'memoryEnabled' | 'setsunaStyle' | 'approvalPolicy' | 'permissionProfile'>;

const settingsSections: Array<{ id: SettingsSectionId; label: string; icon: ReactNode }> = [
  { id: 'general', label: '通用', icon: <SlidersHorizontal size={14} /> },
  { id: 'personalization', label: '个性化', icon: <Pencil size={14} /> },
  { id: 'localLlm', label: '本地模型', icon: <HardDrive size={14} /> },
  { id: 'runtime', label: '运行时', icon: <Cpu size={14} /> },
  { id: 'about', label: '关于', icon: <Info size={14} /> },
];

const settingsSectionLabels: Record<SettingsSectionId, string> = {
  general: '通用',
  personalization: '个性化',
  localLlm: '本地模型',
  runtime: '运行时',
  about: '关于',
};

const PERSONALIZATION_PROMPT_MAX_LENGTH = 8000;
const PERSONALIZATION_PROMPT_SAVE_DELAY_MS = 360;

type SettingsChoiceOption<TValue extends string> = {
  value: TValue;
  label: string;
  icon: ReactNode;
};

const themeModeOptions: Array<SettingsChoiceOption<ThemeMode>> = [
  { value: 'light', label: '浅色', icon: <Sun size={14} /> },
  { value: 'dark', label: '深色', icon: <Moon size={14} /> },
  { value: 'system', label: '系统', icon: <Monitor size={14} /> },
];

const setsunaStyleOptions: Array<SettingsChoiceOption<RuntimeConfigState['setsunaStyle']>> = [
  { value: 'developer', label: '开发', icon: <Cpu size={14} /> },
  { value: 'daily', label: '日常', icon: <Sun size={14} /> },
];

export function SettingsPage({
  config,
  updater,
  usage,
  memoryPreview,
  memoryPreviewLoading,
  onBack,
  onFetchProviderModels,
  onSaveProviders,
  onSaveRuntimePreferences,
  onPreviewMemories,
  onDeleteMemory,
  onResetMemories,
}: {
  config: RuntimeConfigState | null;
  updater: DesktopUpdaterStateView;
  usage: RuntimeUsageResponse | null;
  memoryPreview: RuntimeMemoryPreview | null;
  memoryPreviewLoading: boolean;
  onBack: () => void;
  onFetchProviderModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSaveProviders: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
  onSaveRuntimePreferences: (input: RuntimePreferenceInput) => Promise<void>;
  onPreviewMemories: () => Promise<RuntimeMemoryPreview>;
  onDeleteMemory: (memoryId: string) => Promise<void>;
  onResetMemories: () => Promise<void>;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const activeProvider = config?.providers.find((provider) => provider.id === config.activeProviderId) ?? config?.providers[0];
  const activeProviderName = activeProvider ? `${activeProvider.name || activeProvider.id} · ${config?.providers.length ?? 0} 厂商` : 'local-test';
  const headingSubtitle = getSettingsHeadingSubtitle(activeSection, activeProviderName, updater.currentVersion, config?.dataPath);
  const content =
    activeSection === 'general' ? (
      <GeneralSettings />
    ) : activeSection === 'localLlm' ? (
      config ? (
        <LocalModelSettings config={config} usage={usage} onFetchModels={onFetchProviderModels} onSave={onSaveProviders} />
      ) : (
        <EmptyState title="Config unavailable" />
      )
    ) : activeSection === 'personalization' ? (
      config ? (
        <PersonalizationSettings
          config={config}
          memoryPreview={memoryPreview}
          memoryPreviewLoading={memoryPreviewLoading}
          onSavePreferences={onSaveRuntimePreferences}
          onPreview={onPreviewMemories}
          onDelete={onDeleteMemory}
          onReset={onResetMemories}
        />
      ) : (
        <EmptyState title="Config unavailable" />
      )
    ) : activeSection === 'about' ? (
      <AboutSettings updater={updater} />
    ) : (
      config ? <RuntimePolicySettings config={config} onSave={onSaveRuntimePreferences} /> : <EmptyState title="Config unavailable" />
    );

  return (
    <main className="desktop-settings-panel">
      <div className="chat-user-settings chat-user-settings--page">
        <nav className="chat-user-settings__nav">
          <PageBackButton block className="chat-user-settings__page-back" label="返回应用" onClick={onBack} />
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
          <header className={`chat-user-settings__page-heading ${activeSection === 'localLlm' ? 'chat-user-settings__page-heading--wide' : ''}`}>
            <h1>{settingsSectionLabels[activeSection]}</h1>
            {headingSubtitle ? <span>{headingSubtitle}</span> : null}
          </header>
          {content}
        </section>
      </div>
    </main>
  );
}

function getSettingsHeadingSubtitle(section: SettingsSectionId, activeProviderName: string, currentVersion: string, dataPath?: string): string | null {
  if (section === 'general') return null;
  if (section === 'localLlm') return activeProviderName;
  if (section === 'about') return `v${currentVersion}`;
  return dataPath ?? 'Local runtime';
}

function SettingsChoiceGroup<TValue extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: Array<SettingsChoiceOption<TValue>>;
  value: TValue;
  onChange: (value: TValue, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="chat-user-settings__option-group" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            className={`chat-user-settings__option-button ${selected ? 'is-active' : ''}`}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={(event) => onChange(option.value, event)}
          >
            <span className="chat-user-settings__option-icon">{option.icon}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function GeneralSettings() {
  const { fontFamily, fontSize, setFontFamily, setFontSize } = useAppearancePreferences();
  const { mode, setThemeModeWithTransition } = useThemeTransition();
  const availableFontFamilyOptions = getFontFamilyOptionsForPlatform();
  const selectedFont = availableFontFamilyOptions.find((item) => item.value === fontFamily) ?? fontFamilyOptions.find((item) => item.value === fontFamily) ?? availableFontFamilyOptions[0] ?? fontFamilyOptions[0];
  const fontFamilySelectOptions = availableFontFamilyOptions.some((item) => item.value === selectedFont.value)
    ? availableFontFamilyOptions
    : [selectedFont, ...availableFontFamilyOptions];
  const fontSizeIndex = Math.max(0, fontSizeOptions.indexOf(fontSize));
  const scaleMarkMaxIndex = Math.max(fontSizeOptions.length - 1, 1);
  const fontSizeProgress = `${(fontSizeIndex / scaleMarkMaxIndex) * 100}%`;
  const getScaleMarkLeft = (index: number) => {
    const ratio = index / scaleMarkMaxIndex;
    return `calc(${ratio * 100}% + ${7 - 14 * ratio}px)`;
  };

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
              value={selectedFont.value}
              style={{ fontFamily: selectedFont.css }}
              onChange={(event) => setFontFamily(event.currentTarget.value as FontFamilyMode)}
            >
              {fontFamilySelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <div className="chat-user-settings__font-preview" style={{ fontFamily: selectedFont.css }}>
            <div className="chat-user-settings__font-preview-pane">
              <span className="chat-user-settings__font-preview-label">Plain Text</span>
              <div className="chat-user-settings__font-preview-body">
                <strong>Setsuna Agent</strong>
                <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
                <p>abcdefghijklmnopqrstuvwxyz</p>
                <p>Readable interface text, numbers 1234567890, and punctuation .,;!?()[]</p>
                <p>普通文本预览：观察中文、英文、数字和标点的字重与间距。</p>
              </div>
            </div>
            <div className="chat-user-settings__font-preview-pane">
              <span className="chat-user-settings__font-preview-label">Markdown</span>
              <div className="chat-user-settings__font-preview-body chat-user-settings__font-preview-markdown">
                <strong>1. Markdown preview</strong>
                <p>
                  Use <code>inline code</code> with links, emphasis, and mixed 中文内容.
                </p>
                <ul>
                  <li>
                    <strong>Clean:</strong> headings, lists, and code stay balanced.
                  </li>
                </ul>
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
            <div className="chat-user-settings__slider" style={{ '--settings-scale-progress': fontSizeProgress } as CSSProperties}>
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
                {fontSizeOptions.map((option, index) => (
                  <span
                    key={option}
                    className={index <= fontSizeIndex ? 'is-active' : undefined}
                    style={{ '--settings-scale-mark-left': getScaleMarkLeft(index) } as CSSProperties}
                  >
                    {Number(option) % 10 === 0 ? `${option}%` : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Sun size={14} />
              <span>主题色彩</span>
            </span>
            <SettingsChoiceGroup ariaLabel="主题色彩" options={themeModeOptions} value={mode} onChange={setThemeModeWithTransition} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AboutSettings({ updater }: { updater: DesktopUpdaterStateView }) {
  const state = updater.state;
  const updatePercent = updater.ready ? 100 : Math.round(state?.progress?.percent ?? 0);
  const updateBusy = updater.checking || state?.status === 'checking' || state?.status === 'available' || state?.status === 'downloading';
  const updateUnsupported = state?.canUpdate === false || state?.status === 'unsupported';
  const showCheckButton = Boolean(updater.api && !updater.ready);
  const showProgress = updateBusy || updater.ready;
  const releaseUrl = state?.releaseUrl ?? state?.feedUrl ?? null;
  const platform = state?.platform ?? (typeof window === 'undefined' ? 'desktop' : window.setsunaDesktop?.desktop.platform ?? 'desktop');
  const arch = state?.arch ?? 'unknown';

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__about-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">应用信息</div>
        <div className="chat-user-settings__group">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Info size={14} />
              <span>当前版本</span>
            </span>
            <strong className="chat-user-settings__value">v{updater.currentVersion}</strong>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Monitor size={14} />
              <span>平台</span>
            </span>
            <code>
              {platform} / {arch}
            </code>
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">更新</div>
        <div className="chat-user-settings__group chat-user-settings__update-panel">
          <div className="chat-user-settings__update-main">
            {showProgress ? (
              <span className="chat-user-settings__update-progress" style={{ '--settings-update-progress': `${updatePercent}%` } as CSSProperties}>
                <span>{updatePercent}%</span>
              </span>
            ) : null}
            <div className="chat-user-settings__update-copy">
              <strong>
                {updater.statusTitle}
                <StatusBadge tone={updateBadgeTone(state)}>{updateBadgeText(state)}</StatusBadge>
              </strong>
              <span>{updater.statusText}</span>
              {updater.updateVersion ? <span>目标版本：v{updater.updateVersion.replace(/^v/u, '')}</span> : null}
              {state?.assetName ? <span>安装包：{state.assetName}</span> : null}
              {releaseUrl ? (
                <button
                  className="chat-user-settings__release-link"
                  type="button"
                  title={releaseUrl}
                  onClick={() => void window.setsunaDesktop?.links.openExternal(releaseUrl)}
                >
                  更新内容：<span>{releaseUrl}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="chat-user-settings__update-actions">
            {showCheckButton ? (
              <Button
                className="chat-user-settings__update-action"
                icon={<RefreshCw size={14} />}
                disabled={updateBusy || updateUnsupported}
                onClick={() => void updater.checkForUpdates()}
              >
                {updateBusy ? '检查中' : '检查更新'}
              </Button>
            ) : null}
            {updater.ready ? (
              <Button
                className="chat-user-settings__update-action chat-user-settings__update-action--primary"
                variant="primary"
                disabled={updater.installing}
                onClick={() => void updater.installReadyUpdate()}
              >
                {updater.installButtonText}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function updateBadgeTone(state: DesktopUpdaterBridgeState | null): 'neutral' | 'success' | 'warning' | 'danger' {
  if (state?.status === 'downloaded') return 'warning';
  if (state?.status === 'not-available') return 'success';
  if (state?.status === 'error' || state?.status === 'unsupported') return 'danger';
  return 'neutral';
}

function updateBadgeText(state: DesktopUpdaterBridgeState | null): string {
  if (state?.status === 'downloaded') return '待安装';
  if (state?.status === 'downloading') return '下载中';
  if (state?.status === 'checking') return '检查中';
  if (state?.status === 'not-available') return '最新';
  if (state?.status === 'error') return '失败';
  if (state?.status === 'unsupported') return '不可用';
  return '自动';
}

function RuntimePolicySettings({
  config,
  onSave,
}: {
  config: RuntimeConfigState;
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
}) {
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [localPathError, setLocalPathError] = useState<string | null>(null);

  const openRuntimePath = async (targetPath: string, label: string) => {
    const normalizedPath = targetPath.trim();
    if (!normalizedPath) {
      setLocalPathError(`${label}路径为空。`);
      return;
    }
    const api = window.setsunaDesktop?.desktop;
    if (!api?.openPath) {
      setLocalPathError('当前环境不支持打开本地路径。');
      return;
    }
    setOpeningPath(normalizedPath);
    setLocalPathError(null);
    try {
      const result = await api.openPath(normalizedPath);
      if (!result.ok) setLocalPathError(result.error || `${label}打开失败。`);
    } catch (unknownError) {
      setLocalPathError(errorMessage(unknownError, `${label}打开失败。`));
    } finally {
      setOpeningPath(null);
    }
  };

  const isOpeningConfig = openingPath === config.configPath;
  const isOpeningData = openingPath === config.dataPath;
  const pathActionDisabled = Boolean(openingPath);

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__runtime-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">策略</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
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
              <option value="strict">严格授权</option>
              <option value="on-request">智能授权</option>
              <option value="full">完全授权</option>
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
            <div className="chat-user-settings__path-control">
              <code title={config.configPath}>{config.configPath}</code>
              <Button
                className="chat-user-settings__path-open"
                icon={<FolderOpen size={14} />}
                disabled={pathActionDisabled}
                onClick={() => void openRuntimePath(config.configPath, '配置文件')}
              >
                {isOpeningConfig ? '打开中' : '打开'}
              </Button>
            </div>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Database size={14} />
              <span>数据目录</span>
            </span>
            <div className="chat-user-settings__path-control">
              <code title={config.dataPath}>{config.dataPath}</code>
              <Button
                className="chat-user-settings__path-open"
                icon={<FolderOpen size={14} />}
                disabled={pathActionDisabled}
                onClick={() => void openRuntimePath(config.dataPath, '数据目录')}
              >
                {isOpeningData ? '打开中' : '打开'}
              </Button>
            </div>
          </div>
        </div>
        {localPathError ? <div className="chat-user-settings__runtime-error">{localPathError}</div> : null}
      </div>
    </div>
  );
}

function PersonalizationSettings({
  config,
  memoryPreview,
  memoryPreviewLoading,
  onSavePreferences,
  onPreview,
  onDelete,
  onReset,
}: {
  config: RuntimeConfigState;
  memoryPreview: RuntimeMemoryPreview | null;
  memoryPreviewLoading: boolean;
  onSavePreferences: (input: RuntimePreferenceInput) => Promise<void>;
  onPreview: () => Promise<RuntimeMemoryPreview>;
  onDelete: (memoryId: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [personalizationView, setPersonalizationView] = useState<'overview' | 'memoryPreview'>('overview');
  const [globalPromptDraft, setGlobalPromptDraft] = useState(config.globalPrompt);
  const [selectingStorage, setSelectingStorage] = useState(false);
  const [memoryDeletingId, setMemoryDeletingId] = useState<string | null>(null);
  const [memoryResetting, setMemoryResetting] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const globalPromptLength = Array.from(globalPromptDraft).length;
  const storagePath = config.storagePath || config.dataPath;

  useEffect(() => {
    setGlobalPromptDraft(config.globalPrompt);
  }, [config.globalPrompt]);

  useEffect(() => {
    if (globalPromptDraft === config.globalPrompt) return undefined;
    const timer = window.setTimeout(() => {
      void onSavePreferences({ globalPrompt: globalPromptDraft });
    }, PERSONALIZATION_PROMPT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [config.globalPrompt, globalPromptDraft, onSavePreferences]);

  const selectMemoryStoragePath = async () => {
    const api = window.setsunaDesktop?.desktop;
    if (!api?.selectDirectory) {
      setMemoryError('当前环境不支持选择目录。');
      return;
    }
    setSelectingStorage(true);
    setMemoryError(null);
    try {
      const selectedPath = await api.selectDirectory({ title: '选择记忆存储目录' });
      if (selectedPath) await onSavePreferences({ storagePath: selectedPath });
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, '选择存储位置失败'));
    } finally {
      setSelectingStorage(false);
    }
  };

  const loadMemoryPreview = async () => {
    setMemoryError(null);
    try {
      return await onPreview();
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, '记忆预览加载失败'));
      return null;
    }
  };

  const openMemoryPreview = async () => {
    setPersonalizationView('memoryPreview');
    await loadMemoryPreview();
  };

  const deleteMemoryItem = async (item: RuntimeMemoryPreviewItem) => {
    setMemoryDeletingId(item.id);
    setMemoryError(null);
    try {
      await onDelete(item.id);
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, '删除记忆失败'));
    } finally {
      setMemoryDeletingId(null);
    }
  };

  const resetMemoryItems = async () => {
    setMemoryResetting(true);
    setMemoryError(null);
    try {
      await onReset();
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, '重置记忆失败'));
    } finally {
      setMemoryResetting(false);
    }
  };

  if (personalizationView === 'memoryPreview') {
    const items = memoryPreview?.items ?? [];
    const previewStoragePath = memoryPreview?.storagePath || storagePath;

    return (
      <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__memory-preview-section">
        <PageHeader
          className="chat-user-settings__memory-preview-header"
          onBack={() => setPersonalizationView('overview')}
          title="记忆预览"
          actions={
            <Button
              className="chat-user-settings__tiny-action"
              icon={<RefreshCw size={14} />}
              disabled={memoryPreviewLoading || memoryResetting || Boolean(memoryDeletingId)}
              onClick={() => void loadMemoryPreview()}
            >
              {memoryPreviewLoading ? '刷新中' : '刷新'}
            </Button>
          }
        />
        <div className="chat-user-settings__memory-preview-summary">
          <div>
            <strong>{memoryPreview?.total ?? 0} 条记忆</strong>
            <span>包含主动沉淀和后台沉淀的长期偏好、规则、事实或流程</span>
          </div>
          <code title={previewStoragePath}>{previewStoragePath}</code>
        </div>
        {memoryError ? <div className="chat-user-settings__memory-error">{memoryError}</div> : null}
        <div className="chat-user-settings__memory-list" aria-busy={memoryPreviewLoading}>
          {items.length ? (
            items.map((item) => {
              const meta = [
                item.origin === 'active' ? '主动沉淀' : '后台沉淀',
                item.scope === 'global' ? '全局' : '项目范围',
                item.source,
                formatMemoryDate(item.updatedAt),
                `${Number(item.chars || 0).toLocaleString()} 字符`,
              ].filter(Boolean);

              return (
                <div className="chat-user-settings__memory-item" key={item.id}>
                  <div className="chat-user-settings__memory-item-head">
                    <FileText size={14} />
                    <span title={item.workspaceRoot || item.title}>{item.title}</span>
                    <IconButton
                      label="删除记忆"
                      variant="danger"
                      disabled={memoryResetting || memoryPreviewLoading || memoryDeletingId === item.id}
                      onClick={() => void deleteMemoryItem(item)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                  <div className="chat-user-settings__memory-item-meta">
                    {meta.map((value, index) => (
                      <span key={`${value}-${index}`}>{value}</span>
                    ))}
                  </div>
                  {item.tags?.length ? (
                    <div className="chat-user-settings__memory-tags">
                      {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  ) : null}
                  <pre className="chat-user-settings__memory-snippet">{item.preview}</pre>
                </div>
              );
            })
          ) : (
            <EmptyState title={memoryPreviewLoading ? '正在加载记忆' : '暂无沉淀下来的记忆'} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__personalization-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">风格</div>
        <div className="chat-user-settings__group chat-user-settings__personalization-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Pencil size={14} />
              <span>Setsuna 风格</span>
            </span>
            <SettingsChoiceGroup
              ariaLabel="Setsuna 风格"
              options={setsunaStyleOptions}
              value={config.setsunaStyle}
              onChange={(setsunaStyle) => void onSavePreferences({ setsunaStyle })}
            />
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group chat-user-settings__personalization-card chat-user-settings__personalization-card--prompt">
          <div className="chat-user-settings__prompt-stack">
            <div className="chat-user-settings__prompt-heading">
              <div className="chat-user-settings__prompt-title">
                <span>全局 prompt</span>
              </div>
              <p>会作为桌面端对话的长期偏好放入上下文，适合写固定口吻、工作习惯和长期约束。</p>
            </div>
            <div className="chat-user-settings__prompt-control">
              <div className="chat-user-settings__prompt-input-shell">
                <TextArea
                  className="chat-user-settings__prompt-input"
                  value={globalPromptDraft}
                  maxLength={PERSONALIZATION_PROMPT_MAX_LENGTH}
                  placeholder="写给 Setsuna 的长期偏好，会放入桌面端对话上下文。"
                  onBlur={() => {
                    if (globalPromptDraft === config.globalPrompt) return;
                    void onSavePreferences({ globalPrompt: globalPromptDraft });
                  }}
                  onChange={(event) => setGlobalPromptDraft(event.target.value)}
                />
                <span className="chat-user-settings__prompt-count">{globalPromptLength} / {PERSONALIZATION_PROMPT_MAX_LENGTH}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block chat-user-settings__memory-settings-block">
        <div className="chat-user-settings__memory-heading">
          <div className="chat-user-settings__group-title">记忆</div>
          <p>
            记忆用于保存你希望长期生效的偏好、项目规则、固定流程和事实信息。开启后，后续对话会按当前项目或全局范围自动召回相关记忆，帮助模型延续你的工作习惯；你可以在预览中查看、删除单条记忆，或在这里重置全部记忆。
          </p>
        </div>
        {memoryError ? <div className="chat-user-settings__memory-error">{memoryError}</div> : null}
        <div className="chat-user-settings__group chat-user-settings__personalization-card">
          <div className="chat-user-settings__row chat-user-settings__local-enable-row">
            <span className="chat-user-settings__row-label">
              <Database size={14} />
              <span>启用记忆</span>
            </span>
            <label className="sd-check">
              <input
                type="checkbox"
                checked={config.memoryEnabled}
                onChange={(event) => void onSavePreferences({ memoryEnabled: event.currentTarget.checked })}
              />
              <span>开启</span>
            </label>
          </div>
          <div className="chat-user-settings__row chat-user-settings__local-field">
            <span className="chat-user-settings__row-label">
              <FolderOpen size={14} />
              <span>存储位置</span>
            </span>
            <div className="chat-user-settings__local-storage-control">
              <TextField className="settings-local-control" value={storagePath} readOnly />
              <Button icon={<FolderOpen size={14} />} disabled={selectingStorage} onClick={() => void selectMemoryStoragePath()}>
                {selectingStorage ? '选择中' : '选择'}
              </Button>
            </div>
          </div>
          <div className="chat-user-settings__row chat-user-settings__local-action-row">
            <span className="chat-user-settings__row-label">
              <Eye size={14} />
              <span>记忆预览</span>
            </span>
            <Button className="chat-user-settings__preview-open" icon={<ChevronRight size={14} />} onClick={() => void openMemoryPreview()}>
              查看
            </Button>
          </div>
          <div className="chat-user-settings__row chat-user-settings__local-action-row chat-user-settings__memory-reset-row">
            <span className="chat-user-settings__row-label">
              <RefreshCw size={14} />
              <span>重置记忆</span>
            </span>
            <Popconfirm
              title="重置全部记忆？"
              description="这会清空所有已保存记忆，无法撤销。"
              placement="topRight"
              okText="重置"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: memoryResetting }}
              onConfirm={() => void resetMemoryItems()}
            >
              <Button
                variant="danger"
                icon={<RefreshCw size={14} />}
                disabled={memoryPreviewLoading || Boolean(memoryDeletingId) || memoryResetting}
              >
                {memoryResetting ? '重置中' : '重置'}
              </Button>
            </Popconfirm>
          </div>
        </div>
      </div>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatMemoryDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const [selectedProviderId, setSelectedProviderId] = useState(() => selectedProviderIdFromConfig(config));
  const [apiKeysByProviderId, setApiKeysByProviderId] = useState<Record<string, string>>({});
  const [fetchStateByProviderId, setFetchStateByProviderId] = useState<Record<string, ModelFetchState>>({});
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(() => idleSaveState());

  useEffect(() => {
    const nextProviders = normalizeSettingsProviders(config.providers);
    setProviders(nextProviders);
    setSelectedProviderId((current) => (
      nextProviders.some((provider) => provider.id === current)
        ? current
        : nextProviders.find((provider) => provider.id === config.activeProviderId)?.id ?? nextProviders[0]?.id ?? ''
    ));
    setApiKeysByProviderId({});
    setFetchStateByProviderId({});
  }, [config.activeProviderId, config.providers]);

  const updateProvider = (providerId: string, updater: (provider: ProviderConfigState) => ProviderConfigState) => {
    setSaveState(idleSaveState());
    setProviders((current) => current.map((provider) => (provider.id === providerId ? updater(provider) : provider)));
  };

  const updateModel = (providerId: string, modelId: string, updater: (model: ProviderModelConfig) => ProviderModelConfig) => {
    updateProvider(providerId, (provider) => ({
      ...provider,
      models: provider.models.map((model) => (model.id === modelId ? updater(model) : model)),
    }));
  };

  const setProviderApiKey = (providerId: string, value: string) => {
    setSaveState(idleSaveState());
    setApiKeysByProviderId((current) => ({ ...current, [providerId]: value }));
  };

  const addProvider = () => {
    const nextProvider = defaultProviderConfig();
    setSaveState(idleSaveState());
    setProviders((current) => [...current, nextProvider]);
    setSelectedProviderId(nextProvider.id);
  };

  const removeProvider = (providerId: string) => {
    setSaveState(idleSaveState());
    setProviders((current) => {
      const removedIndex = Math.max(0, current.findIndex((provider) => provider.id === providerId));
      const next = current.filter((provider) => provider.id !== providerId);
      const normalizedNext = next.length ? next : [defaultProviderConfig()];
      setSelectedProviderId((selected) => (
        selected === providerId
          ? normalizedNext[Math.min(removedIndex, normalizedNext.length - 1)]?.id ?? normalizedNext[0]?.id ?? ''
          : selected
      ));
      return normalizedNext;
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
      provider: provider.provider,
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
    if (saving) return;
    setSaving(true);
    setSaveState({ status: 'saving', message: '保存中...' });
    void onSave(providers.map(prepareProviderForSave), apiKeysByProviderId)
      .then(() => setSaveState({ status: 'saved', message: '已保存' }))
      .catch((error) => setSaveState({ status: 'error', message: error instanceof Error ? error.message : String(error) }))
      .finally(() => setSaving(false));
  };

  const enabledProviderCount = providers.filter((provider) => provider.enabled).length;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];
  const selectedProviderIndex = selectedProvider ? providers.findIndex((provider) => provider.id === selectedProvider.id) : -1;
  const selectedFetchState = selectedProvider ? fetchStateByProviderId[selectedProvider.id] ?? emptyModelFetchState() : emptyModelFetchState();
  const saveStatusMessage = saveState.message || '密钥不会出现在渲染进程响应中。';

  return (
    <div className="chat-user-settings__local-provider-stack">
      <div className="chat-user-settings__local-provider-layout">
        <aside className="chat-user-settings__local-provider-rail">
          <div className="chat-user-settings__local-provider-rail-head">
            <div>
              <span>厂商</span>
              <strong>{`${enabledProviderCount} / ${providers.length} 启用`}</strong>
            </div>
            <IconButton label="添加厂商" onClick={addProvider}>
              <Plus size={14} />
            </IconButton>
          </div>
          <div className="chat-user-settings__local-provider-list" role="listbox" aria-label="本地模型厂商">
            {providers.map((provider, providerIndex) => {
              const activeModel = provider.models.find((model) => model.enabled) ?? provider.models[0];
              const selected = provider.id === selectedProvider?.id;
              return (
                <button
                  className={`chat-user-settings__local-provider-item ${selected ? 'is-active' : ''}`}
                  key={provider.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => setSelectedProviderId(provider.id)}
                >
                  <span className="chat-user-settings__local-provider-item-icon">
                    <HardDrive size={13} />
                  </span>
                  <span className="chat-user-settings__local-provider-item-body">
                    <span className="chat-user-settings__local-provider-item-name">{provider.name || `厂商 ${providerIndex + 1}`}</span>
                    <span className="chat-user-settings__local-provider-item-meta">
                      {`${provider.enabled ? '启用' : '停用'} · ${providerProtocolLabel(provider.provider)} · ${provider.models.length} 模型${activeModel?.name ? ` · ${activeModel.name}` : ''}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
        {selectedProvider ? (
          <div className="chat-user-settings__local-provider-card">
            <div className="chat-user-settings__local-provider-head">
              <div className="chat-user-settings__local-provider-title">
                <HardDrive size={14} />
                <span>{selectedProvider.name || `厂商 ${selectedProviderIndex + 1}`}</span>
              </div>
              <div className="chat-user-settings__local-provider-actions">
                <label className="sd-check">
                  <input
                    type="checkbox"
                    checked={selectedProvider.enabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      updateProvider(selectedProvider.id, (item) => ({ ...item, enabled }));
                    }}
                  />
                  <span>启用</span>
                </label>
                <span className="chat-user-settings__provider-meta">{`${providerProtocolLabel(selectedProvider.provider)} · ${selectedProvider.models.length} models`}</span>
                {providers.length > 1 ? (
                  <IconButton label="删除厂商" variant="danger" onClick={() => removeProvider(selectedProvider.id)}>
                    <Trash2 size={14} />
                  </IconButton>
                ) : null}
                <Button variant="primary" icon={<Save size={15} />} disabled={saving} onClick={save}>
                  {saving ? '保存中' : '保存'}
                </Button>
              </div>
            </div>
            <div className="chat-user-settings__local-provider-body">
              <section className="settings-form-section">
                <div className="settings-form-section__head">
                  <span>连接</span>
                  <code>{providerProtocolMeta(selectedProvider.provider)}</code>
                </div>
                <div className="chat-user-settings__group chat-user-settings__local-provider-form">
                  <label className="chat-user-settings__row">
                    <span className="chat-user-settings__row-label">协议</span>
                    <SelectField
                      className="settings-local-control"
                      value={selectedProvider.provider}
                      onChange={(event) => {
                        const provider = normalizeProviderKind(event.currentTarget.value);
                        setFetchStateByProviderId((current) => ({ ...current, [selectedProvider.id]: emptyModelFetchState() }));
                        updateProvider(selectedProvider.id, (item) => ({ ...item, provider }));
                      }}
                    >
                      {providerProtocolOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SelectField>
                  </label>
                  <label className="chat-user-settings__row">
                    <span className="chat-user-settings__row-label">供应商名称</span>
                    <TextField
                      className="settings-local-control"
                      value={selectedProvider.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        updateProvider(selectedProvider.id, (item) => ({ ...item, name }));
                      }}
                    />
                  </label>
                  <label className="chat-user-settings__row">
                    <span className="chat-user-settings__row-label">服务地址</span>
                    <TextField
                      className="settings-local-control"
                      value={selectedProvider.baseUrl}
                      placeholder={providerBaseUrlPlaceholder(selectedProvider.provider)}
                      onChange={(event) => {
                        const baseUrl = event.target.value;
                        setFetchStateByProviderId((current) => ({ ...current, [selectedProvider.id]: emptyModelFetchState() }));
                        updateProvider(selectedProvider.id, (item) => ({ ...item, baseUrl }));
                      }}
                    />
                  </label>
                  <label className="chat-user-settings__row">
                    <span className="chat-user-settings__row-label">API Key {selectedProvider.apiKeySet ? <em>{selectedProvider.apiKeyPreview}</em> : null}</span>
                    <TextField
                      className="settings-local-control"
                      type="password"
                      value={apiKeysByProviderId[selectedProvider.id] ?? ''}
                      onChange={(event) => setProviderApiKey(selectedProvider.id, event.target.value)}
                      placeholder={providerApiKeyPlaceholder(selectedProvider)}
                    />
                  </label>
                </div>
              </section>
              <section className="settings-form-section">
                <div className="settings-model-list">
              <div className="settings-model-list__head">
                <span>模型</span>
                <div className="settings-model-list__actions">
                  <Button icon={<RefreshCw size={14} />} disabled={selectedFetchState.fetching} onClick={() => fetchModels(selectedProvider)}>
                    {selectedFetchState.fetching ? '获取中' : '自动获取'}
                  </Button>
                  <Button icon={<Plus size={14} />} onClick={() => addModel(selectedProvider.id)}>添加模型</Button>
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
              {selectedProvider.models.map((model) => {
                const thinkingEfforts = normalizeThinkingEfforts(model.thinkingEfforts);
                const defaultThinkingEffort = normalizedDefaultThinkingEffort({ ...model, thinkingEfforts });
                const thinkingPresetOptions = mergeThinkingPresetOptions(normalizeThinkingEfforts([...thinkingEfforts, defaultThinkingEffort]));
                return (
                <div className="settings-model-grid settings-model-row" key={model.id}>
                  <label className="settings-model-default">
                    <span>默认</span>
                    <input
                      type="radio"
                      name={`default-model-${selectedProvider.id}`}
                      checked={model.enabled}
                      onChange={() => selectDefaultModel(selectedProvider.id, model.id)}
                    />
                  </label>
                  <label className="settings-model-field settings-model-field--name">
                    <span>显示名称</span>
                    <TextField
                      className="settings-local-control"
                      value={model.name}
                      placeholder="显示名称"
                      onChange={(event) => {
                        const name = event.target.value;
                        updateModel(selectedProvider.id, model.id, (item) => ({ ...item, name }));
                      }}
                    />
                  </label>
                  <label className="settings-model-field settings-model-field--code">
                    <span>模型 ID</span>
                    <TextField
                      className="settings-local-control"
                      value={model.code}
                      placeholder="llama3.1"
                      onChange={(event) => {
                        const code = event.target.value;
                        updateModel(selectedProvider.id, model.id, (item) => updateModelCode(item, code));
                      }}
                    />
                  </label>
                  <label className="settings-model-field settings-model-field--output">
                    <span>输出</span>
                    <TextField
                      className="settings-local-control"
                      type="number"
                      min={1}
                      value={model.maxOutputTokens}
                      onChange={(event) => {
                        const maxOutputTokens = positiveInt(Number(event.target.value), DEFAULT_MODEL_MAX_OUTPUT_TOKENS);
                        updateModel(selectedProvider.id, model.id, (item) => ({ ...item, maxOutputTokens }));
                      }}
                    />
                  </label>
                  <div className="settings-model-group settings-model-capabilities">
                    <span>能力</span>
                    <div className="settings-model-inline-checks">
                      <label className="sd-check settings-model-check">
                        <input
                          type="checkbox"
                          checked={model.thinkingEnabled}
                          onChange={(event) => {
                            const thinkingEnabled = event.currentTarget.checked;
                            updateModel(selectedProvider.id, model.id, (item) => setThinkingEnabled(item, thinkingEnabled));
                          }}
                        />
                        <Brain size={13} />
                        <span>思考</span>
                      </label>
                      <label className="sd-check settings-model-check">
                        <input
                          type="checkbox"
                          checked={Boolean(model.supportsImages)}
                          onChange={(event) => {
                            const supportsImages = event.currentTarget.checked;
                            updateModel(selectedProvider.id, model.id, (item) => ({ ...item, supportsImages }));
                          }}
                        />
                        <ImageIcon size={13} />
                        <span>图片</span>
                      </label>
                    </div>
                  </div>
                  <div className="settings-model-group settings-thinking-levels">
                    <span>思考等级</span>
                    <div className="settings-thinking-levels__content">
                      <TextField
                        aria-label="思考等级"
                        className="settings-thinking-default"
                        disabled={!model.thinkingEnabled}
                        placeholder="自定义，例如 xhigh / max"
                        value={model.thinkingEnabled ? defaultThinkingEffort ?? '' : ''}
                        onChange={(event) => {
                          const effort = event.target.value;
                          updateModel(selectedProvider.id, model.id, (item) => setDefaultThinkingEffort(item, effort));
                        }}
                      />
                      <div className="settings-thinking-presets" aria-label="常用思考等级">
                        {thinkingPresetOptions.map((effort) => (
                          <button
                            key={effort}
                            className={`settings-thinking-preset ${defaultThinkingEffort === effort ? 'is-active' : ''}`}
                            type="button"
                            disabled={!model.thinkingEnabled}
                            onClick={() => updateModel(selectedProvider.id, model.id, (item) => setDefaultThinkingEffort(item, effort))}
                          >
                            {effort}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <IconButton label="删除模型" className="settings-model-delete" variant="danger" disabled={selectedProvider.models.length <= 1} onClick={() => removeModel(selectedProvider.id, model.id)}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
                );
              })}
              {selectedFetchState.error ? <div className="settings-model-fetch-state settings-model-fetch-state--error">{selectedFetchState.error}</div> : null}
              {!selectedFetchState.error && selectedFetchState.models.length ? <div className="settings-model-fetch-state">{`已获取 ${selectedFetchState.models.length} 个模型，保存后生效。`}</div> : null}
                </div>
              </section>
            </div>
            <div className="settings-form__footer">
              <span className={`settings-save-status settings-save-status--${saveState.status}`} aria-live="polite">
                <KeyRound size={14} />
                {saveStatusMessage}
              </span>
            </div>
          </div>
        ) : (
          <div className="chat-user-settings__local-provider-card">
            <EmptyState title="暂无厂商" />
          </div>
        )}
      </div>
    </div>
  );
}

const DEFAULT_PROVIDER_KIND: ProviderConfigState['provider'] = 'openai-compatible';
const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 68000;
const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const providerProtocolOptions: Array<{ value: ProviderConfigState['provider']; label: string; meta: string; placeholder: string }> = [
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible',
    meta: 'OpenAI-compatible · AI SDK',
    placeholder: 'http://127.0.0.1:11434/v1',
  },
  {
    value: 'openai-responses',
    label: 'OpenAI Responses',
    meta: 'OpenAI Responses · /responses',
    placeholder: 'https://api.openai.com/v1',
  },
  {
    value: 'anthropic',
    label: 'Anthropic Messages',
    meta: 'Anthropic · /v1/messages',
    placeholder: 'https://api.anthropic.com',
  },
];
type ModelFetchState = {
  models: RuntimeAvailableModel[];
  error: string;
  fetching: boolean;
};

type SaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message: string;
};

function emptyModelFetchState(): ModelFetchState {
  return { models: [], error: '', fetching: false };
}

function idleSaveState(): SaveState {
  return { status: 'idle', message: '' };
}

function selectedProviderIdFromConfig(config: RuntimeConfigState): string {
  return config.providers.find((provider) => provider.id === config.activeProviderId)?.id ?? config.providers[0]?.id ?? '';
}

function normalizeSettingsProviders(providers: ProviderConfigState[]): ProviderConfigState[] {
  const normalized = (providers.length ? providers : [defaultProviderConfig()]).map((provider) => ({
    ...provider,
    provider: normalizeProviderKind(provider.provider),
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
    defaultThinkingEffort: model.thinkingEnabled ? normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }) : undefined,
    supportsImages: Boolean(model.supportsImages),
  };
}

function defaultProviderConfig(): ProviderConfigState {
  return {
    id: uniqueLocalId('provider'),
    name: 'Local provider',
    provider: DEFAULT_PROVIDER_KIND,
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
    provider: normalizeProviderKind(provider.provider),
    models: normalizeProviderModels(provider.models).map((model) => ({
      ...model,
      defaultThinkingEffort: normalizedDefaultThinkingEffort(model),
    })),
  };
}

function normalizeProviderKind(value: unknown): ProviderConfigState['provider'] {
  return providerProtocolOptions.find((option) => option.value === value)?.value ?? DEFAULT_PROVIDER_KIND;
}

function providerProtocolLabel(provider: ProviderConfigState['provider']): string {
  return providerProtocolOption(provider).label;
}

function providerProtocolMeta(provider: ProviderConfigState['provider']): string {
  return providerProtocolOption(provider).meta;
}

function providerBaseUrlPlaceholder(provider: ProviderConfigState['provider']): string {
  return providerProtocolOption(provider).placeholder;
}

function providerProtocolOption(provider: ProviderConfigState['provider']) {
  return providerProtocolOptions.find((option) => option.value === provider) ?? providerProtocolOptions[0];
}

function providerApiKeyPlaceholder(provider: ProviderConfigState): string {
  if (provider.apiKeySet) return '留空则保留当前密钥';
  return provider.provider === 'openai-compatible' ? '本地服务可留空' : '本地兼容服务可留空';
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
    const thinkingEfforts = normalizeThinkingEfforts([
      ...(previous?.thinkingEfforts ?? []),
      ...(model.thinkingEfforts ?? []),
      previous?.defaultThinkingEffort,
      model.defaultThinkingEffort,
    ]);
    const defaultThinkingEffort = nonEmptyString(previous?.defaultThinkingEffort) ?? nonEmptyString(model.defaultThinkingEffort);
    return normalizeProviderModel({
      ...defaultProviderModel(code, code === activeCode),
      id: previous?.id || modelIdFromCode(code),
      name: model.name?.trim() || code,
      maxOutputTokens: previous?.maxOutputTokens ?? model.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
      thinkingEnabled: Boolean(previous?.thinkingEnabled || model.thinkingEnabled || thinkingEfforts.length || defaultThinkingEffort),
      thinkingEfforts,
      defaultThinkingEffort,
      supportsImages: Boolean(previous?.supportsImages || model.supportsImages),
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
  const thinkingEfforts = normalizeThinkingEfforts(model.thinkingEfforts);
  return {
    ...model,
    thinkingEnabled,
    thinkingEfforts,
    defaultThinkingEffort: normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }),
  };
}

function setDefaultThinkingEffort(model: ProviderModelConfig, effort: string): ProviderModelConfig {
  const defaultThinkingEffort = nonEmptyString(effort);
  const thinkingEfforts = defaultThinkingEffort ? [defaultThinkingEffort] : [];
  return {
    ...model,
    thinkingEfforts,
    thinkingEnabled: model.thinkingEnabled,
    defaultThinkingEffort,
  };
}

function normalizedDefaultThinkingEffort(model: ProviderModelConfig): string | undefined {
  if (!model.thinkingEnabled) return undefined;
  return normalizeDefaultThinkingEffort(model);
}

function normalizeDefaultThinkingEffort(model: Pick<ProviderModelConfig, 'defaultThinkingEffort' | 'thinkingEfforts'>): string | undefined {
  return nonEmptyString(model.defaultThinkingEffort);
}

function normalizeThinkingEfforts(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\s]+/)
      : [];
  const seen = new Set<string>();
  const efforts: string[] = [];
  for (const rawValue of rawValues) {
    const effort = nonEmptyString(rawValue);
    if (!effort || seen.has(effort)) continue;
    seen.add(effort);
    efforts.push(effort);
  }
  return efforts;
}

function mergeThinkingPresetOptions(efforts: string[]): string[] {
  return normalizeThinkingEfforts([...REASONING_EFFORTS, ...efforts]);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
