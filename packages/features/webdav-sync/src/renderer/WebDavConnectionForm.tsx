import type {
  DesktopWebDavSyncConfigureInput,
  DesktopWebDavSyncRepositoryMode,
} from '../contracts/index.js';
import { Check, KeyRound, Server } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useWebDavSyncView } from './context.js';
import { WebDavSecretField } from './WebDavSecretField.js';

type ConnectionDraft = {
  endpoint: string;
  remoteRoot: string;
  username: string;
  password: string;
  recoveryKey: string;
  deviceName: string;
  repositoryMode: DesktopWebDavSyncRepositoryMode;
  allowInsecureHttp: boolean;
};

export function WebDavConnectionForm({
  disabled,
  onSubmit,
  onTest,
}: {
  disabled: boolean;
  onSubmit: (input: DesktopWebDavSyncConfigureInput) => Promise<void>;
  onTest: (input: DesktopWebDavSyncConfigureInput) => Promise<void>;
}) {
  const { t, ui: { Button, Checkbox, SelectField, TextField } } = useWebDavSyncView();
  const [draft, setDraft] = useState<ConnectionDraft>(() => ({
    endpoint: '',
    remoteRoot: '/setsuna',
    username: '',
    password: '',
    recoveryKey: '',
    deviceName: '',
    repositoryMode: 'create',
    allowInsecureHttp: false,
  }));
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testSucceeded, setTestSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = disabled || submitting || testing;

  function updateDraft<Key extends keyof ConnectionDraft>(
    key: Key,
    value: ConnectionDraft[Key],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setTestSucceeded(false);
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setSubmitting(true);
    setError(null);
    setTestSucceeded(false);
    try {
      await onSubmit(configureInput(draft));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSubmitting(false);
    }
  };

  const testConnection = async () => {
    if (busy || !canTestConnection(draft)) return;
    setTesting(true);
    setError(null);
    setTestSucceeded(false);
    try {
      await onTest(configureInput(draft));
      setTestSucceeded(true);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setTesting(false);
    }
  };

  return (
    <form className="settings-webdav__connection-form settings-webdav__card" onSubmit={(event) => void submit(event)}>
      <header className="settings-webdav__card-header">
        <span className="settings-webdav__card-icon"><Server size={16} /></span>
        <div>
          <strong>{t('feature.webdavSync.connection.title')}</strong>
          <small>{t('feature.webdavSync.connection.description')}</small>
        </div>
      </header>
      <div className="settings-webdav__form-grid">
        <label className="settings-webdav__field">
          <span>{t('feature.webdavSync.connection.mode')}</span>
          <SelectField
            className="settings-webdav__control"
            disabled={busy}
            value={draft.repositoryMode}
            onValueChange={(value) => updateDraft(
              'repositoryMode',
              value === 'connect' ? 'connect' : 'create',
            )}
          >
            <option value="create">{t('feature.webdavSync.connection.create')}</option>
            <option value="connect">{t('feature.webdavSync.connection.connect')}</option>
          </SelectField>
        </label>
        <label className="settings-webdav__field settings-webdav__field--wide">
          <span>{t('feature.webdavSync.connection.endpoint')}</span>
          <TextField
            autoFocus
            className="settings-webdav__control"
            disabled={busy}
            required
            spellCheck={false}
            type="url"
            value={draft.endpoint}
            placeholder={t('feature.webdavSync.connection.endpointPlaceholder')}
            onChange={(event) => updateDraft('endpoint', event.target.value)}
          />
        </label>
        <label className="settings-webdav__field">
          <span>{t('feature.webdavSync.connection.remoteRoot')}</span>
          <TextField
            className="settings-webdav__control"
            disabled={busy}
            required
            spellCheck={false}
            value={draft.remoteRoot}
            placeholder={t('feature.webdavSync.connection.remoteRootPlaceholder')}
            onChange={(event) => updateDraft('remoteRoot', event.target.value)}
          />
        </label>
        <label className="settings-webdav__field">
          <span>{t('feature.webdavSync.connection.deviceName')}</span>
          <TextField
            className="settings-webdav__control"
            disabled={busy}
            value={draft.deviceName}
            placeholder={t('feature.webdavSync.connection.deviceNamePlaceholder')}
            onChange={(event) => updateDraft('deviceName', event.target.value)}
          />
        </label>
        <label className="settings-webdav__field">
          <span>{t('feature.webdavSync.connection.username')}</span>
          <TextField
            autoComplete="username"
            className="settings-webdav__control"
            disabled={busy}
            required
            value={draft.username}
            onChange={(event) => updateDraft('username', event.target.value)}
          />
        </label>
        <div className="settings-webdav__field">
          <label htmlFor="settings-webdav-password">{t('feature.webdavSync.connection.password')}</label>
          <WebDavSecretField
            id="settings-webdav-password"
            autoComplete="current-password"
            disabled={busy}
            required
            value={draft.password}
            onChange={(event) => updateDraft('password', event.target.value)}
          />
        </div>
        {draft.repositoryMode === 'connect' ? (
          <div className="settings-webdav__field settings-webdav__field--wide">
            <label htmlFor="settings-webdav-recovery-key">{t('feature.webdavSync.connection.recoveryKey')}</label>
            <WebDavSecretField
              id="settings-webdav-recovery-key"
              autoComplete="off"
              disabled={busy}
              leadingIcon={<KeyRound size={14} />}
              required
              spellCheck={false}
              value={draft.recoveryKey}
              placeholder={t('feature.webdavSync.connection.recoveryKeyPlaceholder')}
              onChange={(event) => updateDraft('recoveryKey', event.target.value)}
            />
          </div>
        ) : null}
      </div>
      <Checkbox
        checked={draft.allowInsecureHttp}
        className="settings-webdav__insecure-toggle"
        disabled={busy}
        onChange={(checked) => updateDraft('allowInsecureHttp', checked)}
      >
        <span>
          <strong>{t('feature.webdavSync.connection.insecure')}</strong>
          <small>{t('feature.webdavSync.connection.httpWarning')}</small>
        </span>
      </Checkbox>
      {error ? <div className="settings-webdav__error" role="alert">{error}</div> : null}
      {testSucceeded ? (
        <div className="settings-webdav__success" role="status">
          <Check size={13} />{t('feature.webdavSync.connection.testSuccess')}
        </div>
      ) : null}
      <footer className="settings-webdav__form-actions">
        <small>{t('feature.webdavSync.connection.testHint')}</small>
        <span>
          <Button
            disabled={busy || !canTestConnection(draft)}
            onClick={() => void testConnection()}
          >
            {testing ? t('feature.webdavSync.connection.testing') : t('feature.webdavSync.connection.test')}
          </Button>
          <Button disabled={busy} type="submit" variant="primary">
            {submitting
              ? t('feature.webdavSync.common.processing')
              : t(draft.repositoryMode === 'create'
                ? 'feature.webdavSync.connection.createAction'
                : 'feature.webdavSync.connection.connectAction')}
          </Button>
        </span>
      </footer>
    </form>
  );
}

function configureInput(draft: ConnectionDraft): DesktopWebDavSyncConfigureInput {
  return {
    endpoint: draft.endpoint,
    remoteRoot: draft.remoteRoot,
    username: draft.username,
    password: draft.password,
    repositoryMode: draft.repositoryMode,
    allowInsecureHttp: draft.allowInsecureHttp,
    ...(draft.repositoryMode === 'connect' ? { recoveryKey: draft.recoveryKey } : {}),
    ...(draft.deviceName.trim() ? { deviceName: draft.deviceName } : {}),
  };
}

function canTestConnection(draft: ConnectionDraft): boolean {
  return Boolean(
    draft.endpoint.trim()
    && draft.remoteRoot.trim()
    && draft.username.trim()
    && draft.password
    && (draft.repositoryMode === 'create' || draft.recoveryKey.trim()),
  );
}
