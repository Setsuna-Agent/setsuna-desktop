import type { RuntimeWorkspaceDependenciesStatus } from '@setsuna-desktop/contracts';
import {
  DEFAULT_NPM_REGISTRY_URL,
  DEFAULT_PYTHON_PACKAGE_INDEX_URL,
  normalizeNpmRegistryUrl,
  normalizePythonPackageIndexUrl,
} from '@setsuna-desktop/contracts';
import {
  CircleGauge,
  Code2,
  Download,
  Pencil,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { Button, IconButton, TextField } from '../../shared/ui/primitives.js';
import { useWorkspaceDependencies } from '../workspace/hooks/useWorkspaceDependencies.js';
import { planPackageSourceSave } from './packageSourceEditor.js';

type WorkspaceDependenciesSettingsProps = {
  npmRegistryUrl: string;
  onEnabledPersist: (enabled: boolean) => Promise<void>;
  onNpmRegistryUrlPersist: (registryUrl: string | undefined) => Promise<void>;
  onPythonPackageIndexUrlPersist: (packageIndexUrl: string | undefined) => Promise<void>;
  pythonPackageIndexUrl: string;
};

export function WorkspaceDependenciesSettings({
  npmRegistryUrl,
  onEnabledPersist,
  onNpmRegistryUrlPersist,
  onPythonPackageIndexUrlPersist,
  pythonPackageIndexUrl,
}: WorkspaceDependenciesSettingsProps) {
  const { t } = useI18n();
  const dependencies = useWorkspaceDependencies();
  const [persistError, setPersistError] = useState<string | null>(null);
  const busy = dependencies.busyAction !== null;
  const status = dependencies.status;
  const setEnabled = async (enabled: boolean) => {
    setPersistError(null);
    const nextStatus = await dependencies.setEnabled(enabled);
    if (!nextStatus) return;
    try {
      await onEnabledPersist(nextStatus.enabled);
    } catch (unknownError) {
      setPersistError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  return (
    <div className="chat-user-settings__section-block workspace-dependencies-settings">
      <div className="chat-user-settings__group-title">{t('settings.dependencies.title')}</div>
      <div className="chat-user-settings__group chat-user-settings__runtime-card workspace-dependencies-settings__card">
        <div className="chat-user-settings__row chat-user-settings__runtime-policy-row workspace-dependencies-settings__toggle-row">
          <span className="chat-user-settings__runtime-policy-copy">
            <Code2 className="workspace-dependencies-settings__leading-icon" aria-hidden="true" />
            <span>
              <strong>{t('settings.dependencies.tools')}</strong>
              <small>{t('settings.dependencies.toolsDescription')}</small>
            </span>
          </span>
          <div className="workspace-dependencies-settings__toggle-control">
            <span>{status ? (status.enabled ? t('settings.dependencies.automatic') : t('settings.dependencies.disabled')) : t('settings.dependencies.reading')}</span>
            <label className="sd-check" title={t('settings.dependencies.automaticLabel')}>
              <input
                aria-label={t('settings.dependencies.automaticLabel')}
                checked={status?.enabled === true}
                disabled={busy}
                type="checkbox"
                onChange={(event) => void setEnabled(event.currentTarget.checked)}
              />
            </label>
          </div>
        </div>

        <PackageSourceForm
          defaultValue={DEFAULT_NPM_REGISTRY_URL}
          id="workspace-npm-registry"
          icon="npm"
          label={t('settings.dependencies.npmSource')}
          normalize={normalizeNpmRegistryUrl}
          placeholder={DEFAULT_NPM_REGISTRY_URL}
          value={npmRegistryUrl}
          onPersist={onNpmRegistryUrlPersist}
        />
        <PackageSourceForm
          defaultValue={DEFAULT_PYTHON_PACKAGE_INDEX_URL}
          id="workspace-python-package-index"
          icon="python"
          label={t('settings.dependencies.pythonSource')}
          normalize={normalizePythonPackageIndexUrl}
          placeholder={DEFAULT_PYTHON_PACKAGE_INDEX_URL}
          value={pythonPackageIndexUrl}
          onPersist={onPythonPackageIndexUrlPersist}
        />

        <div className="chat-user-settings__row workspace-dependencies-settings__status-row">
          <span className="chat-user-settings__runtime-policy-copy">
            <CircleGauge className="workspace-dependencies-settings__leading-icon" aria-hidden="true" />
            <span>
              <strong>{t('settings.dependencies.environment')}</strong>
              <small>{environmentStatusCopy(status, t)}</small>
            </span>
          </span>
          <div className="workspace-dependencies-settings__action-buttons">
            <Button
              icon={dependencies.busyAction === 'diagnose'
                ? <RefreshCw className="is-spinning" size={14} />
                : <RefreshCw size={14} />}
              disabled={busy}
              onClick={() => void dependencies.diagnose()}
            >
              {dependencies.busyAction === 'diagnose' ? t('settings.dependencies.checking') : t('settings.dependencies.check')}
            </Button>
            <Button
              icon={dependencies.busyAction === 'reinstall'
                ? <RefreshCw className="is-spinning" size={14} />
                : <Download size={14} />}
              disabled={busy || status?.enabled !== true}
              onClick={() => void dependencies.reinstall()}
            >
              {dependencies.busyAction === 'reinstall' ? t('settings.dependencies.installing') : t('settings.dependencies.reinstall')}
            </Button>
          </div>
        </div>

        {dependencies.error || persistError ? (
          <div className="chat-user-settings__runtime-error" role="alert">{dependencies.error ?? persistError}</div>
        ) : null}
      </div>
    </div>
  );
}

type PackageSourceKind = 'npm' | 'python';

type PackageSourceFormProps = {
  defaultValue: string;
  id: string;
  icon: PackageSourceKind;
  label: string;
  normalize: (value: unknown) => string | null;
  onPersist: (value: string | undefined) => Promise<void>;
  placeholder: string;
  value: string;
};

function PackageSourceForm({
  defaultValue,
  id,
  icon,
  label,
  normalize,
  onPersist,
  placeholder,
  value,
}: PackageSourceFormProps) {
  const { t } = useI18n();
  const effectiveValue = value || defaultValue;
  const [draft, setDraft] = useState(effectiveValue);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const errorId = `${id}-error`;
  const customized = Boolean(value && value !== defaultValue);

  useEffect(() => {
    setDraft(effectiveValue);
    setError(null);
    setEditing(false);
  }, [effectiveValue]);

  const save = async (nextValue: string) => {
    const plan = planPackageSourceSave({
      defaultValue,
      draft: nextValue,
      effectiveValue,
      normalize,
    });
    if (plan.kind === 'invalid') {
      setError(t('settings.dependencies.invalidSource'));
      return;
    }
    if (plan.kind === 'unchanged') {
      setDraft(plan.displayValue);
      setEditing(false);
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onPersist(plan.persistedValue);
      setDraft(plan.displayValue);
      setEditing(false);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(draft);
  };

  const startEditing = () => {
    setDraft(effectiveValue);
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (saving) return;
    setDraft(effectiveValue);
    setError(null);
    setEditing(false);
  };

  return (
    <form className="chat-user-settings__row workspace-dependencies-settings__source-row" noValidate onSubmit={submit}>
      <div className="chat-user-settings__runtime-policy-copy">
        <PackageSourceIcon kind={icon} />
        <span>
          <strong>{label}</strong>
        </span>
      </div>
      {editing ? (
        <div className="workspace-dependencies-settings__source-editor">
          <TextField
            autoFocus
            id={id}
            aria-label={label}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? 'true' : undefined}
            disabled={saving}
            inputMode="url"
            placeholder={placeholder}
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              cancelEditing();
            }}
          />
          <Button
            className="workspace-dependencies-settings__source-cancel"
            icon={saving ? <RefreshCw className="is-spinning" size={13} /> : <X size={13} />}
            variant="ghost"
            disabled={saving}
            onClick={cancelEditing}
          >
            {saving ? t('settings.dependencies.saving') : t('common.cancel')}
          </Button>
        </div>
      ) : (
        <div className="workspace-dependencies-settings__source-display">
          <code title={effectiveValue}>{effectiveValue}</code>
          <IconButton
            className="workspace-dependencies-settings__source-edit"
            label={t('settings.dependencies.editSource', { source: label })}
            disabled={saving}
            onClick={startEditing}
          >
            <Pencil size={13} />
          </IconButton>
          {customized ? (
            <IconButton
              className="workspace-dependencies-settings__source-reset"
              label={t('settings.dependencies.resetSource', { source: label })}
              variant="ghost"
              disabled={saving}
              onClick={() => void save(defaultValue)}
            >
              {saving ? <RefreshCw className="is-spinning" size={13} /> : <RotateCcw size={13} />}
            </IconButton>
          ) : null}
        </div>
      )}
      {error ? <small className="workspace-dependencies-settings__source-error" id={errorId} role="alert">{error}</small> : null}
    </form>
  );
}

function PackageSourceIcon({ kind }: { kind: PackageSourceKind }) {
  if (kind === 'npm') {
    return (
      <svg
        className="workspace-dependencies-settings__leading-icon workspace-dependencies-settings__source-icon"
        viewBox="3 10 26 12"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M4 11.3v8h6.8v1.4h5.3v-1.3H28v-8.1H4Zm6.6 6.7H9.3v-3.9H8V18H5.3v-5.3h5.3V18Zm6.6 0h-2.7v1.4h-2.7v-6.6h5.3c.1 1.6.1 3.4.1 5.2Zm9.4 0h-1.3v-3.9H24V18h-1.4v-3.9h-1.3V18h-2.7v-5.3h8V18Zm-10.7-3.9h-1.3v2.6h1.3v-2.6Z" />
      </svg>
    );
  }

  return (
    <svg
      className="workspace-dependencies-settings__leading-icon workspace-dependencies-settings__source-icon"
      viewBox="6 6 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M15.6 15.5h-2c-1.4 0-2.3.9-2.3 2.3v1.8c0 .2-.1.3-.3.3h-.9c-.9 0-1.6-.4-2-1.2-.3-.6-.5-1.2-.5-1.8-.1-1.1-.1-2.2.3-3.3.3-.9.9-1.6 1.9-1.8h5.8c.1 0 .3 0 .3-.1v-.5s-.2-.1-.3-.1h-3.4c-.3 0-.4-.1-.4-.4V9.4c0-.7.3-1.2.9-1.4.5-.2 1-.4 1.5-.5 1.2-.2 2.4-.2 3.6.1.5.1 1 .3 1.4.6.4.4.7.8.6 1.4v3.6c0 1.4-.8 2.2-2.2 2.2-.7.1-1.4.1-2 .1Zm-2.8-6c0 .4.3.8.8.8.4 0 .8-.4.8-.8s-.4-.7-.8-.8c-.5 0-.8.4-.8.8Zm3.6 7h2c1.4 0 2.3-.9 2.3-2.3v-1.8c0-.2.1-.3.3-.3h.9c.9 0 1.6.4 2 1.2.3.6.5 1.2.5 1.8.1 1.1.1 2.2-.3 3.3-.3.9-.9 1.6-1.9 1.8h-5.8c-.1 0-.3 0-.3.1v.5s.2.1.3.1h3.4c.3 0 .4.1.4.4v1.3c0 .7-.3 1.2-.9 1.4-.5.2-1 .4-1.5.5-1.2.2-2.4.2-3.6-.1-.5-.1-1-.3-1.4-.6-.4-.4-.7-.8-.6-1.4v-3.6c0-1.4.8-2.2 2.2-2.2.7-.1 1.4-.1 2-.1Zm2.8 6c0-.4-.3-.8-.8-.8-.4 0-.8.4-.8.8s.4.7.8.8c.5 0 .8-.4.8-.8Z" />
    </svg>
  );
}

function environmentStatusCopy(status: RuntimeWorkspaceDependenciesStatus | null, t: Translate): string {
  if (!status) return t('settings.dependencies.status.reading');
  return [
    { available: status.node.available, tool: 'Node.js' },
    { available: status.python.available, tool: 'Python' },
    { available: status.uv.available, tool: 'uv' },
  ].map(({ available, tool }) => t('settings.dependencies.status.item', {
    status: t(available
      ? 'settings.dependencies.status.available'
      : 'settings.dependencies.status.unavailable'),
    tool,
  })).join(' · ');
}
