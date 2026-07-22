import type {
  ProviderConfigState,
  RuntimeAvailableModelsResponse,
  RuntimeConfigState,
  RuntimeFetchModelsInput,
  RuntimeMemoryPreview,
  RuntimeThread,
  RuntimeThreadSummary,
  RuntimeUsageResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import {
  Archive,
  CircleGauge,
  HardDrive,
  Info,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { DesktopUpdaterStateView } from '../../app/controller/useDesktopUpdater.js';
import { EmptyState, PageBackButton } from '../../shared/ui/primitives.js';
import {
  AutoSaveStatus,
  LocalModelSettings,
  idleSaveState,
  type SaveState,
} from './providers/ProviderSettings.js';
import { AboutSettings } from './sections/AboutSettings.js';
import { ArchivedThreadsSettings } from './sections/ArchivedThreadsSettings.js';
import { GeneralSettings } from './sections/GeneralSettings.js';
import { PersonalizationSettings } from './sections/PersonalizationSettings.js';
import { RuntimePolicySettings } from './sections/RuntimeSettings.js';
import type { RuntimePreferenceInput, SettingsSectionId } from './settings-types.js';
import { UsageSettings } from './usage/UsageSettings.js';

export { ArchivedThreadsSettings } from './sections/ArchivedThreadsSettings.js';

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

const settingsSectionDescriptions: Partial<Record<SettingsSectionId, string>> = {
  localLlm: '接入并管理用于对话与自动化任务的模型服务。',
  usage: '追踪模型调用、Token 消耗与过去一年的活跃趋势。',
};

const EMPTY_PROVIDER_CONFIGS: ProviderConfigState[] = [];

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
  onSaveProviders: (
    providers: ProviderConfigState[],
    apiKeysByProviderId: Record<string, string>,
  ) => Promise<void>;
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

  useEffect(() => {
    if (activeSection !== 'localLlm') setLocalModelSaveState(idleSaveState());
  }, [activeSection]);

  const content =
    activeSection === 'general' ? (
      <GeneralSettings config={config} onSave={onSaveRuntimePreferences} />
    ) : activeSection === 'localLlm' ? (
      config ? (
        <LocalModelSettings
          config={config}
          onFetchModels={onFetchProviderModels}
          onSave={onSaveProviders}
          onSaveStateChange={setLocalModelSaveState}
        />
      ) : (
        <EmptyState title="Config unavailable" />
      )
    ) : activeSection === 'usage' ? (
      <UsageSettings providers={config?.providers ?? EMPTY_PROVIDER_CONFIGS} usage={usage} />
    ) : activeSection === 'archives' ? (
      <ArchivedThreadsSettings
        threads={archivedThreads}
        onDeleteAll={onDeleteAllArchivedThreads}
        onDelete={onDeleteArchivedThread}
        onRestore={onRestoreArchivedThread}
      />
    ) : activeSection === 'personalization' ? (
      config ? (
        <PersonalizationSettings
          config={config}
          projects={projects}
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
    ) : config ? (
      <RuntimePolicySettings
        config={config}
        skillExtraRoots={skillExtraRoots}
        onSave={onSaveRuntimePreferences}
        onSetSkillExtraRoots={onSetSkillExtraRoots}
      />
    ) : (
      <EmptyState title="Config unavailable" />
    );

  return (
    <>
      <SettingsSidebar activeSection={activeSection} onBack={onBack} onSelectSection={setActiveSection} />
      <main className="desktop-settings-panel">
        <section
          className={`chat-user-settings__content ${
            activeSection === 'localLlm' ? 'chat-user-settings__content--local-llm' : ''
          } ${activeSection === 'usage' ? 'chat-user-settings__content--usage' : ''}`}
        >
          <header className="chat-user-settings__page-heading">
            <div className="chat-user-settings__page-heading-copy">
              <h1>{settingsSectionLabels[activeSection]}</h1>
              {settingsSectionDescriptions[activeSection] ? (
                <p>{settingsSectionDescriptions[activeSection]}</p>
              ) : null}
            </div>
            {activeSection === 'localLlm' && localModelSaveState.message ? (
              <AutoSaveStatus state={localModelSaveState} />
            ) : null}
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
      <PageBackButton
        block
        className="chat-user-settings__page-back"
        label="返回应用"
        onClick={onBack}
      />
      <div className="chat-user-settings__title">设置</div>
      <div className="chat-user-settings__tabs">
        {settingsSections.map((section) => (
          <button
            key={section.id}
            className={activeSection === section.id ? 'is-active' : ''}
            type="button"
            onClick={() => onSelectSection(section.id)}
          >
            {section.icon}
            <span>{section.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
