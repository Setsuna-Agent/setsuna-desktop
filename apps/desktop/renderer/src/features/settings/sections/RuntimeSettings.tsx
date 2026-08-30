import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { ChevronRight, FileJson2, Plus, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { localizedRuntimeAccessModeOptions } from '../../../shared/i18n/runtimeAccessModeCopy.js';
import {
  runtimeAccessModeSelection as accessModeSelection,
  runtimeAccessModeForConfig,
} from '../../../shared/lib/runtimeAccessMode.js';
import { RuntimeAccessModeMenu } from '../../../shared/ui/RuntimeAccessModeMenu.js';
import {
  SettingsDirectoryList,
  SettingsListEditor,
} from '../../../shared/ui/SettingsListFields.js';
import { SettingsToggle } from '../../../shared/ui/SettingsViewUi.js';
import { Button, TextArea, TextField } from '../../../shared/ui/primitives.js';
import { SettingsPathValue } from '../components/SettingsPathValue.js';
import { DataLocationSettings } from '../data-root/DataLocationSettings.js';
import type { RuntimePreferenceInput } from '../settings-types.js';
import { errorMessage } from '../settings-utils.js';

export function RuntimePolicySettings({
  config,
  onSave,
}: {
  config: RuntimeConfigState;
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
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
  const pathActionDisabled = Boolean(openingPath);
  const accessMode = runtimeAccessModeForConfig(config);
  const accessModeOptions = localizedRuntimeAccessModeOptions(t);
  const accessModeOption = accessModeOptions.find((option) => option.value === accessMode) ?? accessModeOptions[1];
  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__runtime-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.runtime.permissions')}</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <label className="chat-user-settings__row chat-user-settings__runtime-policy-row">
            <span className="chat-user-settings__runtime-policy-copy">
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

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.runtime.localStorage')}</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <div className="chat-user-settings__row chat-user-settings__path-row">
            <span className="chat-user-settings__row-label">
              <span>{t('settings.runtime.configFile')}</span>
            </span>
            <div className="chat-user-settings__path-actions">
              <Button
                className="chat-user-settings__path-open"
                icon={<FileJson2 size={14} />}
                disabled={pathActionDisabled}
                onClick={() => void openRuntimePath(config.configPath, t('settings.runtime.configFile'))}
              >
                {isOpeningConfig ? t('common.opening') : t('common.open')}
              </Button>
            </div>
            <SettingsPathValue path={config.configPath} />
          </div>
          <DataLocationSettings fallbackRoot={config.dataPath} />
        </div>
        {localPathError ? <div className="chat-user-settings__runtime-error">{localPathError}</div> : null}
      </div>
    </div>
  );
}

export function RuntimeAdvancedSettings({
  config,
  onSave,
}: {
  config: RuntimeConfigState;
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [featureFlagsDraft, setFeatureFlagsDraft] = useState(() => JSON.stringify(config.features ?? {}, null, 2));
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  useEffect(() => {
    setFeatureFlagsDraft(JSON.stringify(config.features ?? {}, null, 2));
  }, [config.features]);

  return (
    <div className="chat-user-settings__section chat-user-settings__runtime-advanced-section">
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
          <SettingsToggle
            checked={config.desktopSettings?.showThinkingInTranscript === true}
            description={t('settings.runtime.showThinkingDescription')}
            label={t('settings.runtime.showThinking')}
            onChange={(showThinkingInTranscript) => void onSave({
              desktopSettings: {
                ...(config.desktopSettings ?? {}),
                showThinkingInTranscript,
              },
            })}
          />
          <SettingsToggle
            checked={config.sandboxWorkspaceWrite?.networkAccess === true}
            description={t('settings.runtime.sandboxNetworkDescription')}
            label={t('settings.runtime.sandboxNetwork')}
            onChange={(networkAccess) => void onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), networkAccess } })}
          />
          <SettingsToggle
            checked={config.bypassHookTrust === true}
            description={t('settings.runtime.bypassHookTrustDescription')}
            label={t('settings.runtime.bypassHookTrust')}
            onChange={(bypassHookTrust) => void onSave({ bypassHookTrust })}
          />
          <SettingsDirectoryList
            description={t('settings.runtime.readableRootsDescription')}
            label={t('settings.runtime.readableRoots')}
            value={config.sandboxWorkspaceWrite?.readableRoots ?? []}
            onSave={(readableRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), readableRoots } })}
          />
          <SettingsDirectoryList
            description={t('settings.runtime.writableRootsDescription')}
            label={t('settings.runtime.writableRoots')}
            value={config.sandboxWorkspaceWrite?.writableRoots ?? []}
            onSave={(writableRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), writableRoots } })}
          />
          <SettingsDirectoryList
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
        </div>
        {advancedError ? <div className="chat-user-settings__runtime-error">{advancedError}</div> : null}
      </details>
    </div>
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
    <SettingsListEditor
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
