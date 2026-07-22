import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Popconfirm } from 'antd';
import { Archive, Bold, Brain, ChevronRight, CircleGauge, Code2, Cpu, Database, Eye, FileCog, FileText, FolderOpen, Globe2, HardDrive, Image as ImageIcon, Info, Library, Monitor, Moon, Paintbrush, Palette, PanelLeft, Pencil, Plus, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Trash2, Type, Undo2, Wrench, X } from 'lucide-react';
import { defaultModelMaxOutputTokens, type BrandIconConfig, type ProviderConfigState, type ProviderModelConfig, type RuntimeAvailableModel, type RuntimeAvailableModelsResponse, type RuntimeConfigInput, type RuntimeConfigState, type RuntimeDesktopSettings, type RuntimeFetchModelsInput, type RuntimeMemoryPreview, type RuntimeMemoryPreviewItem, type RuntimeThread, type RuntimeThreadSummary, type RuntimeUsageResponse, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button, EmptyState, IconButton, PageBackButton, PageHeader, SelectField, StatusBadge, TextArea, TextField } from '../primitives.js';
import { formatTokens } from '../workspace/model.js';
import { accentColorOptions, useAccentColorPreference, type AccentColor } from '../../hooks/useAccentColorPreference.js';
import { fontFamilyOptions, fontSizeOptions, fontWeightOptions, getFontFamilyOptionsForPlatform, useAppearancePreferences, type FontFamilyMode, type FontWeightMode } from '../../hooks/useAppearancePreferences.js';
import { codeColorSchemeOptions, codeFontFamilyOptions, codeHighlightThemeOptions, getCodeFontFamilyOptionsForPlatform, useCodeAppearancePreferences, type CodeColorScheme, type CodeFontFamilyMode, type CodeHighlightTheme } from '../../hooks/useCodeAppearancePreferences.js';
import { sidebarBackgroundOptions, useSidebarBackgroundPreference, type SidebarBackgroundStyle } from '../../hooks/useSidebarBackgroundPreference.js';
import type { DesktopUpdaterBridgeState, DesktopUpdaterStateView } from '../../hooks/useDesktopUpdater.js';
import { useThemeTransition, type ThemeMode } from '../../hooks/useThemeTransition.js';
import { markdownLinkOpenModeFromConfig } from '../../utils/markdownLinkPreference.js';
import {
  runtimeAccessModeForConfig,
  runtimeAccessModeOptions,
  runtimeAccessModeSelection as accessModeSelection,
} from '../../utils/runtimeAccessMode.js';
import { RuntimeAccessModeMenu } from '../RuntimeAccessModeMenu.js';
import { BrandIconDialog } from './BrandIconDialog.js';
import { BrandIconMark } from './BrandIconMark.js';
import { ProviderModelReplacementDialog } from './ProviderModelReplacementDialog.js';
import { resolveAutomaticModelBrand, resolveAutomaticProviderBrand, resolveModelBrand, resolveProviderBrand } from './providerBranding.js';
import { providerModelReplacementDecision } from './providerModelReplacement.js';
import { WorkspaceDependenciesSettings } from './WorkspaceDependenciesSettings.js';
import { UsageSettings } from './usage/UsageSettings.js';

type SettingsSectionId = 'general' | 'personalization' | 'localLlm' | 'usage' | 'archives' | 'runtime' | 'about';
type RuntimePreferenceInput = Pick<RuntimeConfigInput, 'globalPrompt' | 'storagePath' | 'memory' | 'memoryEnabled' | 'setsunaStyle' | 'approvalPolicy' | 'permissionProfile' | 'sandboxWorkspaceWrite' | 'bypassHookTrust' | 'features' | 'desktopSettings'>;

const settingsSections: Array<{ id: SettingsSectionId; label: string; icon: ReactNode }> = [
  { id: 'general', label: '通用', icon: <SlidersHorizontal size={14} /> },
  { id: 'personalization', label: '个性化', icon: <Sparkles size={14} /> },
  { id: 'localLlm', label: '模型服务', icon: <HardDrive size={14} /> },
  { id: 'usage', label: '用量统计', icon: <CircleGauge size={14} /> },
  { id: 'archives', label: '归档对话', icon: <Archive size={14} /> },
  { id: 'runtime', label: '高级设置', icon: <Wrench size={14} /> },
  { id: 'about', label: '关于', icon: <Info size={14} /> },
];

const settingsSectionLabels: Record<SettingsSectionId, string> = {
  general: '通用',
  personalization: '个性化',
  localLlm: '模型服务',
  usage: '用量统计',
  archives: '归档对话',
  runtime: '高级设置',
  about: '关于',
};

const PERSONALIZATION_PROMPT_MAX_LENGTH = 8000;
const PERSONALIZATION_PROMPT_SAVE_DELAY_MS = 360;
const EMPTY_PROVIDER_CONFIGS: ProviderConfigState[] = [];
const settingsSectionDescriptions: Partial<Record<SettingsSectionId, string>> = {
  localLlm: '接入并管理用于对话与自动化任务的模型服务。',
  usage: '追踪模型调用、Token 消耗与过去一年的活跃趋势。',
};

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

const accentColorChoiceOptions: Array<SettingsChoiceOption<AccentColor>> = accentColorOptions.map((option) => ({
  value: option.value,
  label: option.label,
  icon: (
    <span
      className="chat-user-settings__accent-swatch"
      style={{
        '--settings-accent-swatch-light': option.lightSwatch,
        '--settings-accent-swatch-dark': option.darkSwatch,
      } as CSSProperties}
    />
  ),
}));

const sidebarBackgroundChoiceOptions: Array<SettingsChoiceOption<SidebarBackgroundStyle>> = sidebarBackgroundOptions.map((option) => ({
  value: option.value,
  label: option.label,
  icon: (
    <span
      className="chat-user-settings__sidebar-background-swatch"
      style={{
        '--settings-sidebar-background-swatch-light': option.lightSwatch,
        '--settings-sidebar-background-swatch-dark': option.darkSwatch,
      } as CSSProperties}
    />
  ),
}));

const setsunaStyleOptions: Array<SettingsChoiceOption<RuntimeConfigState['setsunaStyle']>> = [
  { value: 'developer', label: '开发', icon: <Cpu size={14} /> },
  { value: 'daily', label: '日常', icon: <Sun size={14} /> },
];

type MemorySettingToggleProps = {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
};

export function SettingsPage({
  archivedThreads,
  config,
  projects,
  skillExtraRoots,
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
  onDeleteAllArchivedThreads,
  onDeleteArchivedThread,
  onRestoreArchivedThread,
  onSetSkillExtraRoots,
}: {
  archivedThreads: RuntimeThreadSummary[];
  config: RuntimeConfigState | null;
  projects: WorkspaceProject[];
  skillExtraRoots: string[];
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
  onDeleteAllArchivedThreads: (threadIds: string[]) => Promise<void>;
  onDeleteArchivedThread: (threadId: string) => Promise<void>;
  onRestoreArchivedThread: (threadId: string) => Promise<RuntimeThread>;
  onSetSkillExtraRoots: (roots: string[]) => Promise<void>;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const [localModelSaveState, setLocalModelSaveState] = useState<SaveState>(() => idleSaveState());
  const content =
    activeSection === 'general' ? (
      <GeneralSettings config={config} onSave={onSaveRuntimePreferences} />
    ) : activeSection === 'localLlm' ? (
      config ? (
        <LocalModelSettings config={config} onFetchModels={onFetchProviderModels} onSave={onSaveProviders} onSaveStateChange={setLocalModelSaveState} />
      ) : (
        <EmptyState title="Config unavailable" />
      )
    ) : activeSection === 'usage' ? (
      <UsageSettings providers={config?.providers ?? EMPTY_PROVIDER_CONFIGS} usage={usage} />
    ) : activeSection === 'archives' ? (
      <ArchivedThreadsSettings threads={archivedThreads} onDeleteAll={onDeleteAllArchivedThreads} onDelete={onDeleteArchivedThread} onRestore={onRestoreArchivedThread} />
    ) : activeSection === 'personalization' ? (
      config ? (
        <PersonalizationSettings config={config} projects={projects} memoryPreview={memoryPreview} memoryPreviewLoading={memoryPreviewLoading} onSavePreferences={onSaveRuntimePreferences} onPreview={onPreviewMemories} onDelete={onDeleteMemory} onReset={onResetMemories} />
      ) : (
        <EmptyState title="Config unavailable" />
      )
    ) : activeSection === 'about' ? (
      <AboutSettings updater={updater} />
    ) : config ? (
      <RuntimePolicySettings config={config} skillExtraRoots={skillExtraRoots} onSave={onSaveRuntimePreferences} onSetSkillExtraRoots={onSetSkillExtraRoots} />
    ) : (
      <EmptyState title="Config unavailable" />
    );

  useEffect(() => {
    if (activeSection !== 'localLlm') setLocalModelSaveState(idleSaveState());
  }, [activeSection]);

  return (
    <>
      <SettingsSidebar activeSection={activeSection} onBack={onBack} onSelectSection={setActiveSection} />
      <main className="desktop-settings-panel">
        <section className={`chat-user-settings__content ${activeSection === 'localLlm' ? 'chat-user-settings__content--local-llm' : ''} ${activeSection === 'usage' ? 'chat-user-settings__content--usage' : ''}`}>
          <header className="chat-user-settings__page-heading">
            <div className="chat-user-settings__page-heading-copy">
              <h1>{settingsSectionLabels[activeSection]}</h1>
              {settingsSectionDescriptions[activeSection] ? <p>{settingsSectionDescriptions[activeSection]}</p> : null}
            </div>
            {activeSection === 'localLlm' && localModelSaveState.message ? <AutoSaveStatus state={localModelSaveState} /> : null}
          </header>
          {content}
        </section>
      </main>
    </>
  );
}

export function SettingsSidebar({
  activeSection,
  onBack,
  onSelectSection,
}: {
  activeSection: SettingsSectionId;
  onBack: () => void;
  onSelectSection: (section: SettingsSectionId) => void;
}) {
  return (
    <nav className="app-sidebar desktop-settings-sidebar chat-user-settings__nav">
      <PageBackButton block className="chat-user-settings__page-back" label="返回应用" onClick={onBack} />
      <div className="chat-user-settings__title">设置</div>
      <div className="chat-user-settings__tabs">
        {settingsSections.map((section) => (
          <button key={section.id} className={activeSection === section.id ? 'is-active' : ''} type="button" onClick={() => onSelectSection(section.id)}>
            {section.icon}
            <span>{section.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function ArchivedThreadsSettings({
  threads,
  onDelete,
  onDeleteAll,
  onRestore,
}: {
  threads: RuntimeThreadSummary[];
  onDelete: (threadId: string) => Promise<void>;
  onDeleteAll: (threadIds: string[]) => Promise<void>;
  onRestore: (threadId: string) => Promise<RuntimeThread>;
}) {
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (threadId: string, action: () => Promise<unknown>) => {
    setBusyThreadId(threadId);
    setError(null);
    try {
      await action();
    } catch (unknownError) {
      setError(errorMessage(unknownError, '归档操作失败。'));
    } finally {
      setBusyThreadId(null);
    }
  };

  const deleteAll = async () => {
    setDeletingAll(true);
    setError(null);
    try {
      await onDeleteAll(threads.map((thread) => thread.id));
    } catch (unknownError) {
      setError(errorMessage(unknownError, '归档对话全部删除失败。'));
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked settings-archives-section">
      <div className="chat-user-settings__section-block">
        <div className="settings-archives-header">
          <div className="chat-user-settings__group-title">已归档的对话</div>
          {threads.length ? (
            <Popconfirm
              title={`永久删除全部 ${threads.length} 个归档对话？`}
              description="此操作不可撤销。"
              placement="bottomRight"
              okText="全部删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={deleteAll}
            >
              <Button icon={<Trash2 size={14} />} variant="danger" disabled={deletingAll || busyThreadId !== null}>全部删除</Button>
            </Popconfirm>
          ) : null}
        </div>
        <div className="settings-archives-list">
          {threads.length ? threads.map((thread) => {
            const busy = deletingAll || busyThreadId === thread.id;
            return (
              <div className="settings-archives-row" key={thread.id}>
                <span className="settings-archives-row__icon"><Archive size={15} /></span>
                <span className="settings-archives-row__copy">
                  <strong title={thread.title}>{thread.title || '未命名对话'}</strong>
                  <small>{thread.messageCount} 条消息 · 更新于 {formatMemoryDate(thread.updatedAt)}</small>
                </span>
                <Button icon={<Undo2 size={14} />} disabled={busy} onClick={() => void runAction(thread.id, () => onRestore(thread.id))}>恢复</Button>
                <Popconfirm title={`永久删除“${thread.title || '未命名对话'}”？`} description="此操作不可撤销。" placement="topRight" okText="永久删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => runAction(thread.id, () => onDelete(thread.id))}>
                  <IconButton label={`永久删除 ${thread.title || '未命名对话'}`} variant="danger" disabled={busy}><Trash2 size={14} /></IconButton>
                </Popconfirm>
              </div>
            );
          }) : <EmptyState title="暂无归档对话" />}
        </div>
        {error ? <div className="settings-archives-error" role="alert">{error}</div> : null}
      </div>
    </div>
  );
}

function SettingsChoiceGroup<TValue extends string>({ ariaLabel, options, value, onChange }: { ariaLabel: string; options: Array<SettingsChoiceOption<TValue>>; value: TValue; onChange: (value: TValue, event: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <div className="chat-user-settings__option-group" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button key={option.value} className={`chat-user-settings__option-button ${selected ? 'is-active' : ''}`} type="button" role="radio" aria-checked={selected} onClick={(event) => onChange(option.value, event)}>
            <span className="chat-user-settings__option-icon">{option.icon}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function MemorySettingToggle({ checked, description, label, onChange }: MemorySettingToggleProps) {
  return (
    <div className="chat-user-settings__row chat-user-settings__local-enable-row chat-user-settings__memory-toggle-row">
      <span className="chat-user-settings__row-label chat-user-settings__memory-toggle-label">
        <span className="chat-user-settings__memory-toggle-copy">
          <span>{label}</span>
          <small>{description}</small>
        </span>
      </span>
      <label className="sd-check" title={label}>
        <input aria-label={label} type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      </label>
    </div>
  );
}

function GeneralSettings({
  config,
  onSave,
}: {
  config: RuntimeConfigState | null;
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
}) {
  const { fontFamily, fontSize, fontWeight, setFontFamily, setFontSize, setFontWeight } = useAppearancePreferences();
  const { codeColorScheme, codeFontFamily, codeHighlightTheme, setCodeColorScheme, setCodeFontFamily, setCodeHighlightTheme } = useCodeAppearancePreferences();
  const { sidebarBackgroundStyle, setSidebarBackgroundStyle } = useSidebarBackgroundPreference();
  const { mode, setThemeModeWithTransition } = useThemeTransition();
  const { accentColor, setAccentColor } = useAccentColorPreference();
  const availableFontFamilyOptions = getFontFamilyOptionsForPlatform();
  const availableCodeFontFamilyOptions = getCodeFontFamilyOptionsForPlatform();
  const selectedFont = availableFontFamilyOptions.find((item) => item.value === fontFamily) ?? fontFamilyOptions.find((item) => item.value === fontFamily) ?? availableFontFamilyOptions[0] ?? fontFamilyOptions[0];
  const selectedCodeFont = availableCodeFontFamilyOptions.find((item) => item.value === codeFontFamily) ?? codeFontFamilyOptions.find((item) => item.value === codeFontFamily) ?? availableCodeFontFamilyOptions[0] ?? codeFontFamilyOptions[0];
  const selectedCodeHighlightTheme = codeHighlightThemeOptions.find((item) => item.value === codeHighlightTheme) ?? codeHighlightThemeOptions[0];
  const selectedCodeColorScheme = codeColorSchemeOptions.find((item) => item.value === codeColorScheme) ?? codeColorSchemeOptions[0];
  const fontFamilySelectOptions = availableFontFamilyOptions.some((item) => item.value === selectedFont.value) ? availableFontFamilyOptions : [selectedFont, ...availableFontFamilyOptions];
  const codeFontFamilySelectOptions = availableCodeFontFamilyOptions.some((item) => item.value === selectedCodeFont.value) ? availableCodeFontFamilyOptions : [selectedCodeFont, ...availableCodeFontFamilyOptions];
  const fontSizeIndex = Math.max(0, fontSizeOptions.indexOf(fontSize));
  const scaleMarkMaxIndex = Math.max(fontSizeOptions.length - 1, 1);
  const fontSizeProgress = `${(fontSizeIndex / scaleMarkMaxIndex) * 100}%`;
  const markdownLinkOpenMode = markdownLinkOpenModeFromConfig(config);
  const setMarkdownLinkOpenMode = (nextValue: string) => {
    if (!config || (nextValue !== 'in-app' && nextValue !== 'external')) return;
    void onSave({
      desktopSettings: {
        ...(config.desktopSettings ?? {}),
        markdownLinkOpenMode: nextValue,
      },
    });
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
            <SelectField className="settings-local-control" value={selectedFont.value} style={{ fontFamily: selectedFont.css }} onValueChange={(nextValue) => setFontFamily(nextValue as FontFamilyMode)}>
              {fontFamilySelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Bold size={14} />
              <span>界面字重</span>
            </span>
            <SelectField aria-label="界面字重" className="settings-local-control" value={fontWeight} onValueChange={(nextValue) => setFontWeight(nextValue as FontWeightMode)}>
              {fontWeightOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <div className="chat-user-settings__font-preview" style={{ fontFamily: selectedFont.css, fontWeight }}>
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
        <div className="chat-user-settings__group-title">代码</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Code2 size={14} />
              <span>代码字体</span>
            </span>
            <SelectField aria-label="代码字体" className="settings-local-control" value={selectedCodeFont.value} style={{ fontFamily: selectedCodeFont.css }} onValueChange={(nextValue) => setCodeFontFamily(nextValue as CodeFontFamilyMode)}>
              {codeFontFamilySelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Paintbrush size={14} />
              <span>高亮主题</span>
            </span>
            <SelectField aria-label="代码高亮主题" className="settings-local-control" value={codeHighlightTheme} onValueChange={(nextValue) => setCodeHighlightTheme(nextValue as CodeHighlightTheme)}>
              {codeHighlightThemeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Palette size={14} />
              <span>配色方案</span>
            </span>
            <SelectField aria-label="代码配色方案" className="settings-local-control" value={codeColorScheme} onValueChange={(nextValue) => setCodeColorScheme(nextValue as CodeColorScheme)}>
              {codeColorSchemeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <CodeAppearancePreview
            colorSchemeLabel={selectedCodeColorScheme.label}
            fontFamily={selectedCodeFont.css}
            fontLabel={selectedCodeFont.label}
            themeLabel={selectedCodeHighlightTheme.label}
          />
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
              <div className="settings-scale-control__range">
                <input id="settings-page-scale" aria-label="页面缩放" type="range" min={0} max={fontSizeOptions.length - 1} step={1} value={fontSizeIndex} onChange={(event) => setFontSize(fontSizeOptions[Number(event.currentTarget.value)] ?? '100')} />
                <div className="settings-scale-control__marks" aria-hidden="true">
                  {fontSizeOptions.map((option, index) => Number(option) % 10 === 0 ? (
                    <span
                      key={option}
                      className={`${index === 0 ? 'is-first' : ''} ${index === fontSizeOptions.length - 1 ? 'is-last' : ''} ${option === fontSize ? 'is-current' : ''}`}
                      style={{ '--settings-scale-mark-left': `${(index / scaleMarkMaxIndex) * 100}%` } as CSSProperties}
                    >
                      {option}%
                    </span>
                  ) : null)}
                </div>
              </div>
              <output htmlFor="settings-page-scale">{fontSize}%</output>
            </div>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <PanelLeft size={14} />
              <span>侧栏背景</span>
            </span>
            <SettingsChoiceGroup
              ariaLabel="侧栏背景"
              options={sidebarBackgroundChoiceOptions}
              value={sidebarBackgroundStyle}
              onChange={setSidebarBackgroundStyle}
            />
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Sun size={14} />
              <span>外观模式</span>
            </span>
            <SettingsChoiceGroup ariaLabel="外观模式" options={themeModeOptions} value={mode} onChange={setThemeModeWithTransition} />
          </div>
          <div className="chat-user-settings__row chat-user-settings__accent-row">
            <span className="chat-user-settings__row-label">
              <Palette size={14} />
              <span>强调色</span>
            </span>
            <SettingsChoiceGroup ariaLabel="强调色" options={accentColorChoiceOptions} value={accentColor} onChange={setAccentColor} />
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">链接</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Globe2 size={14} />
              <span>Markdown Web 链接</span>
            </span>
            <SelectField
              aria-label="Markdown Web 链接打开方式"
              className="settings-local-control"
              disabled={!config}
              value={markdownLinkOpenMode}
              onValueChange={setMarkdownLinkOpenMode}
            >
              <option value="in-app">内置浏览器</option>
              <option value="external">系统浏览器</option>
            </SelectField>
          </label>
        </div>
      </div>
    </div>
  );
}

function CodeAppearancePreview({ colorSchemeLabel, fontFamily, fontLabel, themeLabel }: { colorSchemeLabel: string; fontFamily: string; fontLabel: string; themeLabel: string }) {
  return (
    <div className="chat-user-settings__code-preview" aria-label="代码样式预览">
      <div className="chat-user-settings__code-preview-header">
        <span><Code2 size={12} /> TypeScript</span>
        <span>{`${fontLabel} · ${themeLabel} · ${colorSchemeLabel}`}</span>
      </div>
      <code className="chat-user-settings__code-preview-body" style={{ fontFamily }}>
        <CodePreviewLine number={1}>
          <span className="is-keyword">import</span>
          <span className="is-meta"> {'{'} </span>
          <span className="is-function">useMemo</span>
          <span className="is-meta"> {'}'} </span>
          <span className="is-keyword">from</span>
          <span> </span>
          <span className="is-string">'react'</span>
          <span className="is-meta">;</span>
        </CodePreviewLine>
        <CodePreviewLine number={2}>
          <span className="is-comment">// 实时预览代码字体、高亮主题与配色方案</span>
        </CodePreviewLine>
        <CodePreviewLine number={3}>
          <span className="is-keyword">const</span>
          <span className="is-variable"> total </span>
          <span className="is-meta">=</span>
          <span className="is-variable"> items.</span>
          <span className="is-function">reduce</span>
          <span className="is-meta">((</span>
          <span className="is-variable">sum, item</span>
          <span className="is-meta">) =&gt;</span>
          <span className="is-variable"> sum </span>
          <span className="is-meta">+</span>
          <span className="is-variable"> item.</span>
          <span className="is-attribute">price</span>
          <span className="is-meta">, </span>
          <span className="is-number">0</span>
          <span className="is-meta">);</span>
        </CodePreviewLine>
        <CodePreviewLine number={4}>
          <span className="is-keyword">return</span>
          <span> </span>
          <span className="is-function">formatCurrency</span>
          <span className="is-meta">(</span>
          <span className="is-variable">total</span>
          <span className="is-meta">);</span>
        </CodePreviewLine>
      </code>
    </div>
  );
}

function CodePreviewLine({ children, number }: { children: ReactNode; number: number }) {
  return (
    <span className="chat-user-settings__code-preview-line">
      <span aria-hidden="true">{number}</span>
      <span>{children}</span>
    </span>
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
                <button className="chat-user-settings__release-link" type="button" title={releaseUrl} onClick={() => void window.setsunaDesktop?.links.openExternal(releaseUrl)}>
                  更新内容：<span>{releaseUrl}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="chat-user-settings__update-actions">
            {showCheckButton ? (
              <Button className="chat-user-settings__update-action" icon={<RefreshCw size={14} />} disabled={updateBusy || updateUnsupported} onClick={() => void updater.checkForUpdates()}>
                {updateBusy ? '检查中' : '检查更新'}
              </Button>
            ) : null}
            {updater.ready ? (
              <Button className="chat-user-settings__update-action chat-user-settings__update-action--primary" variant="primary" disabled={updater.installing} onClick={() => void updater.installReadyUpdate()}>
                {updater.installButtonText}
              </Button>
            ) : null}
          </div>
        </div>
        <UpdateDownloadSourceSettings updater={updater} />
      </div>
    </div>
  );
}

function UpdateDownloadSourceSettings({ updater }: { updater: DesktopUpdaterStateView }) {
  const [adding, setAdding] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const sources = updater.state?.downloadSources ?? [];
  const activeSourceId = updater.state?.activeDownloadSourceId ?? sources[0]?.id ?? '';
  const activeSource = sources.find((source) => source.id === activeSourceId) ?? sources[0] ?? null;

  const runSourceAction = async (action: () => Promise<unknown>) => {
    setSourceBusy(true);
    setSourceError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setSourceError(formatUpdaterError(error));
      return false;
    } finally {
      setSourceBusy(false);
    }
  };

  const addSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await runSourceAction(() => updater.addDownloadSource({ name: sourceName, urlTemplate: sourceUrl }));
    if (!saved) return;
    setSourceName('');
    setSourceUrl('');
    setAdding(false);
  };

  const selectSource = async (sourceId: string) => {
    if (!sourceId || sourceId === activeSourceId) return;
    await runSourceAction(() => updater.selectDownloadSource(sourceId));
  };

  const removeActiveSource = async () => {
    if (!activeSource || activeSource.builtIn) return;
    await runSourceAction(() => updater.removeDownloadSource(activeSource.id));
  };

  return (
    <div className="chat-user-settings__group chat-user-settings__download-source-panel">
      <div className="chat-user-settings__download-source-main">
        <div className="chat-user-settings__download-source-copy">
          <strong>下载源</strong>
          <span>版本检查仍使用 GitHub API，安装包和校验文件从所选源下载。</span>
        </div>
        <div className="chat-user-settings__download-source-actions">
          <SelectField aria-label="下载源" className="settings-local-control" disabled={sourceBusy || sources.length === 0} value={activeSourceId} onValueChange={(nextValue) => void selectSource(nextValue)}>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>{source.name}</option>
            ))}
          </SelectField>
          <Button icon={<Plus size={14} />} disabled={sourceBusy || !updater.api} onClick={() => {
            setAdding((current) => !current);
            setSourceError(null);
          }}>
            添加源
          </Button>
          {activeSource && !activeSource.builtIn ? (
            <Popconfirm title={`删除“${activeSource.name}”？`} description="删除当前源后会自动切回 GitHub 直连。" placement="topRight" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void removeActiveSource()}>
              <IconButton label={`删除下载源 ${activeSource.name}`} variant="danger" disabled={sourceBusy}>
                <Trash2 size={14} />
              </IconButton>
            </Popconfirm>
          ) : null}
        </div>
      </div>

      {activeSource ? (
        <div className="chat-user-settings__download-source-current" title={activeSource.urlTemplate}>
          当前规则：<code>{activeSource.urlTemplate === '{url}' ? 'GitHub 原始下载地址' : activeSource.urlTemplate}</code>
        </div>
      ) : null}

      {adding ? (
        <form className="chat-user-settings__download-source-form" onSubmit={(event) => void addSource(event)}>
          <TextField aria-label="下载源名称" disabled={sourceBusy} maxLength={40} placeholder="名称，例如：公司镜像" value={sourceName} onChange={(event) => setSourceName(event.currentTarget.value)} />
          <TextField aria-label="下载源地址" disabled={sourceBusy} placeholder="地址或模板，例如：https://ghfast.example/" value={sourceUrl} onChange={(event) => setSourceUrl(event.currentTarget.value)} />
          <div className="chat-user-settings__download-source-form-actions">
            <Button type="submit" variant="primary" disabled={sourceBusy || !sourceName.trim() || !sourceUrl.trim()}>添加并使用</Button>
            <Button disabled={sourceBusy} onClick={() => setAdding(false)}>取消</Button>
          </div>
          <span className="chat-user-settings__download-source-help">只填地址时会自动追加原始下载 URL；高级用法可在模板中使用 {'{url}'} 或 {'{encodedUrl}'}。</span>
        </form>
      ) : null}

      {sourceError ? <div className="chat-user-settings__download-source-error" role="alert">{sourceError}</div> : null}
    </div>
  );
}

function formatUpdaterError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message.replace(/^Error invoking remote method '[^']+':\s*/u, '');
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
  skillExtraRoots,
  onSave,
  onSetSkillExtraRoots,
}: {
  config: RuntimeConfigState;
  skillExtraRoots: string[];
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
  onSetSkillExtraRoots: (roots: string[]) => Promise<void>;
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
  const accessMode = runtimeAccessModeForConfig(config);
  const accessModeOption = runtimeAccessModeOptions.find((option) => option.value === accessMode) ?? runtimeAccessModeOptions[1];
  const persistWorkspaceDependencySettings = (
    settings: Partial<Pick<RuntimeDesktopSettings, 'pythonPackageIndexUrl' | 'workspaceDependenciesEnabled'>>,
  ) => onSave({
    desktopSettings: {
      ...(config.desktopSettings ?? {}),
      ...settings,
    },
  });

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__runtime-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">权限</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <label className="chat-user-settings__row chat-user-settings__runtime-policy-row">
            <span className="chat-user-settings__runtime-policy-copy">
              <ShieldCheck size={14} />
              <span>
                <strong>权限策略</strong>
                <small>{accessModeOption.description}</small>
              </span>
            </span>
            <RuntimeAccessModeMenu
              mode={accessMode}
              variant="settings"
              onChange={(mode) => void onSave(accessModeSelection(mode))}
            />
          </label>
        </div>
      </div>

      <WorkspaceDependenciesSettings
        packageIndexUrl={typeof config.desktopSettings?.pythonPackageIndexUrl === 'string' ? config.desktopSettings.pythonPackageIndexUrl : ''}
        onEnabledPersist={(enabled) => persistWorkspaceDependencySettings({ workspaceDependenciesEnabled: enabled })}
        onPackageIndexUrlPersist={(pythonPackageIndexUrl) => persistWorkspaceDependencySettings({ pythonPackageIndexUrl })}
      />

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">本地存储</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <FileCog size={14} />
              <span>配置文件</span>
            </span>
            <div className="chat-user-settings__path-control">
              <code title={config.configPath}>{config.configPath}</code>
              <Button className="chat-user-settings__path-open" icon={<FolderOpen size={14} />} disabled={pathActionDisabled} onClick={() => void openRuntimePath(config.configPath, '配置文件')}>
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
              <Button className="chat-user-settings__path-open" icon={<FolderOpen size={14} />} disabled={pathActionDisabled} onClick={() => void openRuntimePath(config.dataPath, '数据目录')}>
                {isOpeningData ? '打开中' : '打开'}
              </Button>
            </div>
          </div>
        </div>
        {localPathError ? <div className="chat-user-settings__runtime-error">{localPathError}</div> : null}
      </div>

      <RuntimeAdvancedSettings
        config={config}
        skillExtraRoots={skillExtraRoots}
        onSave={onSave}
        onSetSkillExtraRoots={onSetSkillExtraRoots}
      />
    </div>
  );
}

function RuntimeAdvancedSettings({
  config,
  skillExtraRoots,
  onSave,
  onSetSkillExtraRoots,
}: {
  config: RuntimeConfigState;
  skillExtraRoots: string[];
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
  onSetSkillExtraRoots: (roots: string[]) => Promise<void>;
}) {
  const [featureFlagsDraft, setFeatureFlagsDraft] = useState(() => JSON.stringify(config.features ?? {}, null, 2));
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  useEffect(() => {
    setFeatureFlagsDraft(JSON.stringify(config.features ?? {}, null, 2));
  }, [config.features]);

  return (
    <details className="chat-user-settings__section-block chat-user-settings__advanced-disclosure">
      <summary className="chat-user-settings__advanced-summary">
        <span className="chat-user-settings__advanced-icon" aria-hidden="true">
          <ShieldCheck size={16} />
        </span>
        <span className="chat-user-settings__advanced-copy">
          <strong>高级安全与实验功能</strong>
          <small>沙箱目录、Hook 信任、额外 Skill 与实验开关</small>
        </span>
        <span className="chat-user-settings__advanced-toggle" aria-hidden="true">
          <ChevronRight className="chat-user-settings__advanced-chevron" size={15} />
        </span>
      </summary>
      <div className="chat-user-settings__group chat-user-settings__runtime-card chat-user-settings__runtime-advanced">
        <MemorySettingToggle
          checked={config.sandboxWorkspaceWrite?.networkAccess === true}
          description="允许 workspace-write 沙箱中的工具访问网络。"
          label="沙箱网络访问"
          onChange={(networkAccess) => void onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), networkAccess } })}
        />
        <MemorySettingToggle
          checked={config.bypassHookTrust === true}
          description="跳过本地 Hook hash 信任检查，仅应在受控环境中开启。"
          label="绕过 Hook 信任"
          onChange={(bypassHookTrust) => void onSave({ bypassHookTrust })}
        />
        <RuntimeDirectoryListField
          description="允许 workspace-write 沙箱额外读取这些目录。"
          label="额外可读目录"
          value={config.sandboxWorkspaceWrite?.readableRoots ?? []}
          onSave={(readableRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), readableRoots } })}
        />
        <RuntimeDirectoryListField
          description="允许 workspace-write 沙箱额外写入这些目录。"
          label="额外可写目录"
          value={config.sandboxWorkspaceWrite?.writableRoots ?? []}
          onSave={(writableRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), writableRoots } })}
        />
        <RuntimeDirectoryListField
          description="无论其他权限如何，都禁止访问这些目录。"
          label="拒绝访问目录"
          value={config.sandboxWorkspaceWrite?.deniedRoots ?? []}
          onSave={(deniedRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), deniedRoots } })}
        />
        <RuntimeTextListField
          description="逐条添加需要拒绝的 Glob 表达式。"
          label="拒绝 Glob"
          value={config.sandboxWorkspaceWrite?.deniedGlobPatterns ?? []}
          onSave={(deniedGlobPatterns) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), deniedGlobPatterns } })}
        />
        <RuntimeDirectoryListField
          description="从默认位置之外加载 Skill；仅当前 runtime 会话有效。"
          label="额外 Skill 目录"
          value={skillExtraRoots}
          onSave={onSetSkillExtraRoots}
        />
        <div className="chat-user-settings__runtime-json-field">
          <span>Feature flags（JSON）</span>
          <TextArea rows={6} value={featureFlagsDraft} onChange={(event) => setFeatureFlagsDraft(event.currentTarget.value)} />
          <Button onClick={() => {
            try {
              const parsed = JSON.parse(featureFlagsDraft) as unknown;
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Feature flags 必须是 JSON 对象。');
              const flags = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
              setAdvancedError(null);
              void onSave({ features: flags });
            } catch (unknownError) {
              setAdvancedError(errorMessage(unknownError, 'Feature flags 格式无效。'));
            }
          }}>保存 Feature flags</Button>
        </div>
        <div className="chat-user-settings__runtime-memory-tuning">
          <strong>记忆整理参数</strong>
          <TextField
            defaultValue={config.memory.consolidationModel ?? ''}
            placeholder="整理模型（留空跟随当前模型）"
            onBlur={(event) => void onSave({ memory: { consolidationModel: event.currentTarget.value.trim() || undefined } })}
          />
          <TextField
            type="number"
            min="1"
            defaultValue={config.memory.maxRolloutsPerStartup ?? ''}
            placeholder="每次启动最多处理 Rollouts"
            onBlur={(event) => void onSave({ memory: { maxRolloutsPerStartup: optionalPositiveNumber(event.currentTarget.value) } })}
          />
          <TextField
            type="number"
            min="1"
            defaultValue={config.memory.maxRawMemoriesForConsolidation ?? ''}
            placeholder="整理前最大原始记忆数"
            onBlur={(event) => void onSave({ memory: { maxRawMemoriesForConsolidation: optionalPositiveNumber(event.currentTarget.value) } })}
          />
        </div>
      </div>
      {advancedError ? <div className="chat-user-settings__runtime-error">{advancedError}</div> : null}
    </details>
  );
}

function RuntimeDirectoryListField({
  description,
  label,
  value,
  onSave,
}: {
  description: string;
  label: string;
  value: string[];
  onSave: (items: string[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (items: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(items);
      return true;
    } catch (unknownError) {
      setError(errorMessage(unknownError, `${label}保存失败。`));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addDirectory = async () => {
    const api = window.setsunaDesktop?.desktop;
    if (!api?.selectDirectory) {
      setError('当前环境不支持选择目录。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const selected = await api.selectDirectory({ title: `选择${label}` });
      if (selected && !value.includes(selected)) await onSave([...value, selected]);
    } catch (unknownError) {
      setError(errorMessage(unknownError, `${label}添加失败。`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RuntimeListEditor
      action={<Button icon={<FolderOpen size={14} />} disabled={busy} onClick={() => void addDirectory()}>{busy ? '处理中' : '添加目录'}</Button>}
      busy={busy}
      description={description}
      error={error}
      items={value}
      label={label}
      onRemove={(item) => void commit(value.filter((current) => current !== item))}
    />
  );
}

function RuntimeTextListField({
  description,
  label,
  value,
  onSave,
}: {
  description: string;
  label: string;
  value: string[];
  onSave: (items: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (items: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(items);
      return true;
    } catch (unknownError) {
      setError(errorMessage(unknownError, `${label}保存失败。`));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const item = draft.trim();
    if (!item || value.includes(item)) return;
    if (await commit([...value, item])) setDraft('');
  };

  return (
    <RuntimeListEditor
      action={(
        <form className="chat-user-settings__runtime-list-add" onSubmit={(event) => void addItem(event)}>
          <TextField aria-label={`添加${label}`} disabled={busy} placeholder="输入一条规则" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
          <Button icon={<Plus size={14} />} disabled={busy || !draft.trim()} type="submit">添加</Button>
        </form>
      )}
      busy={busy}
      description={description}
      error={error}
      items={value}
      label={label}
      onRemove={(item) => void commit(value.filter((current) => current !== item))}
    />
  );
}

function RuntimeListEditor({
  action,
  busy,
  description,
  error,
  items,
  label,
  onRemove,
}: {
  action: ReactNode;
  busy: boolean;
  description: string;
  error: string | null;
  items: string[];
  label: string;
  onRemove: (item: string) => void;
}) {
  return (
    <div className="chat-user-settings__runtime-list-editor">
      <div className="chat-user-settings__runtime-list-head">
        <span className="chat-user-settings__runtime-list-copy">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
        {action}
      </div>
      {items.length ? (
        <div className="chat-user-settings__runtime-list-items">
          {items.map((item) => (
            <div className="chat-user-settings__runtime-list-item" key={item}>
              <code title={item}>{item}</code>
              <IconButton label={`移除 ${item}`} disabled={busy} onClick={() => onRemove(item)}><X size={14} /></IconButton>
            </div>
          ))}
        </div>
      ) : (
        <span className="chat-user-settings__runtime-list-empty">暂未添加</span>
      )}
      {error ? <span className="chat-user-settings__runtime-list-error" role="alert">{error}</span> : null}
    </div>
  );
}

function optionalPositiveNumber(value: string): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function PersonalizationSettings({
  config,
  projects,
  memoryPreview,
  memoryPreviewLoading,
  onSavePreferences,
  onPreview,
  onDelete,
  onReset,
}: {
  config: RuntimeConfigState;
  projects: WorkspaceProject[];
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
            <Button className="chat-user-settings__tiny-action" icon={<RefreshCw size={14} />} disabled={memoryPreviewLoading || memoryResetting || Boolean(memoryDeletingId)} onClick={() => void loadMemoryPreview()}>
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
              const meta = [item.origin === 'active' ? '主动沉淀' : '后台沉淀', memoryScopeLabel(item, projects), item.source, formatMemoryDate(item.updatedAt), `${Number(item.chars || 0).toLocaleString()} 字符`].filter(Boolean);

              return (
                <div className="chat-user-settings__memory-item" key={item.id}>
                  <div className="chat-user-settings__memory-item-head">
                    <FileText size={14} />
                    <span title={item.workspaceRoot || item.title}>{item.title}</span>
                    <IconButton label="删除记忆" variant="danger" disabled={memoryResetting || memoryPreviewLoading || memoryDeletingId === item.id} onClick={() => void deleteMemoryItem(item)}>
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
                      {item.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
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
            <SettingsChoiceGroup ariaLabel="Setsuna 风格" options={setsunaStyleOptions} value={config.setsunaStyle} onChange={(setsunaStyle) => void onSavePreferences({ setsunaStyle })} />
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
                <span className="chat-user-settings__prompt-count">
                  {globalPromptLength} / {PERSONALIZATION_PROMPT_MAX_LENGTH}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block chat-user-settings__memory-settings-block">
        <div className="chat-user-settings__memory-heading">
          <div className="chat-user-settings__group-title">记忆</div>
          <p>记忆用于保存你希望长期生效的偏好、项目规则、固定流程和事实信息。开启后，后续对话会按当前项目或全局范围自动召回相关记忆，帮助模型延续你的工作习惯；自定义位置会在所选目录内使用 .setsuna-memory 专属子目录，不会改动同级文件。</p>
        </div>
        {memoryError ? <div className="chat-user-settings__memory-error">{memoryError}</div> : null}
        <div className="chat-user-settings__group chat-user-settings__personalization-card">
          <MemorySettingToggle checked={config.memory.useMemories} description="允许对话开始时读取本地记忆，并把相关偏好、项目规则和历史经验放进模型上下文。" label="使用记忆" onChange={(checked) => void onSavePreferences({ memory: { useMemories: checked } })} />
          <MemorySettingToggle checked={config.memory.generateMemories} description="允许运行时在对话结束后提炼新的长期记忆；关闭后只会读取已有记忆，不再自动新增。" label="生成记忆" onChange={(checked) => void onSavePreferences({ memory: { generateMemories: checked } })} />
          <MemoryExtractModelField config={config} onSavePreferences={onSavePreferences} />
          <MemorySettingToggle checked={config.memory.disableOnExternalContext} description="当本轮内容包含网页、MCP、外部工具等临时资料时，禁止把这类上下文沉淀成长期记忆。" label="外部上下文禁写" onChange={(checked) => void onSavePreferences({ memory: { disableOnExternalContext: checked } })} />
          <MemorySettingToggle checked={config.memory.dedicatedTools} description="把读取、搜索和写入记忆的专用工具暴露给模型；适合需要模型主动管理记忆时开启。" label="专用记忆工具" onChange={(checked) => void onSavePreferences({ memory: { dedicatedTools: checked } })} />
          <div className="chat-user-settings__row chat-user-settings__local-field">
            <span className="chat-user-settings__row-label">
              <FolderOpen size={14} />
              <span>存储容器</span>
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
            <Popconfirm title="重置全部记忆？" description="只会清空 Setsuna 管理的记忆子目录，不影响所选目录内其他文件；该操作无法撤销。" placement="topRight" okText="重置" cancelText="取消" okButtonProps={{ danger: true, loading: memoryResetting }} onConfirm={() => void resetMemoryItems()}>
              <Button variant="danger" icon={<RefreshCw size={14} />} disabled={memoryPreviewLoading || Boolean(memoryDeletingId) || memoryResetting}>
                {memoryResetting ? '重置中' : '重置'}
              </Button>
            </Popconfirm>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryExtractModelField({ config, onSavePreferences }: { config: RuntimeConfigState; onSavePreferences: (input: RuntimePreferenceInput) => Promise<void> }) {
  if (!config.memory.generateMemories) return null;

  const options = memoryExtractModelOptions(config);
  const value = config.memory.extractModel?.trim() ?? '';
  const currentOptionExists = !value || options.some((option) => option.value === value);

  return (
    <label className="chat-user-settings__row chat-user-settings__memory-model-row">
      <span className="chat-user-settings__row-label chat-user-settings__memory-model-label">
        <span className="chat-user-settings__memory-toggle-copy">
          <span>提取模型</span>
          <small>用于对话后的记忆提炼，不影响当前回答；留空跟随当前模型。</small>
        </span>
      </span>
      <SelectField
        className="settings-local-control chat-user-settings__memory-model-select"
        value={value}
        onValueChange={(nextValue) => {
          const extractModel = nextValue.trim() || undefined;
          void onSavePreferences({ memory: { extractModel } });
        }}
      >
        <option value="">跟随当前对话模型</option>
        {!currentOptionExists ? (
          <option value={value} disabled>
            {`${value}（当前厂商未配置）`}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>
    </label>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function memoryScopeLabel(item: RuntimeMemoryPreviewItem, projects: WorkspaceProject[]): string {
  if (item.scope === 'global') return '全局';
  const projectName = projects.find((project) => project.id === item.projectId)?.name;
  return projectName ? `项目：${projectName}` : item.projectId ? `项目：${item.projectId}` : '项目范围';
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

function LocalModelSettings({
  config,
  onFetchModels,
  onSave,
  onSaveStateChange,
}: {
  config: RuntimeConfigState;
  onFetchModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSave: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
  onSaveStateChange: (state: SaveState) => void;
}) {
  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__local-llm-section">
      <ProviderSettings config={config} onFetchModels={onFetchModels} onSave={onSave} onSaveStateChange={onSaveStateChange} />
    </div>
  );
}

function ProviderSettings({
  config,
  onFetchModels,
  onSave,
  onSaveStateChange,
}: {
  config: RuntimeConfigState;
  onFetchModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSave: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
  onSaveStateChange: (state: SaveState) => void;
}) {
  const [providers, setProviders] = useState<ProviderConfigState[]>(() => normalizeSettingsProviders(config.providers));
  const [selectedProviderId, setSelectedProviderId] = useState(() => selectedProviderIdFromConfig(config));
  const [editingModel, setEditingModel] = useState<EditingModelState | null>(null);
  const [editingModelIcon, setEditingModelIcon] = useState<ModelIconTarget | null>(null);
  const [editingProviderIconId, setEditingProviderIconId] = useState<string | null>(null);
  const [pendingModelReplacement, setPendingModelReplacement] = useState<PendingModelReplacement | null>(null);
  const [apiKeysByProviderId, setApiKeysByProviderId] = useState<Record<string, string>>({});
  const [fetchStateByProviderId, setFetchStateByProviderId] = useState<Record<string, ModelFetchState>>({});
  const [saveState, setSaveState] = useState<SaveState>(() => idleSaveState());
  const [dirtyRevision, setDirtyRevision] = useState(0);
  const providersRef = useRef(providers);
  const apiKeysByProviderIdRef = useRef(apiKeysByProviderId);
  const latestDirtyRevisionRef = useRef(dirtyRevision);
  const saveRequestIdRef = useRef(0);
  const lastStartedRevisionRef = useRef(0);
  const pendingSaveTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const onSaveRef = useRef(onSave);
  providersRef.current = providers;
  apiKeysByProviderIdRef.current = apiKeysByProviderId;
  latestDirtyRevisionRef.current = dirtyRevision;
  onSaveRef.current = onSave;

  useEffect(() => {
    const nextProviders = normalizeSettingsProviders(config.providers);
    setProviders(nextProviders);
    setSelectedProviderId((current) => (nextProviders.some((provider) => provider.id === current) ? current : selectedProviderIdFromProviders(config.activeProviderId, nextProviders)));
    setApiKeysByProviderId((current) => {
      const providerIds = new Set(nextProviders.map((provider) => provider.id));
      return Object.fromEntries(Object.entries(current).filter(([providerId]) => providerIds.has(providerId)));
    });
    setEditingModel((current) => {
      if (!current) return null;
      const providerExists = nextProviders.some((provider) => provider.id === current.providerId);
      if (!providerExists) return null;
      if (current.mode === 'create') return current;
      return hasProviderModel(nextProviders, current.providerId, current.modelId) ? current : null;
    });
    setEditingProviderIconId((current) => (current && nextProviders.some((provider) => provider.id === current) ? current : null));
    setEditingModelIcon((current) => (
      current && hasProviderModel(nextProviders, current.providerId, current.modelId) ? current : null
    ));
    setPendingModelReplacement((current) => (current && nextProviders.some((provider) => provider.id === current.providerId) ? current : null));
    setFetchStateByProviderId({});
  }, [config.activeProviderId, config.providers]);

  useEffect(() => {
    onSaveStateChange(saveState);
  }, [onSaveStateChange, saveState]);

  const saveRevision = useCallback((revision: number) => {
    lastStartedRevisionRef.current = Math.max(lastStartedRevisionRef.current, revision);
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    if (mountedRef.current) setSaveState({ status: 'saving', message: '生效中' });
    return onSaveRef.current(providersRef.current.map(prepareProviderForSave), apiKeysByProviderIdRef.current)
      .then(() => {
        if (mountedRef.current && saveRequestIdRef.current === requestId && latestDirtyRevisionRef.current === revision) {
          setSaveState({ status: 'saved', message: '已生效' });
        }
      })
      .catch((error) => {
        if (mountedRef.current && saveRequestIdRef.current === requestId) {
          setSaveState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
  }, []);

  useEffect(() => {
    if (!dirtyRevision) return undefined;
    const revision = dirtyRevision;
    pendingSaveTimerRef.current = window.setTimeout(() => {
      pendingSaveTimerRef.current = null;
      void saveRevision(revision);
    }, SETTINGS_AUTO_SAVE_DELAY_MS);
    return () => {
      if (pendingSaveTimerRef.current !== null) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
    };
  }, [dirtyRevision, saveRevision]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pendingSaveTimerRef.current !== null) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
      const revision = latestDirtyRevisionRef.current;
      if (revision <= lastStartedRevisionRef.current) return;
      // 离开设置页时必须立即保存最新草稿，而不是取消其防抖等待窗口。
      lastStartedRevisionRef.current = revision;
      void onSaveRef.current(providersRef.current.map(prepareProviderForSave), apiKeysByProviderIdRef.current)
        .catch((error) => console.error('[settings] failed to flush provider settings during unmount', error));
    };
  }, []);

  const markDirty = () => {
    setSaveState({ status: 'saving', message: '生效中' });
    setDirtyRevision((current) => current + 1);
  };

  const updateProvider = (providerId: string, updater: (provider: ProviderConfigState) => ProviderConfigState) => {
    markDirty();
    setProviders((current) => current.map((provider) => (provider.id === providerId ? updater(provider) : provider)));
  };

  const setProviderApiKey = (providerId: string, value: string) => {
    markDirty();
    setApiKeysByProviderId((current) => ({ ...current, [providerId]: value }));
  };

  const addProvider = () => {
    const nextProvider = defaultProviderConfig();
    markDirty();
    setProviders((current) => [...current, nextProvider]);
    setSelectedProviderId(nextProvider.id);
  };

  const removeProvider = (providerId: string) => {
    setEditingProviderIconId((current) => (current === providerId ? null : current));
    setEditingModelIcon((current) => (current?.providerId === providerId ? null : current));
    markDirty();
    setProviders((current) => {
      const removedIndex = Math.max(
        0,
        current.findIndex((provider) => provider.id === providerId)
      );
      const next = current.filter((provider) => provider.id !== providerId);
      const normalizedNext = next.length ? next : [defaultProviderConfig()];
      setSelectedProviderId((selected) => (selected === providerId ? normalizedNext[Math.min(removedIndex, normalizedNext.length - 1)]?.id ?? normalizedNext[0]?.id ?? '' : selected));
      return normalizedNext;
    });
    setApiKeysByProviderId((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
  };

  const addModel = (providerId: string) => {
    const provider = providers.find((item) => item.id === providerId);
    setEditingModel({
      mode: 'create',
      providerId,
      model: defaultProviderModel('', !provider?.models.length, provider?.provider),
    });
  };

  const removeModel = (providerId: string, modelId: string) => {
    setEditingModel((current) => (current?.mode === 'edit' && current.providerId === providerId && current.modelId === modelId ? null : current));
    setEditingModelIcon((current) => (current?.providerId === providerId && current.modelId === modelId ? null : current));
    updateProvider(providerId, (provider) =>
      ensureProviderActiveModel({
        ...provider,
        models: provider.models.filter((model) => model.id !== modelId),
      })
    );
  };

  const commitEditingModel = (nextModel: ProviderModelConfig) => {
    const current = editingModel;
    if (!current) return;
    if (current.mode === 'create') {
      updateProvider(current.providerId, (provider) =>
        ensureProviderActiveModel({
          ...provider,
          models: [...provider.models, normalizeProviderModel(nextModel, provider.models.length === 0, provider.provider)],
        })
      );
    } else {
      updateProvider(current.providerId, (provider) =>
        ensureProviderActiveModel({
          ...provider,
          models: provider.models.map((model) => (model.id === current.modelId ? normalizeProviderModel({ ...nextModel, id: current.modelId }, model.enabled, provider.provider) : model)),
        })
      );
    }
    setEditingModel(null);
  };

  const fetchModels = (provider: ProviderConfigState) => {
    setFetchStateByProviderId((current) => ({
      ...current,
      [provider.id]: { error: '', fetching: true, message: '' },
    }));
    void onFetchModels({
      providerId: provider.id,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKey: apiKeysByProviderId[provider.id] || undefined,
    })
      .then((result) => {
        const currentProvider = providersRef.current.find((item) => item.id === provider.id);
        if (!currentProvider) return;
        const nextModels = mergeFetchedModels(currentProvider.models, result.models, currentProvider.provider);
        const decision = providerModelReplacementDecision(currentProvider.models, nextModels);
        if (decision === 'confirm') {
          setPendingModelReplacement({
            providerId: provider.id,
            providerName: currentProvider.name,
            currentModels: currentProvider.models,
            nextModels,
          });
        } else if (decision === 'apply') {
          updateProvider(provider.id, (item) => ({ ...item, models: nextModels }));
        }
        setFetchStateByProviderId((current) => ({
          ...current,
          [provider.id]: {
            error: '',
            fetching: false,
            message: modelFetchSuccessMessage(decision, result.models.length),
          },
        }));
      })
      .catch((error) => {
        setFetchStateByProviderId((current) => ({
          ...current,
          [provider.id]: {
            ...(current[provider.id] ?? emptyModelFetchState()),
            error: error instanceof Error ? error.message : String(error),
            fetching: false,
            message: '',
          },
        }));
      });
  };

  const cancelModelReplacement = () => {
    const pending = pendingModelReplacement;
    if (!pending) return;
    setPendingModelReplacement(null);
    setFetchStateByProviderId((current) => ({
      ...current,
      [pending.providerId]: {
        ...(current[pending.providerId] ?? emptyModelFetchState()),
        message: '已取消替换，当前模型配置未修改。',
      },
    }));
  };

  const confirmModelReplacement = () => {
    const pending = pendingModelReplacement;
    if (!pending) return;
    setPendingModelReplacement(null);
    updateProvider(pending.providerId, (provider) => ({ ...provider, models: pending.nextModels }));
    setFetchStateByProviderId((current) => ({
      ...current,
      [pending.providerId]: {
        ...(current[pending.providerId] ?? emptyModelFetchState()),
        message: `已确认替换为 ${pending.nextModels.length} 个模型。`,
      },
    }));
  };

  const enabledProviderCount = providers.filter((provider) => provider.enabled).length;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];
  const selectedProviderIndex = selectedProvider ? providers.findIndex((provider) => provider.id === selectedProvider.id) : -1;
  const selectedFetchState = selectedProvider ? fetchStateByProviderId[selectedProvider.id] ?? emptyModelFetchState() : emptyModelFetchState();
  const editingProvider = editingModel ? providers.find((provider) => provider.id === editingModel.providerId) : undefined;
  const editingModelConfig = editingModel?.mode === 'create' ? editingModel.model : editingProvider?.models.find((model) => model.id === editingModel?.modelId);
  const editingProviderIcon = editingProviderIconId ? providers.find((provider) => provider.id === editingProviderIconId) : undefined;
  const editingModelIconProvider = editingModelIcon ? providers.find((provider) => provider.id === editingModelIcon.providerId) : undefined;
  const editingModelIconConfig = editingModelIconProvider?.models.find((model) => model.id === editingModelIcon?.modelId);

  return (
    <div className="chat-user-settings__local-provider-stack">
      <div className="chat-user-settings__local-provider-layout">
        <aside className="chat-user-settings__local-provider-rail">
          <div className="chat-user-settings__local-provider-rail-head">
            <div>
              <span>服务列表</span>
              <strong>{`${providers.length} 个服务 · ${enabledProviderCount} 个启用`}</strong>
            </div>
            <Button className="chat-user-settings__add-provider" icon={<Plus size={13} />} onClick={addProvider}>
              添加
            </Button>
          </div>
          <nav className="chat-user-settings__local-provider-list" aria-label="模型服务">
            {providers.map((provider, providerIndex) => (
              <ProviderRailItem
                key={provider.id}
                index={providerIndex}
                provider={provider}
                selected={provider.id === selectedProvider?.id}
                onSelect={() => setSelectedProviderId(provider.id)}
              />
            ))}
          </nav>
        </aside>
        {selectedProvider ? (
          <div className="chat-user-settings__local-provider-card">
            <div className="chat-user-settings__local-provider-head">
              <div className="chat-user-settings__local-provider-title">
                <button
                  className="chat-user-settings__provider-brand-trigger"
                  type="button"
                  aria-label={`配置“${selectedProvider.name || `服务 ${selectedProviderIndex + 1}`}”的图标`}
                  title="配置服务图标"
                  onClick={() => setEditingProviderIconId(selectedProvider.id)}
                >
                  <BrandIconMark brand={resolveProviderBrand(selectedProvider)} fallbackName={selectedProvider.name} size="large" />
                  <span className="chat-user-settings__provider-brand-trigger-edit" aria-hidden="true"><Pencil size={8} /></span>
                </button>
                <span className="chat-user-settings__local-provider-title-copy">
                  <strong>{selectedProvider.name || `服务 ${selectedProviderIndex + 1}`}</strong>
                  <span>{`${providerProtocolLabel(selectedProvider.provider)} · ${selectedProvider.models.length} 个模型`}</span>
                </span>
              </div>
              <div className="chat-user-settings__local-provider-actions">
                <label className="sd-check chat-user-settings__provider-toggle">
                  <span className={selectedProvider.enabled ? 'is-enabled' : ''}>
                    <i aria-hidden="true" />
                    {selectedProvider.enabled ? '服务已启用' : '服务已停用'}
                  </span>
                  <input
                    aria-label={selectedProvider.enabled ? '停用服务' : '启用服务'}
                    type="checkbox"
                    checked={selectedProvider.enabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      updateProvider(selectedProvider.id, (item) => ({ ...item, enabled }));
                    }}
                  />
                </label>
                {providers.length > 1 ? (
                  <Popconfirm
                    title={`删除服务“${selectedProvider.name || `服务 ${selectedProviderIndex + 1}`}”？`}
                    description={`将同时删除该服务的 ${selectedProvider.models.length} 个模型和已保存的 API Key，此操作无法撤销。`}
                    placement="bottomRight"
                    okText="删除服务"
                    cancelText="取消"
                    okButtonProps={DANGER_CONFIRM_BUTTON_PROPS}
                    onConfirm={() => removeProvider(selectedProvider.id)}
                  >
                    <IconButton className="chat-user-settings__delete-provider" label="删除服务" variant="danger">
                      <Trash2 size={14} />
                    </IconButton>
                  </Popconfirm>
                ) : null}
              </div>
            </div>
            <div className="chat-user-settings__local-provider-body">
              <section className="settings-form-section settings-provider-connection">
                <header className="settings-provider-section__head">
                  <div className="settings-provider-section__heading">
                    <span className="settings-provider-section__icon">
                      <Globe2 size={15} />
                    </span>
                    <span>
                      <strong>连接配置</strong>
                      <small>设置协议、接口地址与访问凭据</small>
                    </span>
                  </div>
                  <code>{providerProtocolMeta(selectedProvider.provider)}</code>
                </header>
                <div className="settings-provider-fields">
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">协议</span>
                    <SelectField
                      className="settings-local-control"
                      value={selectedProvider.provider}
                      onValueChange={(nextValue) => {
                        const provider = normalizeProviderKind(nextValue);
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
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">显示名称</span>
                    <TextField
                      className="settings-local-control"
                      value={selectedProvider.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        updateProvider(selectedProvider.id, (item) => ({ ...item, name }));
                      }}
                    />
                  </label>
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">服务地址</span>
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
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">API 密钥 {selectedProvider.apiKeySet ? <em>{selectedProvider.apiKeyPreview}</em> : null}</span>
                    <TextField className="settings-local-control" type="password" value={apiKeysByProviderId[selectedProvider.id] ?? ''} onChange={(event) => setProviderApiKey(selectedProvider.id, event.target.value)} placeholder={providerApiKeyPlaceholder(selectedProvider)} />
                  </label>
                </div>
              </section>
              <section className="settings-form-section settings-model-section">
                <div className="settings-model-list">
                  <div className="settings-model-list__head">
                    <div className="settings-model-list__heading">
                      <span className="settings-provider-section__icon">
                        <Library size={15} />
                      </span>
                      <span>
                        <strong>模型目录</strong>
                        <small>{`${selectedProvider.models.length} 个模型 · 可自动同步或手动添加`}</small>
                      </span>
                    </div>
                    <div className="settings-model-list__actions">
                      <Button icon={<RefreshCw className={selectedFetchState.fetching ? 'is-spinning' : undefined} size={14} />} disabled={selectedFetchState.fetching} onClick={() => fetchModels(selectedProvider)}>
                        {selectedFetchState.fetching ? '同步中' : '同步模型'}
                      </Button>
                      <Button icon={<Plus size={14} />} variant="primary" onClick={() => addModel(selectedProvider.id)}>
                        添加模型
                      </Button>
                    </div>
                  </div>
                  <div className="settings-model-browser">
                    <div className="settings-model-browser__head" aria-hidden="true">
                      <span>模型</span>
                      <span>能力与限制</span>
                      <span>操作</span>
                    </div>
                    <div className="settings-model-browser__body" role="list" aria-label="模型列表">
                      {selectedProvider.models.map((model) => (
                        <ProviderModelRow
                          key={model.id}
                          canDelete={selectedProvider.models.length > 1}
                          model={model}
                          provider={selectedProvider}
                          onDelete={() => removeModel(selectedProvider.id, model.id)}
                          onEdit={() => setEditingModel({ mode: 'edit', providerId: selectedProvider.id, modelId: model.id })}
                          onEditIcon={() => setEditingModelIcon({ providerId: selectedProvider.id, modelId: model.id })}
                        />
                      ))}
                    </div>
                  </div>
                  {selectedFetchState.error ? <div className="settings-model-fetch-state settings-model-fetch-state--error">{selectedFetchState.error}</div> : null}
                  {!selectedFetchState.error && selectedFetchState.message ? <div className="settings-model-fetch-state">{selectedFetchState.message}</div> : null}
                </div>
              </section>
            </div>
            {editingModel && editingProvider && editingModelConfig ? <ModelSettingsDialog key={`${editingModel.mode}-${editingProvider.id}-${editingModelConfig.id}`} defaultMaxOutputTokens={defaultModelMaxOutputTokens(editingProvider.provider)} model={editingModelConfig} onClose={() => setEditingModel(null)} onConfirm={commitEditingModel} /> : null}
          </div>
        ) : (
          <div className="chat-user-settings__local-provider-card">
            <EmptyState title="暂无模型服务" />
          </div>
        )}
      </div>
      {pendingModelReplacement ? (
        <ProviderModelReplacementDialog
          providerName={pendingModelReplacement.providerName}
          currentModels={pendingModelReplacement.currentModels}
          nextModels={pendingModelReplacement.nextModels}
          onCancel={cancelModelReplacement}
          onConfirm={confirmModelReplacement}
        />
      ) : null}
      {editingProviderIcon ? (
        <BrandIconDialog
          key={editingProviderIcon.id}
          automaticBrand={resolveAutomaticProviderBrand(editingProviderIcon)}
          icon={editingProviderIcon.icon}
          name={editingProviderIcon.name}
          subject="provider"
          onClose={() => setEditingProviderIconId(null)}
          onConfirm={(icon) => {
            updateProvider(editingProviderIcon.id, (provider) => providerWithIcon(provider, icon));
            setEditingProviderIconId(null);
          }}
        />
      ) : null}
      {editingModelIconProvider && editingModelIconConfig ? (
        <BrandIconDialog
          key={`${editingModelIconProvider.id}:${editingModelIconConfig.id}`}
          automaticBrand={resolveAutomaticModelBrand(editingModelIconConfig, editingModelIconProvider)}
          icon={editingModelIconConfig.icon}
          name={editingModelIconConfig.name || editingModelIconConfig.code}
          subject="model"
          onClose={() => setEditingModelIcon(null)}
          onConfirm={(icon) => {
            updateProvider(editingModelIconProvider.id, (provider) => ({
              ...provider,
              models: provider.models.map((model) => (
                model.id === editingModelIconConfig.id ? modelWithIcon(model, icon) : model
              )),
            }));
            setEditingModelIcon(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ProviderRailItem({
  index,
  provider,
  selected,
  onSelect,
}: {
  index: number;
  provider: ProviderConfigState;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = provider.name || `服务 ${index + 1}`;
  return (
    <button
      className={`chat-user-settings__local-provider-item ${selected ? 'is-active' : ''}`}
      type="button"
      aria-current={selected ? 'true' : undefined}
      title={`${name} · ${providerProtocolLabel(provider.provider)} · ${provider.models.length} 个模型`}
      onClick={onSelect}
    >
      <BrandIconMark brand={resolveProviderBrand(provider)} fallbackName={provider.name} />
      <span className="chat-user-settings__local-provider-item-body">
        <span className="chat-user-settings__local-provider-item-main">
          <span className="chat-user-settings__local-provider-item-name">{name}</span>
          <span className={`chat-user-settings__local-provider-item-status ${provider.enabled ? 'is-enabled' : ''}`}>
            <i aria-hidden="true" />
            {provider.enabled ? '启用' : '停用'}
          </span>
        </span>
        <span className="chat-user-settings__local-provider-item-meta">
          <span>{providerProtocolLabel(provider.provider)}</span>
          <i aria-hidden="true" />
          <span>{`${provider.models.length} 个模型`}</span>
        </span>
      </span>
    </button>
  );
}

function ProviderModelRow({
  canDelete,
  model,
  provider,
  onDelete,
  onEdit,
  onEditIcon,
}: {
  canDelete: boolean;
  model: ProviderModelConfig;
  provider: ProviderConfigState;
  onDelete: () => void;
  onEdit: () => void;
  onEditIcon: () => void;
}) {
  const name = model.name || model.code || '未命名模型';
  return (
    <div className="settings-model-option" role="listitem">
      <div className="settings-model-option__body">
        <button
          className="settings-model-option__icon"
          type="button"
          aria-label={`配置“${name}”的图标`}
          title="配置模型图标"
          onClick={onEditIcon}
        >
          <BrandIconMark brand={resolveModelBrand(model, provider)} fallbackName={name} />
          <span className="settings-model-option__icon-edit" aria-hidden="true"><Pencil size={7} /></span>
        </button>
        <span className="settings-model-option__copy">
          <span className="settings-model-option__name">{name}</span>
          <code>{model.code || '未填写模型 ID'}</code>
        </span>
      </div>
      <span className="settings-model-option__meta">
        {model.contextWindowTokens ? <span title="上下文窗口">{`${formatTokens(model.contextWindowTokens)} 上下文`}</span> : null}
        <span title="最大输出 Token">{`${formatTokens(model.maxOutputTokens)} 输出`}</span>
        {model.thinkingEnabled ? <span>思考</span> : null}
        {model.supportsImages ? <span>视觉</span> : null}
      </span>
      <div className="settings-model-option__actions">
        <IconButton label="编辑模型" onClick={onEdit}>
          <Pencil size={14} />
        </IconButton>
        <IconButton label="删除模型" variant="danger" disabled={!canDelete} onClick={onDelete}>
          <Trash2 size={14} />
        </IconButton>
      </div>
    </div>
  );
}

const DEFAULT_PROVIDER_KIND: ProviderConfigState['provider'] = 'openai-compatible';
const SETTINGS_AUTO_SAVE_DELAY_MS = 300;
const DANGER_CONFIRM_BUTTON_PROPS = { danger: true } as const;
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
  error: string;
  fetching: boolean;
  message: string;
};

type SaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message: string;
};

type EditingModelState = {
  providerId: string;
} & ({ mode: 'edit'; modelId: string } | { mode: 'create'; model: ProviderModelConfig });

type PendingModelReplacement = {
  providerId: string;
  providerName: string;
  currentModels: ProviderModelConfig[];
  nextModels: ProviderModelConfig[];
};

type ModelIconTarget = {
  providerId: string;
  modelId: string;
};

function emptyModelFetchState(): ModelFetchState {
  return { error: '', fetching: false, message: '' };
}

function modelFetchSuccessMessage(decision: ReturnType<typeof providerModelReplacementDecision>, modelCount: number): string {
  if (decision === 'confirm') return `已获取 ${modelCount} 个模型，确认后才会替换当前配置。`;
  if (decision === 'unchanged') return `已获取 ${modelCount} 个模型，与当前配置一致。`;
  return `已获取并应用 ${modelCount} 个模型。`;
}

function idleSaveState(): SaveState {
  return { status: 'idle', message: '' };
}

function AutoSaveStatus({ state }: { state: SaveState }) {
  const visible = Boolean(state.message);
  return (
    <span className={`settings-auto-save-status settings-auto-save-status--${state.status} ${visible ? 'is-visible' : ''}`} aria-live="polite" title={visible ? state.message : undefined}>
      {state.message}
    </span>
  );
}

function ModelSettingsDialog({ defaultMaxOutputTokens, model, onClose, onConfirm }: { defaultMaxOutputTokens: number; model: ProviderModelConfig; onClose: () => void; onConfirm: (model: ProviderModelConfig) => void }) {
  const [draftModel, setDraftModel] = useState(model);
  const thinkingEfforts = normalizeThinkingEfforts([...draftModel.thinkingEfforts, draftModel.defaultThinkingEffort]);
  const customThinkingEffortsText = draftModel.thinkingEnabled ? customThinkingEfforts(thinkingEfforts).join(', ') : '';

  const updateDraft = (updater: (model: ProviderModelConfig) => ProviderModelConfig) => {
    setDraftModel((current) => updater(current));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="desktop-agent-modal-backdrop settings-model-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="desktop-agent-modal settings-model-modal" role="dialog" aria-modal="true" aria-label="编辑模型" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-model-modal__header">
          <div>
            <strong>{draftModel.name || draftModel.code || '未命名模型'}</strong>
            <code>{draftModel.code || '未填写模型 ID'}</code>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="settings-model-modal__body">
          <div className="settings-model-modal__grid">
            <label className="settings-model-field">
              <span className="settings-model-label">显示名称</span>
              <TextField
                autoFocus
                className="settings-local-control"
                value={draftModel.name}
                placeholder="显示名称"
                onChange={(event) => {
                  const name = event.target.value;
                  updateDraft((item) => ({ ...item, name }));
                }}
              />
            </label>
            <label className="settings-model-field">
              <span className="settings-model-label">模型 ID</span>
              <TextField
                className="settings-local-control settings-model-code-control"
                value={draftModel.code}
                placeholder="llama3.1"
                onChange={(event) => {
                  const code = event.target.value;
                  updateDraft((item) => updateModelCode(item, code));
                }}
              />
            </label>
            <label className="settings-model-field">
              <span className="settings-model-label">输出</span>
              <TextField
                className="settings-local-control settings-model-output-control"
                type="number"
                min={1}
                value={draftModel.maxOutputTokens}
                onChange={(event) => {
                  const maxOutputTokens = positiveInt(Number(event.target.value), defaultMaxOutputTokens);
                  updateDraft((item) => ({ ...item, maxOutputTokens }));
                }}
              />
            </label>
            <label className="settings-model-field">
              <span className="settings-model-label">上下文窗口</span>
              <TextField
                className="settings-local-control settings-model-context-control"
                type="number"
                min={0}
                placeholder="未设置"
                value={draftModel.contextWindowTokens ?? ''}
                onChange={(event) => {
                  const contextWindowTokens = positiveInt(Number(event.target.value), 0) || undefined;
                  updateDraft((item) => ({ ...item, contextWindowTokens }));
                }}
              />
            </label>
          </div>
          <div className="settings-model-modal__section">
            <span className="settings-model-label">能力</span>
            <div className="settings-model-inline-checks">
              <label className={`sd-check settings-model-check ${draftModel.thinkingEnabled ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  checked={draftModel.thinkingEnabled}
                  onChange={(event) => {
                    const thinkingEnabled = event.currentTarget.checked;
                    updateDraft((item) => setThinkingEnabled(item, thinkingEnabled));
                  }}
                />
                <Brain size={13} />
                <span>思考</span>
              </label>
              <label className={`sd-check settings-model-check ${draftModel.supportsImages ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  checked={Boolean(draftModel.supportsImages)}
                  onChange={(event) => {
                    const supportsImages = event.currentTarget.checked;
                    updateDraft((item) => ({ ...item, supportsImages }));
                  }}
                />
                <ImageIcon size={13} />
                <span>图片</span>
              </label>
            </div>
          </div>
          <div className="settings-model-modal__section">
            <span className="settings-model-label">思考等级</span>
            <div className="settings-thinking-levels__content">
              <div className="settings-thinking-presets" aria-label="常用思考等级">
                {thinkingPresetOptionsForModel().map((effort) => {
                  const selected = thinkingEfforts.includes(effort);
                  return (
                    <button key={effort} className={`settings-thinking-preset ${selected ? 'is-active' : ''}`} type="button" aria-pressed={selected} disabled={!draftModel.thinkingEnabled} onClick={() => updateDraft((item) => toggleThinkingEffort(item, effort))}>
                      {effort}
                    </button>
                  );
                })}
              </div>
              <TextField
                aria-label="自定义思考等级"
                className="settings-thinking-input"
                disabled={!draftModel.thinkingEnabled}
                placeholder="自定义档位"
                value={customThinkingEffortsText}
                onChange={(event) => {
                  const efforts = event.target.value;
                  updateDraft((item) => setCustomThinkingEfforts(item, efforts));
                }}
              />
            </div>
          </div>
        </div>
        <footer className="settings-model-modal__footer">
          <div className="settings-model-modal__footer-actions">
            <Button type="button" onClick={onClose}>
              取消
            </Button>
            <Button type="button" variant="primary" onClick={() => onConfirm(draftModel)}>
              确定
            </Button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}

function selectedProviderIdFromConfig(config: RuntimeConfigState): string {
  return selectedProviderIdFromProviders(config.activeProviderId, config.providers);
}

function activeSettingsProvider(config: RuntimeConfigState): ProviderConfigState | undefined {
  const providerId = selectedProviderIdFromConfig(config);
  return config.providers.find((provider) => provider.id === providerId);
}

function memoryExtractModelOptions(config: RuntimeConfigState): Array<{ value: string; label: string }> {
  const provider = activeSettingsProvider(config);
  if (!provider?.enabled) return [];
  const seen = new Set<string>();
  return provider.models.reduce<Array<{ value: string; label: string }>>((options, model) => {
    const code = model.code.trim();
    if (!code || seen.has(code)) return options;
    seen.add(code);
    options.push({
      value: code,
      label: model.name && model.name !== code ? `${model.name} (${code})` : code,
    });
    return options;
  }, []);
}

function selectedProviderIdFromProviders(activeProviderId: string | undefined, providers: ProviderConfigState[]): string {
  return providers.find((provider) => provider.id === activeProviderId && provider.enabled)?.id ?? providers.find((provider) => provider.enabled)?.id ?? providers[0]?.id ?? '';
}

function hasProviderModel(providers: ProviderConfigState[], providerId: string, modelId: string): boolean {
  return providers.some((provider) => provider.id === providerId && provider.models.some((model) => model.id === modelId));
}

function normalizeSettingsProviders(providers: ProviderConfigState[]): ProviderConfigState[] {
  const normalized = (providers.length ? providers : [defaultProviderConfig()]).map((provider) => {
    const providerKind = normalizeProviderKind(provider.provider);
    return {
      ...provider,
      provider: providerKind,
      name: provider.name || '模型服务',
      models: normalizeProviderModels(provider.models, providerKind),
    };
  });
  return normalized.length ? normalized : [defaultProviderConfig()];
}

function normalizeProviderModels(models: ProviderModelConfig[], provider: ProviderConfigState['provider']): ProviderModelConfig[] {
  const normalized = (models.length ? models : [defaultProviderModel('', true, provider)])
    .map((model, index) => normalizeProviderModel(model, index === 0, provider));
  const activeModelId = normalized.find((model) => model.enabled)?.id ?? normalized[0]?.id;
  return normalized.map((model) => ({ ...model, enabled: model.id === activeModelId }));
}

function normalizeProviderModel(model: ProviderModelConfig, fallbackEnabled = false, provider: ProviderConfigState['provider'] = DEFAULT_PROVIDER_KIND): ProviderModelConfig {
  const code = model.code?.trim() ?? '';
  const thinkingEfforts = normalizeThinkingEfforts([...model.thinkingEfforts, model.defaultThinkingEffort]);
  return {
    ...model,
    id: model.id || modelIdFromCode(code),
    name: model.name || code || '新模型',
    code,
    enabled: model.enabled ?? fallbackEnabled,
    maxOutputTokens: positiveInt(model.maxOutputTokens, defaultModelMaxOutputTokens(provider)),
    contextWindowTokens: model.contextWindowTokens ? positiveInt(model.contextWindowTokens, 0) || undefined : undefined,
    thinkingEnabled: Boolean(model.thinkingEnabled),
    thinkingEfforts,
    defaultThinkingEffort: model.thinkingEnabled ? normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }) : undefined,
    supportsImages: Boolean(model.supportsImages),
  };
}

function defaultProviderConfig(): ProviderConfigState {
  return {
    id: uniqueLocalId('provider'),
    name: '新模型服务',
    provider: DEFAULT_PROVIDER_KIND,
    baseUrl: 'http://127.0.0.1:11434/v1',
    enabled: true,
    apiKeySet: false,
    apiKeyPreview: '',
    models: [defaultProviderModel('', true, DEFAULT_PROVIDER_KIND)],
  };
}

function defaultProviderModel(code: string, enabled = true, provider: ProviderConfigState['provider'] = DEFAULT_PROVIDER_KIND): ProviderModelConfig {
  return {
    id: modelIdFromCode(code),
    name: code || '新模型',
    code,
    enabled,
    maxOutputTokens: defaultModelMaxOutputTokens(provider),
    thinkingEnabled: false,
    thinkingEfforts: [],
    supportsImages: false,
  };
}

function prepareProviderForSave(provider: ProviderConfigState): ProviderConfigState {
  return {
    ...provider,
    provider: normalizeProviderKind(provider.provider),
    models: normalizeProviderModels(provider.models, provider.provider).map((model) => ({
      ...model,
      defaultThinkingEffort: normalizedDefaultThinkingEffort(model),
    })),
  };
}

function providerWithIcon(provider: ProviderConfigState, icon: BrandIconConfig | undefined): ProviderConfigState {
  if (icon) return { ...provider, icon };
  const nextProvider = { ...provider };
  delete nextProvider.icon;
  return nextProvider;
}

function modelWithIcon(model: ProviderModelConfig, icon: BrandIconConfig | undefined): ProviderModelConfig {
  if (icon) return { ...model, icon };
  const nextModel = { ...model };
  delete nextModel.icon;
  return nextModel;
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
  return { ...provider, models: normalizeProviderModels(provider.models, provider.provider) };
}

function mergeFetchedModels(previousModels: ProviderModelConfig[], fetchedModels: RuntimeAvailableModel[], provider: ProviderConfigState['provider']): ProviderModelConfig[] {
  const previousByCode = new Map(previousModels.map((model) => [model.code, model]));
  const previousByName = new Map(previousModels.map((model) => [model.name, model]));
  const previousActiveCode = previousModels.find((model) => model.enabled)?.code;
  const activeCode = fetchedModels.some((model) => model.id === previousActiveCode) ? previousActiveCode : fetchedModels[0]?.id;
  const merged = fetchedModels.map((model) => {
    const previous = previousByCode.get(model.id) ?? previousByName.get(model.name);
    const code = model.id.trim();
    const thinkingEfforts = normalizeThinkingEfforts([...(previous?.thinkingEfforts ?? []), ...(model.thinkingEfforts ?? []), previous?.defaultThinkingEffort, model.defaultThinkingEffort]);
    const defaultThinkingEffort = nonEmptyString(previous?.defaultThinkingEffort) ?? nonEmptyString(model.defaultThinkingEffort);
    return normalizeProviderModel(
      {
        ...defaultProviderModel(code, code === activeCode, provider),
        id: previous?.id || modelIdFromCode(code),
        name: model.name?.trim() || code,
        ...(previous?.icon ? { icon: previous.icon } : {}),
        maxOutputTokens: previous?.maxOutputTokens ?? model.maxOutputTokens ?? defaultModelMaxOutputTokens(provider),
        thinkingEnabled: Boolean(previous?.thinkingEnabled || model.thinkingEnabled || thinkingEfforts.length || defaultThinkingEffort),
        thinkingEfforts,
        defaultThinkingEffort,
        supportsImages: Boolean(previous?.supportsImages || model.supportsImages),
      },
      code === activeCode,
      provider,
    );
  });
  return normalizeProviderModels(merged, provider);
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
  const thinkingEfforts = normalizeThinkingEfforts([...model.thinkingEfforts, model.defaultThinkingEffort]);
  return {
    ...model,
    thinkingEnabled,
    thinkingEfforts,
    defaultThinkingEffort: thinkingEnabled ? normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }) : undefined,
  };
}

function setThinkingEfforts(model: ProviderModelConfig, efforts: unknown): ProviderModelConfig {
  const thinkingEfforts = normalizeThinkingEfforts(efforts);
  return {
    ...model,
    thinkingEfforts,
    defaultThinkingEffort: model.thinkingEnabled ? normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }) : undefined,
  };
}

function setCustomThinkingEfforts(model: ProviderModelConfig, customEfforts: unknown): ProviderModelConfig {
  const presetEfforts = normalizeThinkingEfforts([...model.thinkingEfforts, model.defaultThinkingEffort]).filter(isReasoningEffort);
  return setThinkingEfforts(model, [...presetEfforts, ...normalizeThinkingEfforts(customEfforts)]);
}

function toggleThinkingEffort(model: ProviderModelConfig, effort: string): ProviderModelConfig {
  const normalizedEffort = nonEmptyString(effort);
  if (!normalizedEffort) return model;
  const currentEfforts = normalizeThinkingEfforts([...model.thinkingEfforts, model.defaultThinkingEffort]);
  const nextEfforts = currentEfforts.includes(normalizedEffort) ? currentEfforts.filter((item) => item !== normalizedEffort) : [...currentEfforts, normalizedEffort];
  return setThinkingEfforts(model, nextEfforts);
}

function normalizedDefaultThinkingEffort(model: ProviderModelConfig): string | undefined {
  if (!model.thinkingEnabled) return undefined;
  return normalizeDefaultThinkingEffort(model);
}

function normalizeDefaultThinkingEffort(model: Pick<ProviderModelConfig, 'defaultThinkingEffort' | 'thinkingEfforts'>): string | undefined {
  const thinkingEfforts = normalizeThinkingEfforts(model.thinkingEfforts);
  const defaultThinkingEffort = nonEmptyString(model.defaultThinkingEffort);
  if (defaultThinkingEffort && thinkingEfforts.includes(defaultThinkingEffort)) return defaultThinkingEffort;
  return thinkingEfforts[0];
}

function normalizeThinkingEfforts(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\s]+/) : [];
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

function thinkingPresetOptionsForModel(): string[] {
  return normalizeThinkingEfforts(REASONING_EFFORTS);
}

function customThinkingEfforts(efforts: string[]): string[] {
  return normalizeThinkingEfforts(efforts).filter((effort) => !isReasoningEffort(effort));
}

function isReasoningEffort(effort: string): boolean {
  return (REASONING_EFFORTS as readonly string[]).includes(effort);
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
