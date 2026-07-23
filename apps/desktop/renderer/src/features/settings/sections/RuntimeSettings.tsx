import {
  RUNTIME_DEVELOPER_FEATURES_FLAG,
  runtimeDeveloperFeaturesEnabled,
  type RuntimeConfigState,
  type RuntimeDesktopSettings,
} from '@setsuna-desktop/contracts';
import { ChevronRight, Database, FileCog, FolderOpen, Plus, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { localizedRuntimeAccessModeOptions } from '../../../shared/i18n/runtimeAccessModeCopy.js';
import {
  runtimeAccessModeSelection as accessModeSelection,
  runtimeAccessModeForConfig,
} from '../../../shared/lib/runtimeAccessMode.js';
import { RuntimeAccessModeMenu } from '../../../shared/ui/RuntimeAccessModeMenu.js';
import { Button, IconButton, TextArea, TextField } from '../../../shared/ui/primitives.js';
import { WorkspaceDependenciesSettings } from '../WorkspaceDependenciesSettings.js';
import { MemorySettingToggle } from '../components/SettingsControls.js';
import type { RuntimePreferenceInput } from '../settings-types.js';
import { errorMessage } from '../settings-utils.js';

export function RuntimePolicySettings({
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
  const { t } = useI18n();
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [localPathError, setLocalPathError] = useState<string | null>(null);

  const openRuntimePath = async (targetPath: string, label: string) => {
    const normalizedPath = targetPath.trim();
    if (!normalizedPath) {
      setLocalPathError(t('settings.runtime.pathEmpty', { label }));
      return;
    }
    const api = window.setsunaDesktop?.desktop;
    if (!api?.openPath) {
      setLocalPathError(t('settings.runtime.openUnsupported'));
      return;
    }
    setOpeningPath(normalizedPath);
    setLocalPathError(null);
    try {
      const result = await api.openPath(normalizedPath);
      if (!result.ok) setLocalPathError(result.error || t('settings.runtime.openError', { label }));
    } catch (unknownError) {
      setLocalPathError(errorMessage(unknownError, t('settings.runtime.openError', { label })));
    } finally {
      setOpeningPath(null);
    }
  };

  const isOpeningConfig = openingPath === config.configPath;
  const isOpeningData = openingPath === config.dataPath;
  const pathActionDisabled = Boolean(openingPath);
  const accessMode = runtimeAccessModeForConfig(config);
  const accessModeOptions = localizedRuntimeAccessModeOptions(t);
  const accessModeOption = accessModeOptions.find((option) => option.value === accessMode) ?? accessModeOptions[1];
  const persistWorkspaceDependencySettings = (
    settings: Partial<Pick<RuntimeDesktopSettings, 'npmRegistryUrl' | 'pythonPackageIndexUrl' | 'workspaceDependenciesEnabled'>>,
  ) => onSave({
    desktopSettings: {
      ...(config.desktopSettings ?? {}),
      ...settings,
    },
  });

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__runtime-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.runtime.permissions')}</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <label className="chat-user-settings__row chat-user-settings__runtime-policy-row">
            <span className="chat-user-settings__runtime-policy-copy">
              <ShieldCheck size={14} />
              <span>
                <strong>{t('settings.runtime.permissionPolicy')}</strong>
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
        npmRegistryUrl={typeof config.desktopSettings?.npmRegistryUrl === 'string' ? config.desktopSettings.npmRegistryUrl : ''}
        pythonPackageIndexUrl={typeof config.desktopSettings?.pythonPackageIndexUrl === 'string' ? config.desktopSettings.pythonPackageIndexUrl : ''}
        onEnabledPersist={(enabled) => persistWorkspaceDependencySettings({ workspaceDependenciesEnabled: enabled })}
        onNpmRegistryUrlPersist={(npmRegistryUrl) => persistWorkspaceDependencySettings({ npmRegistryUrl })}
        onPythonPackageIndexUrlPersist={(pythonPackageIndexUrl) => persistWorkspaceDependencySettings({ pythonPackageIndexUrl })}
      />

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.runtime.localStorage')}</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <FileCog size={14} />
              <span>{t('settings.runtime.configFile')}</span>
            </span>
            <div className="chat-user-settings__path-control">
              <code title={config.configPath}>{config.configPath}</code>
              <Button className="chat-user-settings__path-open" icon={<FolderOpen size={14} />} disabled={pathActionDisabled} onClick={() => void openRuntimePath(config.configPath, t('settings.runtime.configFile'))}>
                {isOpeningConfig ? t('common.opening') : t('common.open')}
              </Button>
            </div>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Database size={14} />
              <span>{t('settings.runtime.dataDirectory')}</span>
            </span>
            <div className="chat-user-settings__path-control">
              <code title={config.dataPath}>{config.dataPath}</code>
              <Button className="chat-user-settings__path-open" icon={<FolderOpen size={14} />} disabled={pathActionDisabled} onClick={() => void openRuntimePath(config.dataPath, t('settings.runtime.dataDirectory'))}>
                {isOpeningData ? t('common.opening') : t('common.open')}
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
  const { t } = useI18n();
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
          <strong>{t('settings.runtime.advanced')}</strong>
          <small>{t('settings.runtime.advancedDescription')}</small>
        </span>
        <span className="chat-user-settings__advanced-toggle" aria-hidden="true">
          <ChevronRight className="chat-user-settings__advanced-chevron" size={15} />
        </span>
      </summary>
      <div className="chat-user-settings__group chat-user-settings__runtime-card chat-user-settings__runtime-advanced">
        <MemorySettingToggle
          checked={runtimeDeveloperFeaturesEnabled(config)}
          description={t('settings.runtime.developerFeaturesDescription')}
          label={t('settings.runtime.developerFeatures')}
          onChange={(enabled) => void onSave({
            features: {
              ...(config.features ?? {}),
              [RUNTIME_DEVELOPER_FEATURES_FLAG]: enabled,
            },
          })}
        />
        <MemorySettingToggle
          checked={config.sandboxWorkspaceWrite?.networkAccess === true}
          description={t('settings.runtime.sandboxNetworkDescription')}
          label={t('settings.runtime.sandboxNetwork')}
          onChange={(networkAccess) => void onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), networkAccess } })}
        />
        <MemorySettingToggle
          checked={config.bypassHookTrust === true}
          description={t('settings.runtime.bypassHookTrustDescription')}
          label={t('settings.runtime.bypassHookTrust')}
          onChange={(bypassHookTrust) => void onSave({ bypassHookTrust })}
        />
        <RuntimeDirectoryListField
          description={t('settings.runtime.readableRootsDescription')}
          label={t('settings.runtime.readableRoots')}
          value={config.sandboxWorkspaceWrite?.readableRoots ?? []}
          onSave={(readableRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), readableRoots } })}
        />
        <RuntimeDirectoryListField
          description={t('settings.runtime.writableRootsDescription')}
          label={t('settings.runtime.writableRoots')}
          value={config.sandboxWorkspaceWrite?.writableRoots ?? []}
          onSave={(writableRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), writableRoots } })}
        />
        <RuntimeDirectoryListField
          description={t('settings.runtime.deniedRootsDescription')}
          label={t('settings.runtime.deniedRoots')}
          value={config.sandboxWorkspaceWrite?.deniedRoots ?? []}
          onSave={(deniedRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), deniedRoots } })}
        />
        <RuntimeTextListField
          description={t('settings.runtime.deniedGlobDescription')}
          label={t('settings.runtime.deniedGlob')}
          value={config.sandboxWorkspaceWrite?.deniedGlobPatterns ?? []}
          onSave={(deniedGlobPatterns) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), deniedGlobPatterns } })}
        />
        <RuntimeDirectoryListField
          description={t('settings.runtime.skillRootsDescription')}
          label={t('settings.runtime.skillRoots')}
          value={skillExtraRoots}
          onSave={onSetSkillExtraRoots}
        />
        <div className="chat-user-settings__runtime-json-field">
          <span>{t('settings.runtime.featureFlags')}</span>
          <TextArea rows={6} value={featureFlagsDraft} onChange={(event) => setFeatureFlagsDraft(event.currentTarget.value)} />
          <Button onClick={() => {
            try {
              const parsed = JSON.parse(featureFlagsDraft) as unknown;
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('settings.runtime.featureFlagsObject'));
              const flags = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
              setAdvancedError(null);
              void onSave({ features: flags });
            } catch (unknownError) {
              setAdvancedError(errorMessage(unknownError, t('settings.runtime.featureFlagsInvalid')));
            }
          }}>{t('settings.runtime.saveFeatureFlags')}</Button>
        </div>
        <div className="chat-user-settings__runtime-memory-tuning">
          <strong>{t('settings.runtime.memoryTuning')}</strong>
          <TextField
            defaultValue={config.memory.consolidationModel ?? ''}
            placeholder={t('settings.runtime.consolidationModel')}
            onBlur={(event) => void onSave({ memory: { consolidationModel: event.currentTarget.value.trim() || undefined } })}
          />
          <TextField
            type="number"
            min="1"
            defaultValue={config.memory.maxRolloutsPerStartup ?? ''}
            placeholder={t('settings.runtime.maxRollouts')}
            onBlur={(event) => void onSave({ memory: { maxRolloutsPerStartup: optionalPositiveNumber(event.currentTarget.value) } })}
          />
          <TextField
            type="number"
            min="1"
            defaultValue={config.memory.maxRawMemoriesForConsolidation ?? ''}
            placeholder={t('settings.runtime.maxRawMemories')}
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
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (items: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(items);
      return true;
    } catch (unknownError) {
      setError(errorMessage(unknownError, t('settings.runtime.saveError', { label })));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addDirectory = async () => {
    const api = window.setsunaDesktop?.desktop;
    if (!api?.selectDirectory) {
      setError(t('settings.runtime.selectUnsupported'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const selected = await api.selectDirectory({ title: t('settings.runtime.selectLabel', { label }) });
      if (selected && !value.includes(selected)) await onSave([...value, selected]);
    } catch (unknownError) {
      setError(errorMessage(unknownError, t('settings.runtime.addError', { label })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RuntimeListEditor
      action={<Button icon={<FolderOpen size={14} />} disabled={busy} onClick={() => void addDirectory()}>{busy ? t('common.processing') : t('settings.runtime.addDirectory')}</Button>}
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
  const { t } = useI18n();
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
      setError(errorMessage(unknownError, t('settings.runtime.saveError', { label })));
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
          <TextField aria-label={t('settings.runtime.addLabel', { label })} disabled={busy} placeholder={t('settings.runtime.rulePlaceholder')} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
          <Button icon={<Plus size={14} />} disabled={busy || !draft.trim()} type="submit">{t('common.add')}</Button>
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
  const { t } = useI18n();
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
              <IconButton label={t('settings.runtime.removeLabel', { item })} disabled={busy} onClick={() => onRemove(item)}><X size={14} /></IconButton>
            </div>
          ))}
        </div>
      ) : (
        <span className="chat-user-settings__runtime-list-empty">{t('common.noneAdded')}</span>
      )}
      {error ? <span className="chat-user-settings__runtime-list-error" role="alert">{error}</span> : null}
    </div>
  );
}

function optionalPositiveNumber(value: string): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}
