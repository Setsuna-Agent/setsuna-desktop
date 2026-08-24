import type {
  DesktopWebDavSyncOperationState,
  DesktopWebDavSyncRestorePlan,
} from '../contracts/index.js';
import {
  AlertTriangle,
  CirclePlus,
  Folder,
  FolderPlus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useWebDavSyncView } from './context.js';
import { formatSyncBytes, webDavCategoryCopy } from './webDavSyncCopy.js';

type WebDavRestorePlanDialogProps = {
  busy: boolean;
  confirmed: boolean;
  error: string | null;
  plan: DesktopWebDavSyncRestorePlan;
  restoring: boolean;
  restoreOperation?: DesktopWebDavSyncOperationState;
  restoreStatus: string;
  onClose: () => void;
  onConfirm: (confirmed: boolean) => void;
  onRestore: () => void;
};

export function WebDavRestorePlanDialog({
  busy,
  confirmed,
  error,
  plan,
  restoring,
  restoreOperation,
  restoreStatus,
  onClose,
  onConfirm,
  onRestore,
}: WebDavRestorePlanDialogProps) {
  const { locale, t, ui: { Button, IconButton } } = useWebDavSyncView();
  const titleId = useId();
  const descriptionId = useId();
  const addedCount = plan.diffs.reduce((sum, diff) => sum + diff.addedCount, 0)
    + plan.projectActions.filter((action) => action.action === 'create').length;
  const preservedCount = plan.diffs.reduce((sum, diff) => sum + diff.preservedCount, 0)
    + plan.projectActions.filter((action) => action.action === 'reuse').length;
  const destructiveDiffs = plan.diffs.filter((diff) => (
    diff.overwrittenCount > 0 || diff.removedCount > 0
  ));
  const safeDiffs = plan.diffs.filter((diff) => (
    diff.overwrittenCount === 0 && diff.removedCount === 0
  ));
  const downloadProgress = restoreDownloadProgress(restoreOperation);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  const dialog = (
    <div
      className="desktop-agent-modal-backdrop settings-webdav-restore-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <section
        className="desktop-agent-modal settings-webdav-restore-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-webdav-restore-dialog__header">
          <div className="settings-webdav-restore-dialog__title">
            <span className="settings-webdav-restore-dialog__title-icon">
              <AlertTriangle size={17} aria-hidden="true" />
            </span>
            <div>
              <strong id={titleId}>{t('feature.webdavSync.restore.planTitle')}</strong>
              <span>{t('feature.webdavSync.restore.planSource', {
                device: plan.snapshot.deviceName,
                time: new Date(plan.snapshot.createdAt).toLocaleString(locale),
                version: plan.snapshot.appVersion,
              })}</span>
            </div>
          </div>
          <IconButton
            disabled={busy}
            label={t('feature.webdavSync.restore.closePlan')}
            onClick={onClose}
          >
            <X size={15} />
          </IconButton>
        </header>

        <div className="settings-webdav-restore-dialog__body">
          <p id={descriptionId}>{t('feature.webdavSync.restore.planDescription')}</p>
          <div className="settings-webdav-restore-metrics" aria-label={t('feature.webdavSync.restore.planTitle')}>
            <RestoreMetric
              icon={<CirclePlus size={15} />}
              label={t('feature.webdavSync.restore.metricAdded')}
              tone="added"
              value={addedCount}
            />
            <RestoreMetric
              icon={<RefreshCw size={15} />}
              label={t('feature.webdavSync.restore.metricOverwritten')}
              tone={plan.overwrittenCount ? 'warning' : 'neutral'}
              value={plan.overwrittenCount}
            />
            <RestoreMetric
              icon={<Trash2 size={15} />}
              label={t('feature.webdavSync.restore.metricRemoved')}
              tone={plan.removedCount ? 'danger' : 'neutral'}
              value={plan.removedCount}
            />
            <RestoreMetric
              icon={<ShieldCheck size={15} />}
              label={t('feature.webdavSync.restore.metricPreserved')}
              tone="preserved"
              value={preservedCount}
            />
          </div>

          {plan.projectActions.length ? (
            <section className="settings-webdav-restore-projects">
              <div className="settings-webdav-restore-projects__heading">
                <strong>{t('feature.webdavSync.restore.projectsTitle')}</strong>
                <small>{t('feature.webdavSync.restore.projectsDescription')}</small>
              </div>
              <div className="settings-webdav-restore-projects__list">
                {plan.projectActions.map((action) => (
                  <div key={action.sourceProjectId} className="settings-webdav-restore-project">
                    <span aria-hidden="true">
                      {action.action === 'reuse' ? <Folder size={15} /> : <FolderPlus size={15} />}
                    </span>
                    <div>
                      <strong>{action.name}</strong>
                      <small>{t(action.action === 'reuse'
                        ? action.directoryBound
                          ? 'feature.webdavSync.restore.projectReuseBound'
                          : 'feature.webdavSync.restore.projectReuseUnbound'
                        : 'feature.webdavSync.restore.projectCreate')}</small>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="settings-webdav-restore-changes">
            <div className="settings-webdav-restore-changes__heading">
              <div>
                <strong>{t('feature.webdavSync.restore.changesTitle')}</strong>
                <small>{t('feature.webdavSync.restore.changesDescription')}</small>
              </div>
              <span>{t('feature.webdavSync.restore.changesCount', {
                count: plan.overwrittenCount + plan.removedCount,
              })}</span>
            </div>

            {destructiveDiffs.length ? (
              <div className="settings-webdav-restore-change-groups">
                {destructiveDiffs.map((diff) => (
                  <article key={diff.category} className="settings-webdav-restore-change-group">
                    <header>
                      <strong>{t(webDavCategoryCopy[diff.category].labelKey)}</strong>
                      <span>{t('feature.webdavSync.restore.changesCount', {
                        count: diff.overwrittenCount + diff.removedCount,
                      })}</span>
                    </header>
                    <div className="settings-webdav-restore-change-list" role="list">
                      {diff.overwritten.map((item) => (
                        <RestoreChangeItem
                          key={`overwrite:${item.id}`}
                          action="overwrite"
                          actionLabel={t('feature.webdavSync.restore.changeOverwrite')}
                          item={item}
                        />
                      ))}
                      {diff.removed.map((item) => (
                        <RestoreChangeItem
                          key={`remove:${item.id}`}
                          action="remove"
                          actionLabel={t('feature.webdavSync.restore.changeRemove')}
                          item={item}
                        />
                      ))}
                    </div>
                    {isDiffTruncated(diff) ? (
                      <p className="settings-webdav-restore-change-group__warning">
                        <AlertTriangle size={12} aria-hidden="true" />
                        {t('feature.webdavSync.restore.truncatedWarning')}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="settings-webdav-restore-no-loss">
                <ShieldCheck size={18} aria-hidden="true" />
                <div>
                  <strong>{t('feature.webdavSync.restore.noChangesTitle')}</strong>
                  <small>{t('feature.webdavSync.restore.noChangesDescription')}</small>
                </div>
              </div>
            )}
          </section>

          {safeDiffs.length ? (
            <section className="settings-webdav-restore-safe">
              <ShieldCheck size={16} aria-hidden="true" />
              <div>
                <strong>{t('feature.webdavSync.restore.safeTitle', { count: safeDiffs.length })}</strong>
                <div className="settings-webdav-restore-safe__categories">
                  {safeDiffs.map((diff) => (
                    <span key={diff.category}>
                      {t(webDavCategoryCopy[diff.category].labelKey)}
                      <small>{t('feature.webdavSync.restore.safeCounts', {
                        added: diff.addedCount,
                        preserved: diff.preservedCount,
                      })}</small>
                    </span>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <div className="settings-webdav__restore-warning">
            <AlertTriangle size={15} aria-hidden="true" />
            <strong>{t('feature.webdavSync.restore.warning', {
              overwritten: plan.overwrittenCount,
              removed: plan.removedCount,
            })}</strong>
          </div>
        </div>

        <footer className="settings-webdav-restore-dialog__footer">
          {restoring ? (
            <div
              className={`settings-webdav-restore-dialog__feedback${downloadProgress ? ' has-progress' : ''}`}
              role="status"
            >
              <span className="settings-webdav__spinner" aria-hidden="true" />
              {downloadProgress ? (
                <div className="settings-webdav-restore-dialog__progress">
                  <div className="settings-webdav-restore-dialog__progress-heading">
                    <span>{restoreStatus}</span>
                    <strong>{downloadProgress.percent}%</strong>
                  </div>
                  <div
                    className="settings-webdav-restore-dialog__progress-track"
                    role="progressbar"
                    aria-label={restoreStatus}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={downloadProgress.percent}
                  >
                    <span style={{ width: `${downloadProgress.percent}%` }} />
                  </div>
                  <small>
                    {formatSyncBytes(downloadProgress.completedBytes, locale)} /{' '}
                    {formatSyncBytes(downloadProgress.totalBytes, locale)}
                  </small>
                </div>
              ) : <span>{restoreStatus}</span>}
            </div>
          ) : error ? (
            <div className="settings-webdav-restore-dialog__feedback is-error" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
          <label className="settings-webdav__restore-confirm">
            <input
              className="settings-webdav__checkbox"
              checked={confirmed}
              disabled={busy}
              type="checkbox"
              onChange={(event) => onConfirm(event.currentTarget.checked)}
            />
            <span>{t('feature.webdavSync.restore.confirm')}</span>
          </label>
          <div className="settings-webdav-restore-dialog__actions">
            <Button autoFocus disabled={busy} onClick={onClose}>
              {t('feature.webdavSync.restore.closePlan')}
            </Button>
            <Button disabled={busy || !confirmed} variant="danger" onClick={onRestore}>
              {t(restoring ? 'feature.webdavSync.restore.inProgress' : 'feature.webdavSync.restore.action')}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

function restoreDownloadProgress(operation?: DesktopWebDavSyncOperationState): {
  completedBytes: number;
  percent: number;
  totalBytes: number;
} | null {
  if (operation?.phase !== 'downloading' || !operation.totalBytes) return null;
  const completedBytes = Math.min(
    operation.totalBytes,
    Math.max(0, operation.completedBytes ?? 0),
  );
  return {
    completedBytes,
    percent: Math.floor((completedBytes / operation.totalBytes) * 100),
    totalBytes: operation.totalBytes,
  };
}

function RestoreMetric({
  icon,
  label,
  tone,
  value,
}: {
  icon: ReactNode;
  label: string;
  tone: 'added' | 'danger' | 'neutral' | 'preserved' | 'warning';
  value: number;
}) {
  return (
    <div className={`settings-webdav-restore-metric is-${tone}`}>
      <span>{icon}</span>
      <div><strong>{value}</strong><small>{label}</small></div>
    </div>
  );
}

function RestoreChangeItem({
  action,
  actionLabel,
  item,
}: {
  action: 'overwrite' | 'remove';
  actionLabel: string;
  item: { id: string; label: string; detail?: string };
}) {
  return (
    <div className="settings-webdav-restore-change-item" role="listitem">
      <span className={`settings-webdav-restore-change-item__icon is-${action}`}>
        {action === 'overwrite' ? <RefreshCw size={14} /> : <Trash2 size={14} />}
      </span>
      <span className="settings-webdav-restore-change-item__body">
        <strong>{item.label}</strong>
        {item.detail ? <code title={item.detail}>{item.detail}</code> : null}
      </span>
      <span className={`settings-webdav-restore-change-item__action is-${action}`}>
        {actionLabel}
      </span>
    </div>
  );
}

function isDiffTruncated(diff: DesktopWebDavSyncRestorePlan['diffs'][number]): boolean {
  return diff.added.length < diff.addedCount
    || diff.overwritten.length < diff.overwrittenCount
    || diff.removed.length < diff.removedCount
    || diff.preserved.length < diff.preservedCount;
}
