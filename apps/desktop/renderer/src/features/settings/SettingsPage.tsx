import type {
  RuntimeConfigState,
  RuntimeThread,
  RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import type { RegisteredSettingsView, RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import {
  Archive,
  Bot,
  Info,
  Keyboard,
  Puzzle,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useRendererFeatureViews } from '../../composition/feature-view-registries.js';
import { EmptyState, PageBackButton } from '../../shared/ui/primitives.js';
import { SettingsPageHeading, settingsViewUi } from '../../shared/ui/SettingsViewUi.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import { ArchivedThreadsSettings } from './sections/ArchivedThreadsSettings.js';
import { GeneralSettings } from './sections/GeneralSettings.js';
import { PersonalizationSettings } from './sections/PersonalizationSettings.js';
import { RuntimeAdvancedSettings, RuntimePolicySettings } from './sections/RuntimeSettings.js';
import { TaskModelSettings } from './sections/TaskModelSettings.js';
import type {
  CoreSettingsSectionId,
  RuntimePreferenceInput,
  SettingsSectionId,
} from './settings-types.js';
import { KeyboardShortcutsSettings } from './shortcuts/KeyboardShortcutsSettings.js';
import { SettingsSectionExtensionOutlet } from './SettingsSectionExtensionOutlet.js';

export { ArchivedThreadsSettings } from './sections/ArchivedThreadsSettings.js';

type SettingsSidebarSection = {
  id: SettingsSectionId;
  labelKey: MessageKey;
  icon: ReactNode;
  order: number;
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
      { id: 'general', labelKey: 'settings.section.general', icon: <SlidersHorizontal size={14} />, order: 100 },
      { id: 'shortcuts', labelKey: 'settings.section.shortcuts', icon: <Keyboard size={14} />, order: 200 },
      { id: 'personalization', labelKey: 'settings.section.personalization', icon: <Sparkles size={14} />, order: 300 },
    ],
  },
  {
    id: 'models-and-services',
    labelKey: 'settings.group.modelsAndServices',
    sections: [
      { id: 'taskModels', labelKey: 'settings.section.taskModels', icon: <Bot size={14} />, order: 300 },
    ],
  },
  {
    id: 'data-and-system',
    labelKey: 'settings.group.dataAndSystem',
    sections: [
      { id: 'archives', labelKey: 'settings.section.archives', icon: <Archive size={14} />, order: 100 },
      { id: 'runtime', labelKey: 'settings.section.runtime', icon: <Wrench size={14} />, order: 200 },
      { id: 'about', labelKey: 'settings.section.about', icon: <Info size={14} />, order: 300 },
    ],
  },
] satisfies readonly SettingsSidebarGroup[];

const settingsSectionLabelKeys: Record<CoreSettingsSectionId, MessageKey> = {
  general: 'settings.section.general',
  shortcuts: 'settings.section.shortcuts',
  personalization: 'settings.section.personalization',
  taskModels: 'settings.section.taskModels',
  archives: 'settings.section.archives',
  runtime: 'settings.section.runtime',
  about: 'settings.section.about',
};

const settingsSectionDescriptionKeys: Partial<Record<CoreSettingsSectionId, MessageKey>> = {
  shortcuts: 'settings.section.shortcutsDescription',
  taskModels: 'settings.section.taskModelsDescription',
};

export function SettingsPage({
  archivedThreads,
  config,
  initialSection,
  skillExtraRoots,
  onBack,
  onSaveRuntimePreferences,
  onDeleteAllArchivedThreads,
  onDeleteArchivedThread,
  onRestoreArchivedThread,
  onSetSkillExtraRoots,
}: {
  archivedThreads: RuntimeThreadSummary[];
  config: RuntimeConfigState | null;
  initialSection?: SettingsSectionId;
  skillExtraRoots: string[];
  onBack: () => void;
  onSaveRuntimePreferences: (input: RuntimePreferenceInput) => Promise<void>;
  onDeleteAllArchivedThreads: (threadIds: string[]) => Promise<void>;
  onDeleteArchivedThread: (threadId: string) => Promise<void>;
  onRestoreArchivedThread: (threadId: string) => Promise<RuntimeThread>;
  onSetSkillExtraRoots: (roots: string[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const featureViews = useRendererFeatureViews();
  const featureSections = featureViews.settings.list('settings');
  // initialSection 支持从聊天页引导卡片直达某个分区；设置页每次进入都会重新挂载，
  // 所以这里只需在挂载时取一次初始值。
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection ?? 'general');
  const activeFeatureSection = featureSections.find((section) => section.sectionId === activeSection);
  const activeSectionExtensions = featureViews.settings.listSectionExtensions(activeSection);
  const translateFeature: RendererTranslate = t;

  const FeatureSettingsContent = activeFeatureSection?.render;
  const content = FeatureSettingsContent ? (
    <FeatureSettingsContent
      sectionId={activeFeatureSection.sectionId}
      translate={translateFeature}
      ui={settingsViewUi}
    />
  ) : activeSection === 'general' ? (
      <GeneralSettings config={config} onSave={onSaveRuntimePreferences} />
    ) : activeSection === 'shortcuts' ? (
      <KeyboardShortcutsSettings />
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
        <PersonalizationSettings config={config} onSavePreferences={onSaveRuntimePreferences} />
      ) : (
        <EmptyState title={t('settings.configUnavailable')} />
      )
    ) : activeSection === 'about' ? (
      null
    ) : activeSection === 'runtime' && config ? (
      <RuntimePolicySettings
        config={config}
        onSave={onSaveRuntimePreferences}
      />
    ) : activeSection === 'runtime' ? (
      <EmptyState title={t('settings.configUnavailable')} />
    ) : (
      <EmptyState title={t('settings.configUnavailable')} />
    );

  const trailingContent = activeSection === 'runtime' && config ? (
    <RuntimeAdvancedSettings
      config={config}
      skillExtraRoots={skillExtraRoots}
      onSave={onSaveRuntimePreferences}
      onSetSkillExtraRoots={onSetSkillExtraRoots}
    />
  ) : null;

  const coreSection = activeSection as CoreSettingsSectionId;
  const coreDescriptionKey = settingsSectionDescriptionKeys[coreSection];
  const title = activeFeatureSection
    ? translateFeature(activeFeatureSection.titleKey as `feature.${string}`)
    : t(settingsSectionLabelKeys[coreSection]);
  const description = activeFeatureSection?.descriptionKey
    ? translateFeature(activeFeatureSection.descriptionKey as `feature.${string}`)
    : coreDescriptionKey ? t(coreDescriptionKey) : undefined;

  return (
    <>
      <SettingsSidebar
        activeSection={activeSection}
        featureSections={featureSections}
        onBack={onBack}
        onSelectSection={setActiveSection}
      />
      <main className="desktop-settings-panel">
        <section
          className={`chat-user-settings__content ${
            activeFeatureSection?.layout === 'wide' ? 'chat-user-settings__content--wide' : ''
          }`}
          data-settings-feature={activeFeatureSection?.featureId}
        >
          {activeFeatureSection?.pageHeading !== 'view' ? (
            <SettingsPageHeading
              description={description}
              title={title}
            />
          ) : null}
          <SettingsSectionExtensionOutlet
            key={activeSection}
            extensions={activeSectionExtensions}
            sectionId={activeSection}
            trailingContent={trailingContent}
            translate={translateFeature}
            ui={settingsViewUi}
          >
            {content}
          </SettingsSectionExtensionOutlet>
        </section>
      </main>
    </>
  );
}

export function SettingsSidebar({
  activeSection,
  featureSections,
  onBack,
  onSelectSection,
}: {
  activeSection: SettingsSectionId;
  featureSections: readonly RegisteredSettingsView[];
  onBack: () => void;
  onSelectSection: (section: SettingsSectionId) => void;
}) {
  const { t } = useI18n();
  const { byGroup, ungrouped } = partitionFeatureSections(featureSections);
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
              {mergeSettingsGroupSections(group.sections, byGroup.get(group.id) ?? []).map((item) => (
                item.kind === 'core' ? (
                  <button
                    key={item.section.id}
                    className={activeSection === item.section.id ? 'is-active' : ''}
                    type="button"
                    onClick={() => onSelectSection(item.section.id)}
                  >
                    {item.section.icon}
                    <span>{t(item.section.labelKey)}</span>
                  </button>
                ) : (
                  <SettingsFeatureSectionButton
                    key={item.section.sectionId}
                    active={activeSection === item.section.sectionId}
                    section={item.section}
                    translate={t}
                    onSelect={() => onSelectSection(item.section.sectionId)}
                  />
                )
              ))}
            </div>
          );
        })}
        {ungrouped.length ? (
          <div
            aria-labelledby="settings-sidebar-group-features"
            className="chat-user-settings__tab-group"
            role="group"
          >
            <div id="settings-sidebar-group-features" className="chat-user-settings__tab-group-title">
              {t('settings.group.features')}
            </div>
            {ungrouped.map((section) => (
              <SettingsFeatureSectionButton
                key={section.sectionId}
                active={activeSection === section.sectionId}
                section={section}
                translate={t}
                onSelect={() => onSelectSection(section.sectionId)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function SettingsFeatureSectionButton({
  active,
  onSelect,
  section,
  translate,
}: Readonly<{
  active: boolean;
  onSelect(): void;
  section: RegisteredSettingsView;
  translate: ReturnType<typeof useI18n>['t'];
}>) {
  const Icon = section.icon ?? Puzzle;
  return (
    <button className={active ? 'is-active' : ''} type="button" onClick={onSelect}>
      <Icon size={14} />
      <span>{translateFeatureTitle(translate, section.titleKey)}</span>
    </button>
  );
}

function partitionFeatureSections(featureSections: readonly RegisteredSettingsView[]) {
  const knownGroups = new Set(settingsSectionGroups.map((group) => group.id));
  const byGroup = new Map<string, RegisteredSettingsView[]>();
  const ungrouped: RegisteredSettingsView[] = [];
  for (const section of featureSections) {
    const groupId = section.navigationGroupId;
    if (!groupId || !knownGroups.has(groupId)) {
      ungrouped.push(section);
      continue;
    }
    const group = byGroup.get(groupId) ?? [];
    group.push(section);
    byGroup.set(groupId, group);
  }
  return { byGroup, ungrouped };
}

function mergeSettingsGroupSections(
  coreSections: readonly SettingsSidebarSection[],
  featureSections: readonly RegisteredSettingsView[],
) {
  return [
    ...coreSections.map((section) => ({ kind: 'core' as const, order: section.order, section })),
    ...featureSections.map((section) => ({ kind: 'feature' as const, order: section.order, section })),
  ].sort((left, right) => left.order - right.order);
}

function translateFeatureTitle(translate: ReturnType<typeof useI18n>['t'], key: string): string {
  return (translate as RendererTranslate)(key as `feature.${string}`);
}
