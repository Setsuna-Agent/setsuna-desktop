import type { DesktopWebDavSyncRestorePlan } from '@setsuna-desktop/contracts';
import {
  AlertTriangle,
  CirclePlus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button, IconButton } from '../../../shared/ui/primitives.js';
import { webDavCategoryCopy } from './webDavSyncCopy.js';

type WebDavRestorePlanDialogProps = {
  busy: boolean;
  confirmed: boolean;
  error: string | null;
  plan: DesktopWebDavSyncRestorePlan;
  onClose: () => void;
  onConfirm: (confirmed: boolean) => void;
  onRestore: () => void;
};

export function WebDavRestorePlanDialog({
  busy,
  confirmed,
  error,
  plan,
  onClose,
  onConfirm,
  onRestore,
}: WebDavRestorePlanDialogProps) {
  const { locale, t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const addedCount = plan.diffs.reduce((sum, diff) => sum + diff.addedCount, 0);
  const preservedCount = plan.diffs.reduce((sum, diff) => sum + diff.preservedCount, 0);
  const destructiveDiffs = plan.diffs.filter((diff) => (
    diff.overwrittenCount > 0 || diff.removedCount > 0
  ));
  const safeDiffs = plan.diffs.filter((diff) => (
    diff.overwrittenCount === 0 && diff.removedCount === 0
  ));

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
              <strong id={titleId}>{t('settings.sync.restore.planTitle')}</strong>
              <span>{t('settings.sync.restore.planSource', {
                device: plan.snapshot.deviceName,
                time: new Date(plan.snapshot.createdAt).toLocaleString(locale),
                version: plan.snapshot.appVersion,
              })}</span>
            </div>
          </div>
          <IconButton
            disabled={busy}
            label={t('settings.sync.restore.closePlan')}
            onClick={onClose}
          >
            <X size={15} />
          </IconButton>
        </header>

        <div className="settings-webdav-restore-dialog__body">
          <p id={descriptionId}>{t('settings.sync.restore.planDescription')}</p>
          <div className="settings-webdav-restore-metrics" aria-label={t('settings.sync.restore.planTitle')}>
            <RestoreMetric
              icon={<CirclePlus size={15} />}
              label={t('settings.sync.restore.metricAdded')}
              tone="added"
              value={addedCount}
            />
            <RestoreMetric
              icon={<RefreshCw size={15} />}
              label={t('settings.sync.restore.metricOverwritten')}
              tone={plan.overwrittenCount ? 'warning' : 'neutral'}
              value={plan.overwrittenCount}
            />
            <RestoreMetric
              icon={<Trash2 size={15} />}
              label={t('settings.sync.restore.metricRemoved')}
              tone={plan.removedCount ? 'danger' : 'neutral'}
              value={plan.removedCount}
            />
            <RestoreMetric
              icon={<ShieldCheck size={15} />}
              label={t('settings.sync.restore.metricPreserved')}
              tone="preserved"
              value={preservedCount}
            />
          </div>

          <section className="settings-webdav-restore-changes">
            <div className="settings-webdav-restore-changes__heading">
              <div>
                <strong>{t('settings.sync.restore.changesTitle')}</strong>
                <small>{t('settings.sync.restore.changesDescription')}</small>
              </div>
              <span>{t('settings.sync.restore.changesCount', {
                count: plan.overwrittenCount + plan.removedCount,
              })}</span>
            </div>

            {destructiveDiffs.length ? (
              <div className="settings-webdav-restore-change-groups">
                {destructiveDiffs.map((diff) => (
                  <article key={diff.category} className="settings-webdav-restore-change-group">
                    <header>
                      <strong>{t(webDavCategoryCopy[diff.category].labelKey)}</strong>
                      <span>{t('settings.sync.restore.changesCount', {
                        count: diff.overwrittenCount + diff.removedCount,
                      })}</span>
                    </header>
                    <div className="settings-webdav-restore-change-list" role="list">
                      {diff.overwritten.map((item) => (
                        <RestoreChangeItem
                          key={`overwrite:${item.id}`}
                          action="overwrite"
                          actionLabel={t('settings.sync.restore.changeOverwrite')}
                          item={item}
                        />
                      ))}
                      {diff.removed.map((item) => (
                        <RestoreChangeItem
                          key={`remove:${item.id}`}
                          action="remove"
                          actionLabel={t('settings.sync.restore.changeRemove')}
                          item={item}
                        />
                      ))}
                    </div>
                    {isDiffTruncated(diff) ? (
                      <p className="settings-webdav-restore-change-group__warning">
                        <AlertTriangle size={12} aria-hidden="true" />
                        {t('settings.sync.restore.truncatedWarning')}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="settings-webdav-restore-no-loss">
                <ShieldCheck size={18} aria-hidden="true" />
                <div>
                  <strong>{t('settings.sync.restore.noChangesTitle')}</strong>
                  <small>{t('settings.sync.restore.noChangesDescription')}</small>
                </div>
              </div>
            )}
          </section>

          {safeDiffs.length ? (
            <section className="settings-webdav-restore-safe">
              <ShieldCheck size={16} aria-hidden="true" />
              <div>
                <strong>{t('settings.sync.restore.safeTitle', { count: safeDiffs.length })}</strong>
                <div className="settings-webdav-restore-safe__categories">
                  {safeDiffs.map((diff) => (
                    <span key={diff.category}>
                      {t(webDavCategoryCopy[diff.category].labelKey)}
                      <small>{t('settings.sync.restore.safeCounts', {
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
            <strong>{t('settings.sync.restore.warning', {
              overwritten: plan.overwrittenCount,
              removed: plan.removedCount,
            })}</strong>
          </div>
          {error ? <div className="settings-webdav__error" role="alert">{error}</div> : null}
        </div>

        <footer className="settings-webdav-restore-dialog__footer">
          <label className="settings-webdav__restore-confirm">
            <input
              checked={confirmed}
              disabled={busy}
              type="checkbox"
              onChange={(event) => onConfirm(event.currentTarget.checked)}
            />
            <span>{t('settings.sync.restore.confirm')}</span>
          </label>
          <div className="settings-webdav-restore-dialog__actions">
            <Button autoFocus disabled={busy} onClick={onClose}>
              {t('settings.sync.restore.closePlan')}
            </Button>
            <Button disabled={busy || !confirmed} variant="danger" onClick={onRestore}>
              {t('settings.sync.restore.action')}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
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
