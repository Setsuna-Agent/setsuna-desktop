import type { DesktopDataRootState } from '@setsuna-desktop/contracts';
import { HardDrive, RefreshCw, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ShellFrame } from '../../../app/layout/ShellFrame.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button, StatusBadge } from '../../../shared/ui/primitives.js';

type RecoveryState = Extract<DesktopDataRootState, { mode: 'recovery' }>;

export function DataRootRecoveryPage({ state }: { state: RecoveryState }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<'retry' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(state.error?.message ?? null);

  const run = async (kind: 'retry' | 'restore') => {
    const api = window.setsunaDesktop?.dataRoot;
    if (!api) return;
    setPending(kind);
    setError(null);
    try {
      const result = kind === 'retry'
        ? await api.retryStartup()
        : await api.restorePreviousRoot();
      if (!result.ok) setError(result.error.message);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setPending(null);
    }
  };

  return (
    <ShellFrame
      className="data-root-maintenance-shell"
      showSidebarToggle={false}
      inspectorOpen={false}
      status={<StatusBadge tone="danger">{t('dataRoot.status.recovery')}</StatusBadge>}
    >
      <main className="data-root-maintenance">
        <section className="data-root-maintenance__card">
          <header className="data-root-maintenance__header">
            <span className="data-root-maintenance__icon is-danger"><HardDrive size={22} /></span>
            <div>
              <h1>{t('dataRoot.recovery.title')}</h1>
              <p>{t('dataRoot.recovery.description')}</p>
            </div>
          </header>
          <div className="data-root-maintenance__paths">
            <div>
              <span>{t('dataRoot.configuredLocation')}</span>
              <code title={state.configuredRoot}>{state.configuredRoot || t('dataRoot.pointerInvalid')}</code>
            </div>
            {state.previousRoot ? (
              <div>
                <span>{t('dataRoot.previousLocation')}</span>
                <code title={state.previousRoot}>{state.previousRoot}</code>
              </div>
            ) : null}
          </div>
          {error ? <div className="data-root-maintenance__error" role="alert">{error}</div> : null}
          <p className="data-root-maintenance__notice">{t('dataRoot.recovery.noEmptyData')}</p>
          <div className="data-root-maintenance__actions">
            <Button
              variant="primary"
              icon={<RefreshCw size={15} />}
              disabled={Boolean(pending)}
              onClick={() => void run('retry')}
            >
              {t('dataRoot.recovery.retry')}
            </Button>
            <Button
              icon={<RotateCcw size={15} />}
              disabled={Boolean(pending)}
              onClick={() => void run('restore')}
            >
              {t('dataRoot.recovery.restore')}
            </Button>
          </div>
        </section>
      </main>
    </ShellFrame>
  );
}
