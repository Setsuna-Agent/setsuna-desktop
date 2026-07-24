import type { DesktopDataMigrationPlan } from '@setsuna-desktop/contracts';
import { Modal } from 'antd';
import { FolderOpen, FolderRoot, MoveRight } from 'lucide-react';
import { useState } from 'react';
import { useDesktopDataRoot } from '../../../app/providers/DesktopDataRootProvider.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button } from '../../../shared/ui/primitives.js';
import { formatDataBytes } from './dataRootFormat.js';
import { dataRootCategoryMessageKey } from './dataRootMessages.js';

export function DataLocationSettings({ fallbackRoot }: { fallbackRoot: string }) {
  const { state } = useDesktopDataRoot();
  const { locale, t } = useI18n();
  const [opening, setOpening] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [beginning, setBeginning] = useState(false);
  const [plan, setPlan] = useState<DesktopDataMigrationPlan | null>(null);
  const [targetRoot, setTargetRoot] = useState('');
  const [error, setError] = useState<string | null>(null);
  const activeRoot = state?.mode === 'normal' ? state.activeRoot : fallbackRoot;

  const openCurrent = async () => {
    const api = window.setsunaDesktop?.desktop;
    if (!api) return;
    setOpening(true);
    setError(null);
    try {
      const result = await api.openPath(activeRoot);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(errorMessage(unknownError));
    } finally {
      setOpening(false);
    }
  };

  const chooseTarget = async () => {
    const desktop = window.setsunaDesktop?.desktop;
    const dataRoot = window.setsunaDesktop?.dataRoot;
    if (!desktop || !dataRoot) {
      setError(t('dataRoot.unsupported'));
      return;
    }
    setError(null);
    try {
      const selected = await desktop.selectDirectory({ title: t('dataRoot.chooseTarget') });
      if (!selected) return;
      setTargetRoot(selected);
      setPlan(null);
      setScanning(true);
      setPlan(await dataRoot.scanTarget(selected));
    } catch (unknownError) {
      setError(errorMessage(unknownError));
    } finally {
      setScanning(false);
    }
  };

  const beginMigration = async () => {
    const api = window.setsunaDesktop?.dataRoot;
    if (!api || !plan) return;
    setBeginning(true);
    setError(null);
    try {
      const result = await api.beginMigration(plan.planId);
      if (!result.ok) setError(result.error.message);
    } catch (unknownError) {
      setError(errorMessage(unknownError));
    } finally {
      setBeginning(false);
    }
  };

  return (
    <>
      <div className="chat-user-settings__row chat-user-settings__path-row">
        <span className="chat-user-settings__row-label">
          <FolderRoot size={14} />
          <span>{t('settings.runtime.dataDirectory')}</span>
        </span>
        <div className="chat-user-settings__path-actions">
          <Button
            className="chat-user-settings__path-open"
            icon={<FolderOpen size={14} />}
            disabled={opening || scanning || beginning}
            onClick={() => void openCurrent()}
          >
            {opening ? t('common.opening') : t('common.open')}
          </Button>
          <Button
            className="chat-user-settings__path-open"
            icon={<MoveRight size={14} />}
            disabled={opening || scanning || beginning}
            onClick={() => void chooseTarget()}
          >
            {t('dataRoot.change')}
          </Button>
        </div>
        <code className="chat-user-settings__path-value" title={activeRoot}>
          {activeRoot}
        </code>
      </div>
      {error && !plan ? <div className="chat-user-settings__runtime-error">{error}</div> : null}
      <Modal
        centered
        width={680}
        open={scanning || Boolean(plan)}
        title={t('dataRoot.plan.title')}
        closable={!beginning}
        maskClosable={!beginning}
        onCancel={() => {
          if (beginning) return;
          setPlan(null);
          setTargetRoot('');
          setError(null);
        }}
        footer={plan ? (
          <div className="data-root-plan__actions">
            <Button disabled={beginning} onClick={() => setPlan(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={beginning || plan.blockers.length > 0}
              onClick={() => void beginMigration()}
            >
              {beginning ? t('common.processing') : t('dataRoot.plan.confirm')}
            </Button>
          </div>
        ) : null}
      >
        {scanning ? (
          <div className="data-root-plan__scanning">
            <span className="data-root-plan__spinner" />
            <strong>{t('dataRoot.plan.scanning')}</strong>
            <code>{targetRoot}</code>
          </div>
        ) : plan ? (
          <div className="data-root-plan">
            <div className="data-root-maintenance__paths">
              <div><span>{t('dataRoot.source')}</span><code>{plan.sourceRoot}</code></div>
              <div><span>{t('dataRoot.target')}</span><code>{plan.targetRoot}</code></div>
            </div>
            <div className="data-root-plan__summary">
              <div><span>{t('dataRoot.files')}</span><strong>{plan.totalFiles.toLocaleString(locale)}</strong></div>
              <div><span>{t('dataRoot.totalSize')}</span><strong>{formatDataBytes(plan.totalBytes, locale)}</strong></div>
              <div><span>{t('dataRoot.requiredSpace')}</span><strong>{formatDataBytes(plan.requiredBytes, locale)}</strong></div>
              <div><span>{t('dataRoot.availableSpace')}</span><strong>{formatDataBytes(plan.availableBytes, locale)}</strong></div>
            </div>
            <div className="data-root-category-list is-plan">
              {plan.categories.map((category) => (
                <div className="data-root-category" key={category.id}>
                  <strong>{t(dataRootCategoryMessageKey[category.id])}</strong>
                  <span>{category.fileCount.toLocaleString(locale)} {t('dataRoot.files')}</span>
                  <small>{formatDataBytes(category.totalBytes, locale)}</small>
                </div>
              ))}
            </div>
            {plan.blockers.map((blocker) => (
              <div className="data-root-plan__issue is-blocker" key={`${blocker.code}:${blocker.path ?? ''}`}>
                {blocker.message}
              </div>
            ))}
            {plan.warnings.map((warning) => (
              <div className="data-root-plan__issue is-warning" key={`${warning.code}:${warning.path ?? ''}`}>
                {warning.message}
              </div>
            ))}
            <p className="data-root-plan__notice">{t('dataRoot.plan.notice')}</p>
            {error ? <div className="data-root-plan__issue is-blocker">{error}</div> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
