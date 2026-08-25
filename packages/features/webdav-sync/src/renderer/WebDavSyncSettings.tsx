import {
  DESKTOP_WEBDAV_SYNC_CATEGORY_IDS,
  type DesktopWebDavSyncCategoryId,
  type DesktopWebDavSyncCategorySummary,
  type DesktopWebDavSyncSnapshotSummary,
} from '../contracts/index.js';
import {
  Check,
  Cloud,
  Copy,
  KeyRound,
  LockKeyhole,
  Play,
  RotateCcw,
  Server,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebDavSyncView } from './context.js';
import { useDesktopWebDavSync } from './useWebDavSync.js';
import { WebDavAutomaticBackupDialog } from './WebDavAutomaticBackupDialog.js';
import { WebDavConnectionForm } from './WebDavConnectionForm.js';
import { WebDavRestorePanel } from './WebDavRestorePanel.js';
import {
  formatSyncBytes,
  webDavCategoryCopy,
  webDavOperationMessageKey,
} from './webDavSyncCopy.js';
import './webdav-sync.css';

export function WebDavSyncSettings() {
  const { locale, t, ui: { Button, Checkbox, EmptyState, TextField } } = useWebDavSyncView();
  const sync = useDesktopWebDavSync();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [backup, setBackup] = useState<DesktopWebDavSyncSnapshotSummary | null>(null);
  const [localCategorySummaries, setLocalCategorySummaries] = useState<
    DesktopWebDavSyncCategorySummary[] | null
  >(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmAutomaticBackup, setConfirmAutomaticBackup] = useState(false);
  const [automaticBackupPending, setAutomaticBackupPending] = useState(false);
  const [categoryUpdatePending, setCategoryUpdatePending] = useState(false);
  const categoryUpdateInFlight = useRef(false);
  const [resetPending, setResetPending] = useState(false);
  const state = sync.state;
  const busy = Boolean(state?.operation);

  const refreshBackup = useCallback(async () => {
    const result = await sync.listSnapshots();
    setBackup(result.snapshots[0] ?? null);
  }, [sync.listSnapshots]);

  const refreshLocalCategorySummaries = useCallback(async () => {
    setLocalCategorySummaries(await sync.getLocalCategorySummaries());
  }, [sync.getLocalCategorySummaries]);

  useEffect(() => {
    if (!state?.configured) {
      setBackup(null);
      setLocalCategorySummaries(null);
      return;
    }
    void refreshBackup().catch(() => undefined);
    void refreshLocalCategorySummaries().catch(() => undefined);
  }, [refreshBackup, refreshLocalCategorySummaries, state?.configured]);

  if (sync.loading) return <EmptyState title={t('feature.webdavSync.common.loading')} />;
  if (!state) {
    return (
      <div className="chat-user-settings__section settings-webdav">
        <section className="settings-webdav__card settings-webdav__unavailable">
          <div>
            <strong>{t('feature.webdavSync.unavailable')}</strong>
            <small>{sync.error ?? t('feature.webdavSync.unavailableDescription')}</small>
            <small>{t('feature.webdavSync.unavailableResetHint')}</small>
          </div>
          <Button
            disabled={resetPending}
            icon={<RotateCcw size={13} />}
            onClick={() => {
              setResetPending(true);
              void sync.resetLocalConfiguration()
                .catch(() => undefined)
                .finally(() => setResetPending(false));
            }}
          >
            {t('feature.webdavSync.unavailableReset')}
          </Button>
        </section>
      </div>
    );
  }

  if (!state.configured || !state.connection) {
    return (
      <div className="chat-user-settings__section settings-webdav">
        <WebDavConnectionForm
          disabled={busy}
          onSubmit={async (input) => {
            const result = await sync.configure(input);
            setRecoveryKey(result.recoveryKey ?? null);
          }}
          onTest={async (input) => { await sync.testConnection(input); }}
        />
      </div>
    );
  }

  const updateCategory = async (category: DesktopWebDavSyncCategoryId, checked: boolean) => {
    if (categoryUpdateInFlight.current) return;
    const categories = checked
      ? [...state.categories, category]
      : state.categories.filter((id) => id !== category);
    if (!categories.length) {
      setCategoryError(t('feature.webdavSync.categories.required'));
      return;
    }
    setCategoryError(null);
    categoryUpdateInFlight.current = true;
    setCategoryUpdatePending(true);
    try {
      await sync.updatePreferences({ categories });
    } catch {
      // The shared sync error surface displays the IPC failure.
    } finally {
      categoryUpdateInFlight.current = false;
      setCategoryUpdatePending(false);
    }
  };

  const runBackup = async () => {
    await sync.backupNow();
    await refreshBackup();
  };

  const enableAutomaticBackup = async () => {
    setAutomaticBackupPending(true);
    try {
      await sync.updatePreferences({ automaticBackup: true });
      setConfirmAutomaticBackup(false);
    } finally {
      setAutomaticBackupPending(false);
    }
  };

  const localCategoryBytes = new Map(
    localCategorySummaries?.map((summary) => [summary.id, summary.totalBytes]) ?? [],
  );

  return (
    <div className="chat-user-settings__section settings-webdav">
      {recoveryKey ? (
        <section className="settings-webdav__recovery-card" role="alert">
          <div className="settings-webdav__recovery-heading">
            <span><KeyRound size={18} /></span>
            <div>
              <strong>{t('feature.webdavSync.recovery.title')}</strong>
              <small>{t('feature.webdavSync.recovery.description')}</small>
            </div>
          </div>
          <div className="settings-webdav__recovery-key">
            <TextField
              className="settings-webdav__recovery-input"
              readOnly
              spellCheck={false}
              value={recoveryKey}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={() => {
                void navigator.clipboard.writeText(recoveryKey)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {t(copied ? 'feature.webdavSync.recovery.copied' : 'feature.webdavSync.recovery.copy')}
            </Button>
          </div>
          <Button variant="primary" onClick={() => setRecoveryKey(null)}>
            {t('feature.webdavSync.recovery.acknowledge')}
          </Button>
        </section>
      ) : null}

      <section className="settings-webdav__card">
        <header className="settings-webdav__section-header">
          <div className="settings-webdav__connection-heading">
            <span className="settings-webdav__card-icon"><Server size={16} /></span>
            <div>
              <strong>{t('feature.webdavSync.connection.title')}</strong>
              <small>{t('feature.webdavSync.connection.encryption')}</small>
            </div>
            <span className="settings-webdav__connected-status">
              {t('feature.webdavSync.connection.connected')}
            </span>
          </div>
          <div className="settings-webdav__header-actions">
            <Button
              disabled={busy}
              icon={<KeyRound size={13} />}
              onClick={() => {
                setCopied(false);
                void sync.revealRecoveryKey()
                  .then((value) => setRecoveryKey(value))
                  .catch(() => undefined);
              }}
            >
              {t('feature.webdavSync.recovery.reveal')}
            </Button>
            <Button
              disabled={busy}
              icon={<ShieldCheck size={13} />}
              onClick={() => {
                setTestMessage(null);
                void sync.testConnection()
                  .then(() => setTestMessage(t('feature.webdavSync.connection.connected')))
                  .catch(() => undefined);
              }}
            >
              {t('feature.webdavSync.connection.test')}
            </Button>
            <Button
              disabled={busy}
              icon={<Unplug size={13} />}
              variant="danger"
              onClick={() => setConfirmDisconnect(true)}
            >
              {t('feature.webdavSync.connection.disconnect')}
            </Button>
          </div>
        </header>
        <dl className="settings-webdav__connection-details">
          <div>
            <dt>{t('feature.webdavSync.connection.remote')}</dt>
            <dd><code>{state.connection.endpoint}{state.connection.remoteRoot}</code></dd>
          </div>
          <div>
            <dt>{t('feature.webdavSync.connection.account')}</dt>
            <dd>{state.connection.username}</dd>
          </div>
          <div>
            <dt>{t('feature.webdavSync.connection.device')}</dt>
            <dd>{state.connection.deviceName}</dd>
          </div>
          <div>
            <dt>{t('feature.webdavSync.connection.repository')}</dt>
            <dd><code>{state.connection.repositoryId}</code></dd>
          </div>
        </dl>
        {testMessage ? <div className="settings-webdav__success"><Check size={13} />{testMessage}</div> : null}
        {confirmDisconnect ? (
          <div className="settings-webdav__disconnect-confirm">
            <div>
              <strong>{t('feature.webdavSync.connection.disconnectTitle')}</strong>
              <small>{t('feature.webdavSync.connection.disconnectDescription')}</small>
            </div>
            <span>
              <Button disabled={busy} onClick={() => setConfirmDisconnect(false)}>{t('feature.webdavSync.common.cancel')}</Button>
              <Button
                disabled={busy}
                variant="danger"
                onClick={() => void sync.disconnect().then(() => setConfirmDisconnect(false)).catch(() => undefined)}
              >
                {t('feature.webdavSync.connection.disconnect')}
              </Button>
            </span>
          </div>
        ) : null}
      </section>

      <section className="settings-webdav__card">
        <header className="settings-webdav__section-header">
          <div>
            <strong>{t('feature.webdavSync.automatic.title')}</strong>
            <small>{t('feature.webdavSync.automatic.description')}</small>
          </div>
          <Checkbox
            checked={state.automaticBackup}
            className="settings-webdav__switch"
            disabled={busy}
            onChange={(checked) => {
              if (checked) {
                setConfirmAutomaticBackup(true);
                return;
              }
              void sync.updatePreferences({ automaticBackup: false }).catch(() => undefined);
            }}
          >
            <span>{t('feature.webdavSync.automatic.label')}</span>
          </Checkbox>
        </header>
      </section>

      <section className="settings-webdav__card">
        <header className="settings-webdav__section-header">
          <div>
            <strong>{t('feature.webdavSync.categories.title')}</strong>
            <small>{t('feature.webdavSync.categories.description')}</small>
          </div>
        </header>
        <div className="settings-webdav__category-list">
          {DESKTOP_WEBDAV_SYNC_CATEGORY_IDS.map((category) => (
            <Checkbox
              key={category}
              checked={state.categories.includes(category)}
              className={category === 'model_credentials' ? 'is-sensitive' : ''}
              disabled={busy || categoryUpdatePending}
              onChange={(checked) => void updateCategory(category, checked)}
            >
              <span className="settings-webdav__category-icon">
                {category === 'model_credentials' ? <LockKeyhole size={15} /> : <Cloud size={15} />}
              </span>
              <span className="settings-webdav__category-copy">
                <strong>{t(webDavCategoryCopy[category].labelKey)}</strong>
                <small>{t(webDavCategoryCopy[category].descriptionKey)}</small>
              </span>
              <span className="settings-webdav__category-size">
                {localCategoryBytes.has(category)
                  ? formatSyncBytes(localCategoryBytes.get(category)!, locale)
                  : '—'}
              </span>
            </Checkbox>
          ))}
        </div>
        {categoryError ? <div className="settings-webdav__error" role="alert">{categoryError}</div> : null}
      </section>

      <section className="settings-webdav__card">
        <header className="settings-webdav__section-header">
          <div>
            <strong>{t('feature.webdavSync.backup.title')}</strong>
            <small>{t('feature.webdavSync.backup.description')}</small>
          </div>
          <Button
            disabled={busy}
            icon={<Play size={13} />}
            variant="primary"
            onClick={() => void runBackup().catch(() => undefined)}
          >
            {t('feature.webdavSync.backup.now')}
          </Button>
        </header>
        <div className="settings-webdav__backup-times">
          <span>
            <small>{t('feature.webdavSync.backup.last')}</small>
            <strong>{state.lastBackupAt
              ? new Date(state.lastBackupAt).toLocaleString(locale)
              : t('feature.webdavSync.backup.never')}</strong>
          </span>
          <span>
            <small>{t('feature.webdavSync.backup.next')}</small>
            <strong>{state.nextAutomaticBackupAt
              ? new Date(state.nextAutomaticBackupAt).toLocaleString(locale)
              : '—'}</strong>
          </span>
        </div>
        {state.operation ? (
          <div className="settings-webdav__operation" role="status">
            <div>
              <span className="settings-webdav__spinner" />
              <strong>{t(webDavOperationMessageKey[state.operation.phase])}</strong>
              {state.operation.totalBytes ? (
                <small>{formatSyncBytes(state.operation.completedBytes ?? 0, locale)} / {formatSyncBytes(state.operation.totalBytes, locale)}</small>
              ) : null}
            </div>
            {state.operation.cancellable ? (
              <Button onClick={() => void sync.cancelCurrentOperation().catch(() => undefined)}>
                {t('feature.webdavSync.operation.cancel')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <WebDavRestorePanel
        backup={backup}
        busy={busy}
        onInspect={(snapshotId, categories) => sync.inspectRestore({ snapshotId, categories })}
        onRefresh={refreshBackup}
        onRestore={async (planId) => { await sync.restore(planId); }}
        restoreOperation={state.operation?.kind === 'restore' ? state.operation : undefined}
      />

      {sync.error || state.lastError ? (
        <div className="settings-webdav__error" role="alert">{sync.error ?? state.lastError}</div>
      ) : null}

      {confirmAutomaticBackup ? (
        <WebDavAutomaticBackupDialog
          pending={automaticBackupPending}
          onCancel={() => setConfirmAutomaticBackup(false)}
          onConfirm={() => void enableAutomaticBackup().catch(() => undefined)}
        />
      ) : null}
    </div>
  );
}
