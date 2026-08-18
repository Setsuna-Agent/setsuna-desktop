import type {
  ProviderConfigState,
  RuntimeAvailableModelsResponse,
  RuntimeConfigState,
  RuntimeFetchModelsInput,
  RuntimeMemoryPreview,
  RuntimeThread,
  RuntimeThreadSummary,
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import {
  Archive,
  Bot,
  CircleGauge,
  CloudCog,
  HardDrive,
  Info,
  Keyboard,
  Network,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { DesktopUpdaterStateView } from '../../app/controller/useDesktopUpdater.js';
import type { DesktopNetworkProxyStateView } from '../../app/controller/useDesktopNetworkProxy.js';
import { EmptyState, PageBackButton } from '../../shared/ui/primitives.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
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
import { TaskModelSettings } from './sections/TaskModelSettings.js';
import type { RuntimePreferenceInput, SettingsSectionId } from './settings-types.js';
import { KeyboardShortcutsSettings } from './shortcuts/KeyboardShortcutsSettings.js';
import { NetworkProxySettings } from './network-proxy/NetworkProxySettings.js';
import { UsageSettings } from './usage/UsageSettings.js';
import { WebDavSyncSettings } from './webdav-sync/WebDavSyncSettings.js';
import { SettingsPageHeading } from './SettingsPageHeading.js';

export { ArchivedThreadsSettings } from './sections/ArchivedThreadsSettings.js';

type SettingsSidebarSection = {
  id: SettingsSectionId;
  labelKey: MessageKey;
  icon: ReactNode;
};

type SettingsSidebarGroup = {
  id: string;
  labelKey: MessageKey;
  sections: readonly SettingsSidebarSection[];
};

const settingsSectionGroups = [
  {
    id: 'preferences',
    labelKey: 'settings.group.preferences',
    sections: [
      { id: 'general', labelKey: 'settings.section.general', icon: <SlidersHorizontal size={14} /> },
      { id: 'shortcuts', labelKey: 'settings.section.shortcuts', icon: <Keyboard size={14} /> },
      { id: 'personalization', labelKey: 'settings.section.personalization', icon: <Sparkles size={14} /> },
    ],
  },
  {
    id: 'models-and-services',
    labelKey: 'settings.group.modelsAndServices',
    sections: [
      { id: 'usage', labelKey: 'settings.section.usage', icon: <CircleGauge size={14} /> },
      { id: 'localLlm', labelKey: 'settings.section.localLlm', icon: <HardDrive size={14} /> },
      { id: 'networkProxy', labelKey: 'settings.section.networkProxy', icon: <Network size={14} /> },
      { id: 'sync', labelKey: 'settings.section.sync', icon: <CloudCog size={14} /> },
      { id: 'taskModels', labelKey: 'settings.section.taskModels', icon: <Bot size={14} /> },
    ],
  },
  {
    id: 'data-and-system',
    labelKey: 'settings.group.dataAndSystem',
    sections: [
      { id: 'archives', labelKey: 'settings.section.archives', icon: <Archive size={14} /> },
      { id: 'runtime', labelKey: 'settings.section.runtime', icon: <Wrench size={14} /> },
      { id: 'about', labelKey: 'settings.section.about', icon: <Info size={14} /> },
    ],
  },
] satisfies readonly SettingsSidebarGroup[];

const settingsSectionLabelKeys: Record<SettingsSectionId, MessageKey> = {
  general: 'settings.section.general',
  shortcuts: 'settings.section.shortcuts',
  personalization: 'settings.section.personalization',
  localLlm: 'settings.section.localLlm',
  networkProxy: 'settings.section.networkProxy',
  sync: 'settings.section.sync',
  taskModels: 'settings.section.taskModels',
  usage: 'settings.section.usage',
  archives: 'settings.section.archives',
  runtime: 'settings.section.runtime',
  about: 'settings.section.about',
};

const settingsSectionDescriptionKeys: Partial<Record<SettingsSectionId, MessageKey>> = {
  shortcuts: 'settings.section.shortcutsDescription',
  localLlm: 'settings.section.localLlmDescription',
  networkProxy: 'settings.section.networkProxyDescription',
  sync: 'settings.section.syncDescription',
  taskModels: 'settings.section.taskModelsDescription',
  usage: 'settings.section.usageDescription',
};

const EMPTY_PROVIDER_CONFIGS: ProviderConfigState[] = [];

export function SettingsPage({
  archivedThreads,
  config,
  initialSection,
  projects,
  skillExtraRoots,
  updater,
  usage,
  memoryPreview,
  memoryPreviewLoading,
  networkProxy,
  onBack,
  onFetchProviderModels,
  onSaveProviders,
  onSaveRuntimePreferences,
  onQueryUsage,
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
  initialSection?: SettingsSectionId;
  projects: WorkspaceProject[];
  skillExtraRoots: string[];
  updater: DesktopUpdaterStateView;
  usage: RuntimeUsageResponse | null;
  memoryPreview: RuntimeMemoryPreview | null;
  memoryPreviewLoading: boolean;
  networkProxy: DesktopNetworkProxyStateView;
  onBack: () => void;
  onFetchProviderModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSaveProviders: (
    providers: ProviderConfigState[],
    apiKeysByProviderId: Record<string, string>,
  ) => Promise<void>;
  onSaveRuntimePreferences: (input: RuntimePreferenceInput) => Promise<void>;
  onQueryUsage: (query: RuntimeUsageQuery) => Promise<RuntimeUsageResponse>;
  onPreviewMemories: () => Promise<RuntimeMemoryPreview>;
  onDeleteMemory: (memoryId: string) => Promise<void>;
  onResetMemories: () => Promise<void>;
  onDeleteAllArchivedThreads: (threadIds: string[]) => Promise<void>;
  onDeleteArchivedThread: (threadId: string) => Promise<void>;
  onRestoreArchivedThread: (threadId: string) => Promise<RuntimeThread>;
  onSetSkillExtraRoots: (roots: string[]) => Promise<void>;
}) {
  const { t } = useI18n();
  // initialSection 支持从聊天页引导卡片直达某个分区；设置页每次进入都会重新挂载，
  // 所以这里只需在挂载时取一次初始值。
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection ?? 'general');
  const [localModelSaveState, setLocalModelSaveState] = useState<SaveState>(() => idleSaveState());

  useEffect(() => {
    if (activeSection !== 'localLlm') setLocalModelSaveState(idleSaveState());
  }, [activeSection]);

  const content =
    activeSection === 'general' ? (
      <GeneralSettings config={config} onSave={onSaveRuntimePreferences} />
    ) : activeSection === 'shortcuts' ? (
      <KeyboardShortcutsSettings />
    ) : activeSection === 'localLlm' ? (
      config ? (
        <LocalModelSettings
          config={config}
          proxyServers={networkProxy.state?.servers ?? []}
          onFetchModels={onFetchProviderModels}
          onSave={onSaveProviders}
          onSaveStateChange={setLocalModelSaveState}
        />
      ) : (
        <EmptyState title={t('settings.configUnavailable')} />
      )
    ) : activeSection === 'usage' ? (
      <UsageSettings
        providers={config?.providers ?? EMPTY_PROVIDER_CONFIGS}
        usage={usage}
        onQueryUsage={onQueryUsage}
      />
    ) : activeSection === 'networkProxy' ? (
      <NetworkProxySettings proxy={networkProxy} />
    ) : activeSection === 'sync' ? (
      <WebDavSyncSettings />
    ) : activeSection === 'taskModels' ? (
      config ? (
        <TaskModelSettings config={config} onSave={onSaveRuntimePreferences} />
      ) : (
        <EmptyState title={t('settings.configUnavailable')} />
      )
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
        <EmptyState title={t('settings.configUnavailable')} />
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
      <EmptyState title={t('settings.configUnavailable')} />
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
          {activeSection === 'usage' ? null : (
            <SettingsPageHeading
              action={activeSection === 'localLlm' && localModelSaveState.status === 'error' && localModelSaveState.message ? (
                <AutoSaveStatus state={localModelSaveState} />
              ) : null}
              description={settingsSectionDescriptionKeys[activeSection]
                ? t(settingsSectionDescriptionKeys[activeSection])
                : undefined}
              title={t(settingsSectionLabelKeys[activeSection])}
            />
          )}
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
  const { t } = useI18n();
  return (
    <nav className="app-sidebar desktop-settings-sidebar chat-user-settings__nav">
      <PageBackButton
        block
        className="chat-user-settings__page-back"
        label={t('settings.back')}
        onClick={onBack}
      />
      <div className="chat-user-settings__title">{t('settings.title')}</div>
      <div className="chat-user-settings__tabs">
        {settingsSectionGroups.map((group) => {
          const titleId = `settings-sidebar-group-${group.id}`;
          return (
            <div
              key={group.id}
              aria-labelledby={titleId}
              className="chat-user-settings__tab-group"
              role="group"
            >
              <div id={titleId} className="chat-user-settings__tab-group-title">
                {t(group.labelKey)}
              </div>
              {group.sections.map((section) => (
                <button
                  key={section.id}
                  className={activeSection === section.id ? 'is-active' : ''}
                  type="button"
                  onClick={() => onSelectSection(section.id)}
                >
                  {section.icon}
                  <span>{t(section.labelKey)}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
