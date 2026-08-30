import type {
  RuntimeConfigState,
  RuntimeThread,
  RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import {
  settingsPageSlot,
  type SettingsPageEntryDescriptor,
} from '@setsuna-desktop/renderer-contracts/settings';
import {
  Puzzle,
} from 'lucide-react';
import { useState } from 'react';
import {
  RendererOwnedKeyedSlot,
  useRendererOwnedKeyedEntries,
} from '../../kernel/renderer-plugins/RendererKernelProvider.js';
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
  RuntimePreferenceInput,
  SettingsSectionId,
} from './settings-types.js';
import { KeyboardShortcutsSettings } from './shortcuts/KeyboardShortcutsSettings.js';
import { SettingsSectionExtensionOutlet } from './SettingsSectionExtensionOutlet.js';

export { ArchivedThreadsSettings } from './sections/ArchivedThreadsSettings.js';

type SettingsSidebarGroup = {
  id: string;
  labelKey: MessageKey;
};

const settingsSectionGroups = [
  {
    id: 'preferences',
    labelKey: 'settings.group.preferences',
  },
  {
    id: 'models-and-services',
    labelKey: 'settings.group.modelsAndServices',
  },
  {
    id: 'data-and-system',
    labelKey: 'settings.group.dataAndSystem',
  },
] satisfies readonly SettingsSidebarGroup[];

export function SettingsPage({
  archivedThreads,
  config,
  initialSection,
  onBack,
  onSaveRuntimePreferences,
  onDeleteAllArchivedThreads,
  onDeleteArchivedThread,
  onRestoreArchivedThread,
}: {
  archivedThreads: RuntimeThreadSummary[];
  config: RuntimeConfigState | null;
  initialSection?: SettingsSectionId;
  onBack: () => void;
  onSaveRuntimePreferences: (input: RuntimePreferenceInput) => Promise<void>;
  onDeleteAllArchivedThreads: (threadIds: string[]) => Promise<void>;
  onDeleteArchivedThread: (threadId: string) => Promise<void>;
  onRestoreArchivedThread: (threadId: string) => Promise<RuntimeThread>;
}) {
  const { t } = useI18n();
  const pages = useRendererOwnedKeyedEntries(settingsPageSlot)
    .filter((entry) => entry.metadata.location === 'settings')
    .sort(compareSettingsPages);
  // initialSection 支持从聊天页引导卡片直达某个分区；设置页每次进入都会重新挂载，
  // 所以这里只需在挂载时取一次初始值。
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection ?? 'general');
  const selectedPage = pages.find((entry) => entry.metadata.sectionId === activeSection)
    ?? pages.find((entry) => entry.metadata.sectionId === 'general');
  const resolvedSection = selectedPage?.metadata.sectionId ?? 'general';
  const translateFeature: RendererTranslate = t;

  const defaultContent = resolvedSection === 'general' ? (
      <GeneralSettings config={config} onSave={onSaveRuntimePreferences} />
    ) : resolvedSection === 'shortcuts' ? (
      <KeyboardShortcutsSettings />
    ) : resolvedSection === 'taskModels' ? (
      config ? (
        <TaskModelSettings config={config} onSave={onSaveRuntimePreferences} />
      ) : (
        <EmptyState title={t('settings.configUnavailable')} />
      )
    ) : resolvedSection === 'archives' ? (
      <ArchivedThreadsSettings
        threads={archivedThreads}
        onDeleteAll={onDeleteAllArchivedThreads}
        onDelete={onDeleteArchivedThread}
        onRestore={onRestoreArchivedThread}
      />
    ) : resolvedSection === 'personalization' ? (
      config ? (
        <PersonalizationSettings config={config} onSavePreferences={onSaveRuntimePreferences} />
      ) : (
        <EmptyState title={t('settings.configUnavailable')} />
      )
    ) : resolvedSection === 'about' ? (
      null
    ) : resolvedSection === 'runtime' && config ? (
      <RuntimePolicySettings
        config={config}
        onSave={onSaveRuntimePreferences}
      />
    ) : resolvedSection === 'runtime' ? (
      <EmptyState title={t('settings.configUnavailable')} />
    ) : (
      <EmptyState title={t('settings.configUnavailable')} />
    );

  const trailingContent = resolvedSection === 'runtime' && config ? (
    <RuntimeAdvancedSettings
      config={config}
      onSave={onSaveRuntimePreferences}
    />
  ) : null;

  const title = selectedPage
    ? translateSettingsKey(t, selectedPage.metadata.titleKey)
    : t('settings.configUnavailable');
  const description = selectedPage?.metadata.descriptionKey
    ? translateSettingsKey(t, selectedPage.metadata.descriptionKey)
    : undefined;

  return (
    <>
      <SettingsSidebar
        activeSection={resolvedSection}
        pages={pages}
        onBack={onBack}
        onSelectSection={setActiveSection}
      />
      <main className="desktop-settings-panel">
        <section
          className={`chat-user-settings__content ${
            selectedPage?.metadata.layout === 'wide' ? 'chat-user-settings__content--wide' : ''
          }`}
          data-settings-feature={selectedPage?.owner.featureId}
        >
          {selectedPage?.metadata.pageHeading !== 'view' ? (
            <SettingsPageHeading
              description={description}
              title={title}
            />
          ) : null}
          <SettingsSectionExtensionOutlet
            key={resolvedSection}
            sectionId={resolvedSection}
            trailingContent={trailingContent}
            translate={translateFeature}
            ui={settingsViewUi}
          >
            {selectedPage ? (
              <RendererOwnedKeyedSlot
                entryKey={selectedPage.key}
                slot={settingsPageSlot}
                props={{
                  renderDefault: () => defaultContent,
                  sectionId: resolvedSection,
                  translate: translateFeature,
                  ui: settingsViewUi,
                }}
              />
            ) : defaultContent}
          </SettingsSectionExtensionOutlet>
        </section>
      </main>
    </>
  );
}

export function SettingsSidebar({
  activeSection,
  pages,
  onBack,
  onSelectSection,
}: {
  activeSection: SettingsSectionId;
  pages: readonly SettingsPageEntryDescriptor[];
  onBack: () => void;
  onSelectSection: (section: SettingsSectionId) => void;
}) {
  const { t } = useI18n();
  const { byGroup, ungrouped } = partitionSettingsPages(pages);
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
              {(byGroup.get(group.id) ?? []).map((page) => (
                <SettingsPageButton
                  key={page.entryId}
                  active={activeSection === page.metadata.sectionId}
                  page={page}
                  translate={t}
                  onSelect={() => onSelectSection(page.metadata.sectionId)}
                />
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
            {ungrouped.map((page) => (
              <SettingsPageButton
                key={page.entryId}
                active={activeSection === page.metadata.sectionId}
                page={page}
                translate={t}
                onSelect={() => onSelectSection(page.metadata.sectionId)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function SettingsPageButton({
  active,
  onSelect,
  page,
  translate,
}: Readonly<{
  active: boolean;
  onSelect(): void;
  page: SettingsPageEntryDescriptor;
  translate: ReturnType<typeof useI18n>['t'];
}>) {
  const Icon = page.metadata.icon ?? Puzzle;
  return (
    <button className={active ? 'is-active' : ''} type="button" onClick={onSelect}>
      <Icon size={14} />
      <span>{translateSettingsKey(translate, page.metadata.titleKey)}</span>
    </button>
  );
}

function partitionSettingsPages(pages: readonly SettingsPageEntryDescriptor[]) {
  const knownGroups = new Set(settingsSectionGroups.map((group) => group.id));
  const byGroup = new Map<string, SettingsPageEntryDescriptor[]>();
  const ungrouped: SettingsPageEntryDescriptor[] = [];
  for (const page of pages) {
    const groupId = page.metadata.navigationGroupId;
    if (!groupId || !knownGroups.has(groupId)) {
      ungrouped.push(page);
      continue;
    }
    const group = byGroup.get(groupId) ?? [];
    group.push(page);
    byGroup.set(groupId, group);
  }
  for (const group of byGroup.values()) group.sort(compareSettingsPages);
  ungrouped.sort(compareSettingsPages);
  return { byGroup, ungrouped };
}

function compareSettingsPages(left: SettingsPageEntryDescriptor, right: SettingsPageEntryDescriptor): number {
  return left.metadata.order - right.metadata.order || left.entryId.localeCompare(right.entryId);
}

function translateSettingsKey(translate: ReturnType<typeof useI18n>['t'], key: string): string {
  return key.startsWith('feature.')
    ? (translate as RendererTranslate)(key as `feature.${string}`)
    : translate(key as MessageKey);
}
