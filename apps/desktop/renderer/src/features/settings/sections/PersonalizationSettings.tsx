import type {
  RuntimeConfigState,
  RuntimeMemoryPreview,
  RuntimeMemoryPreviewItem,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { Popconfirm } from 'antd';
import { ChevronRight, Cpu, Eye, FileText, FolderOpen, Pencil, RefreshCw, Sun, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  SelectField,
  TextArea,
  TextField,
} from '../../../shared/ui/primitives.js';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { MemorySettingToggle, SettingsChoiceGroup, type SettingsChoiceOption } from '../components/SettingsControls.js';
import { memoryExtractModelOptions } from '../providers/provider-model.js';
import type { RuntimePreferenceInput } from '../settings-types.js';
import { errorMessage, formatSettingsDate } from '../settings-utils.js';

const PERSONALIZATION_PROMPT_MAX_LENGTH = 8000;
const PERSONALIZATION_PROMPT_SAVE_DELAY_MS = 360;
export function PersonalizationSettings({
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
  const { locale, t } = useI18n();
  const setsunaStyleOptions: Array<SettingsChoiceOption<RuntimeConfigState['setsunaStyle']>> = [
    { value: 'developer', label: t('settings.personalization.styleDeveloper'), icon: <Cpu size={14} /> },
    { value: 'daily', label: t('settings.personalization.styleDaily'), icon: <Sun size={14} /> },
  ];
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
      setMemoryError(t('settings.personalization.selectUnsupported'));
      return;
    }
    setSelectingStorage(true);
    setMemoryError(null);
    try {
      const selectedPath = await api.selectDirectory({ title: t('settings.personalization.selectDirectory') });
      if (selectedPath) await onSavePreferences({ storagePath: selectedPath });
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, t('settings.personalization.selectError')));
    } finally {
      setSelectingStorage(false);
    }
  };

  const loadMemoryPreview = async () => {
    setMemoryError(null);
    try {
      return await onPreview();
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, t('settings.personalization.previewError')));
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
      setMemoryError(errorMessage(unknownError, t('settings.personalization.deleteError')));
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
      setMemoryError(errorMessage(unknownError, t('settings.personalization.resetError')));
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
          title={t('settings.personalization.preview')}
          actions={
            <Button className="chat-user-settings__tiny-action" icon={<RefreshCw size={14} />} disabled={memoryPreviewLoading || memoryResetting || Boolean(memoryDeletingId)} onClick={() => void loadMemoryPreview()}>
              {memoryPreviewLoading ? t('settings.personalization.refreshing') : t('settings.personalization.refresh')}
            </Button>
          }
        />
        <div className="chat-user-settings__memory-preview-summary">
          <div>
            <strong>{t('settings.personalization.previewCount', { count: memoryPreview?.total ?? 0 })}</strong>
            <span>{t('settings.personalization.previewDescription')}</span>
          </div>
          <code title={previewStoragePath}>{previewStoragePath}</code>
        </div>
        {memoryError ? <div className="chat-user-settings__memory-error">{memoryError}</div> : null}
        <div className="chat-user-settings__memory-list" aria-busy={memoryPreviewLoading}>
          {items.length ? (
            items.map((item) => {
              const meta = [
                item.origin === 'active' ? t('settings.personalization.originActive') : t('settings.personalization.originBackground'),
                memoryScopeLabel(item, projects, t),
                item.source,
                formatSettingsDate(item.updatedAt, locale),
                t('settings.personalization.characters', { count: Number(item.chars || 0).toLocaleString(locale) }),
              ].filter(Boolean);

              return (
                <div className="chat-user-settings__memory-item" key={item.id}>
                  <div className="chat-user-settings__memory-item-head">
                    <FileText size={14} />
                    <span title={item.workspaceRoot || item.title}>{item.title}</span>
                    <IconButton label={t('settings.personalization.deleteMemory')} variant="danger" disabled={memoryResetting || memoryPreviewLoading || memoryDeletingId === item.id} onClick={() => void deleteMemoryItem(item)}>
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
            <EmptyState title={memoryPreviewLoading ? t('settings.personalization.loadingMemories') : t('settings.personalization.emptyMemories')} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__personalization-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.personalization.style')}</div>
        <div className="chat-user-settings__group chat-user-settings__personalization-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Pencil size={14} />
              <span>{t('settings.personalization.setsunaStyle')}</span>
            </span>
            <SettingsChoiceGroup ariaLabel={t('settings.personalization.setsunaStyle')} options={setsunaStyleOptions} value={config.setsunaStyle} onChange={(setsunaStyle) => void onSavePreferences({ setsunaStyle })} />
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group chat-user-settings__personalization-card chat-user-settings__personalization-card--prompt">
          <div className="chat-user-settings__prompt-stack">
            <div className="chat-user-settings__prompt-heading">
              <div className="chat-user-settings__prompt-title">
                <span>{t('settings.personalization.prompt')}</span>
              </div>
              <p>{t('settings.personalization.promptDescription')}</p>
            </div>
            <div className="chat-user-settings__prompt-control">
              <div className="chat-user-settings__prompt-input-shell">
                <TextArea
                  className="chat-user-settings__prompt-input"
                  value={globalPromptDraft}
                  maxLength={PERSONALIZATION_PROMPT_MAX_LENGTH}
                  placeholder={t('settings.personalization.promptPlaceholder')}
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
          <div className="chat-user-settings__group-title">{t('settings.personalization.memory')}</div>
          <p>{t('settings.personalization.memoryDescription')}</p>
        </div>
        {memoryError ? <div className="chat-user-settings__memory-error">{memoryError}</div> : null}
        <div className="chat-user-settings__group chat-user-settings__personalization-card">
          <MemorySettingToggle checked={config.memory.useMemories} description={t('settings.personalization.useMemoriesDescription')} label={t('settings.personalization.useMemories')} onChange={(checked) => void onSavePreferences({ memory: { useMemories: checked } })} />
          <MemorySettingToggle checked={config.memory.generateMemories} description={t('settings.personalization.generateMemoriesDescription')} label={t('settings.personalization.generateMemories')} onChange={(checked) => void onSavePreferences({ memory: { generateMemories: checked } })} />
          <MemoryExtractModelField config={config} onSavePreferences={onSavePreferences} />
          <MemorySettingToggle checked={config.memory.disableOnExternalContext} description={t('settings.personalization.externalContextDescription')} label={t('settings.personalization.externalContext')} onChange={(checked) => void onSavePreferences({ memory: { disableOnExternalContext: checked } })} />
          <MemorySettingToggle checked={config.memory.dedicatedTools} description={t('settings.personalization.memoryToolsDescription')} label={t('settings.personalization.memoryTools')} onChange={(checked) => void onSavePreferences({ memory: { dedicatedTools: checked } })} />
          <div className="chat-user-settings__row chat-user-settings__local-field">
            <span className="chat-user-settings__row-label">
              <FolderOpen size={14} />
              <span>{t('settings.personalization.storage')}</span>
            </span>
            <div className="chat-user-settings__local-storage-control">
              <TextField className="settings-local-control" value={storagePath} readOnly />
              <Button icon={<FolderOpen size={14} />} disabled={selectingStorage} onClick={() => void selectMemoryStoragePath()}>
                {selectingStorage ? t('settings.personalization.selecting') : t('settings.personalization.select')}
              </Button>
            </div>
          </div>
          <div className="chat-user-settings__row chat-user-settings__local-action-row">
            <span className="chat-user-settings__row-label">
              <Eye size={14} />
              <span>{t('settings.personalization.preview')}</span>
            </span>
            <Button className="chat-user-settings__preview-open" icon={<ChevronRight size={14} />} onClick={() => void openMemoryPreview()}>
              {t('settings.personalization.view')}
            </Button>
          </div>
          <div className="chat-user-settings__row chat-user-settings__local-action-row chat-user-settings__memory-reset-row">
            <span className="chat-user-settings__row-label">
              <RefreshCw size={14} />
              <span>{t('settings.personalization.resetMemory')}</span>
            </span>
            <Popconfirm title={t('settings.personalization.resetTitle')} description={t('settings.personalization.resetDescription')} placement="topRight" okText={t('settings.personalization.reset')} cancelText={t('common.cancel')} okButtonProps={{ danger: true, loading: memoryResetting }} onConfirm={() => void resetMemoryItems()}>
              <Button variant="danger" icon={<RefreshCw size={14} />} disabled={memoryPreviewLoading || Boolean(memoryDeletingId) || memoryResetting}>
                {memoryResetting ? t('settings.personalization.resetting') : t('settings.personalization.reset')}
              </Button>
            </Popconfirm>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryExtractModelField({ config, onSavePreferences }: { config: RuntimeConfigState; onSavePreferences: (input: RuntimePreferenceInput) => Promise<void> }) {
  const { t } = useI18n();
  if (!config.memory.generateMemories) return null;

  const options = memoryExtractModelOptions(config);
  const value = config.memory.extractModel?.trim() ?? '';
  const currentOptionExists = !value || options.some((option) => option.value === value);

  return (
    <label className="chat-user-settings__row chat-user-settings__memory-model-row">
      <span className="chat-user-settings__row-label chat-user-settings__memory-model-label">
        <span className="chat-user-settings__memory-toggle-copy">
          <span>{t('settings.personalization.extractModel')}</span>
          <small>{t('settings.personalization.extractModelDescription')}</small>
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
        <option value="">{t('settings.personalization.followCurrentModel')}</option>
        {!currentOptionExists ? (
          <option value={value} disabled>
            {t('settings.personalization.providerNotConfigured', { model: value })}
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

function memoryScopeLabel(item: RuntimeMemoryPreviewItem, projects: WorkspaceProject[], t: Translate): string {
  if (item.scope === 'global') return t('settings.personalization.scopeGlobal');
  const projectName = projects.find((project) => project.id === item.projectId)?.name;
  const project = projectName || item.projectId;
  return project ? t('settings.personalization.scopeProject', { project }) : t('settings.personalization.scopeProjectFallback');
}
