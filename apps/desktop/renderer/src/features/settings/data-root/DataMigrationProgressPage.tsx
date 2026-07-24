import type { DesktopDataRootState } from '@setsuna-desktop/contracts';
import { AlertTriangle, Database, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ShellFrame } from '../../../app/layout/ShellFrame.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button, StatusBadge } from '../../../shared/ui/primitives.js';
import { formatDataBytes, formatDataDuration } from './dataRootFormat.js';
import { dataRootCategoryMessageKey, dataRootPhaseMessageKey } from './dataRootMessages.js';

type MigratingState = Extract<DesktopDataRootState, { mode: 'migrating' }>;

export function DataMigrationProgressPage({ state }: { state: MigratingState }) {
  const { locale, t } = useI18n();
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const started = useRef(false);
  const progress = state.migration;
  const legacyImport = progress.operation === 'legacy_import';
  const copyPercent = progress.totalBytes > 0
    ? Math.min(100, (progress.completedBytes / progress.totalBytes) * 100)
    : 0;

  useEffect(() => {
    if (started.current || progress.phase !== 'scanning') return;
    started.current = true;
    void runAction(() => window.setsunaDesktop!.dataRoot.runMigration(), setActionPending, setActionError);
  }, [progress.phase]);

  const retry = () => {
    setActionPending(true);
    setActionError(null);
    void runAction(
      () => window.setsunaDesktop!.dataRoot.runMigration(),
      setActionPending,
      setActionError,
    );
  };
  const returnToPrevious = () => {
    setActionPending(true);
    setActionError(null);
    void runAction(
      () => window.setsunaDesktop!.dataRoot.cancelMigration(),
      setActionPending,
      setActionError,
    );
  };
  const indeterminate = progress.phase === 'scanning'
    || progress.phase === 'merging_memory'
    || progress.phase === 'validating'
    || progress.phase === 'committing'
    || progress.phase === 'restarting';

  return (
    <ShellFrame
      className="data-root-maintenance-shell"
      showSidebarToggle={false}
      inspectorOpen={false}
      status={(
        <StatusBadge tone={progress.phase === 'failed' ? 'danger' : 'warning'}>
          {t(dataRootPhaseMessageKey[progress.phase])}
        </StatusBadge>
      )}
    >
      <main className="data-root-maintenance">
        <section className="data-root-maintenance__card">
          <header className="data-root-maintenance__header">
            <span className="data-root-maintenance__icon"><Database size={22} /></span>
            <div>
              <h1>{t(legacyImport ? 'dataRoot.legacyImport.title' : 'dataRoot.migration.title')}</h1>
              <p>{t(legacyImport ? 'dataRoot.legacyImport.description' : 'dataRoot.migration.description')}</p>
            </div>
          </header>

          <div className="data-root-maintenance__paths">
            <div><span>{t('dataRoot.source')}</span><code title={progress.sourceRoot}>{progress.sourceRoot}</code></div>
            <div><span>{t('dataRoot.target')}</span><code title={progress.targetRoot}>{progress.targetRoot}</code></div>
          </div>

          <div className="data-root-progress" aria-label={t('dataRoot.migration.progress')}>
            <div className="data-root-progress__track">
              <span
                className={indeterminate ? 'is-indeterminate' : ''}
                style={indeterminate ? undefined : { width: `${copyPercent}%` }}
              />
            </div>
            <div className="data-root-progress__summary">
              <strong>
                {progress.phase === 'copying'
                  ? t('dataRoot.migration.byteProgress', {
                      completed: formatDataBytes(progress.completedBytes, locale),
                      total: formatDataBytes(progress.totalBytes, locale),
                      percent: Math.floor(copyPercent),
                    })
                  : t(dataRootPhaseMessageKey[progress.phase])}
              </strong>
              <span>{progress.completedFiles.toLocaleString(locale)} / {progress.totalFiles.toLocaleString(locale)} {t('dataRoot.files')}</span>
            </div>
            {progress.phase === 'copying' ? (
              <div className="data-root-progress__metrics">
                <span>{formatDataBytes(progress.bytesPerSecond ?? 0, locale)}/s</span>
                <span>{t('dataRoot.eta', { time: formatDataDuration(progress.etaSeconds, locale) })}</span>
              </div>
            ) : null}
            {progress.currentRelativePath ? (
              <code className="data-root-progress__current" title={progress.currentRelativePath}>
                {progress.currentRelativePath}
              </code>
            ) : null}
          </div>

          <div className="data-root-category-list">
            {progress.categories.map((category) => (
              <div className="data-root-category" key={category.id}>
                <span className={`data-root-category__status is-${category.status}`} />
                <strong>{t(dataRootCategoryMessageKey[category.id])}</strong>
                <span>{category.completedFiles.toLocaleString(locale)} / {category.fileCount.toLocaleString(locale)}</span>
                <small>{formatDataBytes(category.totalBytes, locale)}</small>
              </div>
            ))}
          </div>

          {progress.error || actionError ? (
            <div className="data-root-maintenance__error" role="alert">
              <AlertTriangle size={16} />
              <span>{progress.error?.message ?? actionError}</span>
            </div>
          ) : null}

          {progress.phase === 'failed' ? (
            <div className="data-root-maintenance__actions">
              <Button variant="primary" disabled={actionPending} onClick={retry}>
                {t('common.retry')}
              </Button>
              {!legacyImport ? (
                <Button icon={<RotateCcw size={15} />} disabled={actionPending} onClick={returnToPrevious}>
                  {t('dataRoot.returnPrevious')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
    </ShellFrame>
  );
}

async function runAction(
  action: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
  setPending: (pending: boolean) => void,
  setError: (error: string | null) => void,
): Promise<void> {
  setPending(true);
  setError(null);
  try {
    const result = await action();
    if (!result.ok) setError(result.error.message);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    setPending(false);
  }
}
