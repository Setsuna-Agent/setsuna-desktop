import type { FeatureId } from '@setsuna-desktop/feature-core/definition';
import type { FeatureSettingsDiagnosis } from '@setsuna-desktop/feature-core/settings';
import type { FeatureStatusSnapshot } from '@setsuna-desktop/feature-core/status';
import { AlertTriangle, RefreshCw, RotateCcw, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type Translate } from '../shared/i18n/I18nProvider.js';
import { Button } from '../shared/ui/primitives.js';
import {
  createFeatureManagementClient,
  type FeatureManagementClient,
  type RegisteredFeatureSettingsDocument,
} from './feature-management-client.js';
import './feature-recovery-shell.css';

type RecoveryReason = 'view-failed' | 'view-missing';

type RecoveryState = Readonly<{
  diagnoses: readonly FeatureSettingsDiagnosis[];
  documents: readonly RegisteredFeatureSettingsDocument[];
  statuses: readonly FeatureStatusSnapshot[];
}>;

export function FeatureRecoveryShell({
  candidateFeatureIds,
  onRetryView,
  reason,
}: Readonly<{
  candidateFeatureIds: readonly string[];
  onRetryView?: () => void;
  reason: RecoveryReason;
}>) {
  const { t } = useI18n();
  const client = useMemo(createClient, []);
  const candidates = useMemo(
    () => Object.freeze([...new Set(candidateFeatureIds.filter(Boolean))]),
    [candidateFeatureIds],
  );
  const [state, setState] = useState<RecoveryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setState(null);
    if (!client) {
      setError('Desktop Feature management bridge is unavailable.');
      setLoading(false);
      return () => abort.abort();
    }
    void loadRecoveryState(client, candidates, abort.signal).then((next) => {
      if (!abort.signal.aborted) setState(next);
    }).catch((loadError: unknown) => {
      if (!abort.signal.aborted) setError(errorMessage(loadError));
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [candidates, client, reloadToken]);

  async function reset(diagnosis: FeatureSettingsDiagnosis): Promise<void> {
    if (!client) return;
    const key = documentKey(diagnosis.featureId, diagnosis.documentId);
    setResetting(key);
    setError(null);
    try {
      await client.resetDocument({
        featureId: diagnosis.featureId,
        documentId: diagnosis.documentId,
        expectedDiagnosisId: diagnosis.diagnosisId,
        confirmed: true,
      });
      setConfirming(null);
      refresh();
    } catch (resetError) {
      setError(errorMessage(resetError));
    } finally {
      setResetting(null);
    }
  }

  if (!candidates.length) return null;
  if (!loading && !error && state && !state.statuses.length && !state.documents.length) return null;

  return (
    <section className="feature-recovery" data-feature-recovery="true" role="status">
      <header className="feature-recovery__header">
        <span className="feature-recovery__icon"><Wrench size={16} /></span>
        <div>
          <h3>{t('featureRecovery.title')}</h3>
          <p>{t(reason === 'view-failed' ? 'featureRecovery.viewFailed' : 'featureRecovery.viewMissing')}</p>
        </div>
      </header>

      {loading ? <p className="feature-recovery__notice">{t('featureRecovery.loading')}</p> : null}
      {error ? (
        <p className="feature-recovery__notice is-error"><AlertTriangle size={14} />{t('featureRecovery.unavailable', { error })}</p>
      ) : null}

      {state?.statuses.length ? (
        <ul className="feature-recovery__list">
          {state.statuses.map((status) => (
            <li key={status.featureId}>
              <div><strong>{status.featureId}</strong><span>{statusLabel(status.status, t)}</span></div>
              {status.diagnostic ? <p>{status.diagnostic.message} <code>{status.diagnostic.code}</code></p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state?.diagnoses.length ? (
        <ul className="feature-recovery__list">
          {state.diagnoses.map((diagnosis) => {
            const key = documentKey(diagnosis.featureId, diagnosis.documentId);
            const canReset = diagnosis.status !== 'ok';
            return (
              <li key={key}>
                <div>
                  <strong>{diagnosis.featureId} / {diagnosis.documentId}</strong>
                  <span>{diagnosisLabel(diagnosis.status, t)}</span>
                </div>
                {canReset && confirming !== key ? (
                  <Button onClick={() => setConfirming(key)} variant="danger">
                    {t('featureRecovery.reset')}
                  </Button>
                ) : null}
                {canReset && confirming === key ? (
                  <div className="feature-recovery__confirmation">
                    <p>{t('featureRecovery.resetWarning')}</p>
                    <Button disabled={resetting === key} onClick={() => void reset(diagnosis)} variant="danger">
                      {t('featureRecovery.resetConfirm')}
                    </Button>
                    <Button disabled={resetting === key} onClick={() => setConfirming(null)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <footer className="feature-recovery__actions">
        {onRetryView ? <Button icon={<RotateCcw size={14} />} onClick={onRetryView}>{t('featureRecovery.retryView')}</Button> : null}
        <Button icon={<RefreshCw size={14} />} onClick={refresh}>{t('featureRecovery.refresh')}</Button>
      </footer>
    </section>
  );
}

async function loadRecoveryState(
  client: FeatureManagementClient,
  candidateFeatureIds: readonly string[],
  signal: AbortSignal,
): Promise<RecoveryState> {
  const snapshot = await client.getStatus({ signal });
  const candidateSet = new Set(candidateFeatureIds);
  const statuses = snapshot.features.filter(({ featureId }) => candidateSet.has(featureId));
  const documents = snapshot.settings.filter(({ featureId }) => candidateSet.has(featureId));
  const diagnoses = await Promise.all(documents.map(({ featureId, documentId }) => (
    client.diagnoseDocument(featureId, documentId, { signal })
  )));
  return Object.freeze({
    statuses: Object.freeze(statuses),
    documents: Object.freeze(documents),
    diagnoses: Object.freeze(diagnoses),
  });
}

function createClient(): FeatureManagementClient | null {
  const bridge = window.setsunaDesktop?.runtime;
  return bridge ? createFeatureManagementClient(bridge) : null;
}

function statusLabel(status: FeatureStatusSnapshot['status'], t: Translate): string {
  if (status === 'active') return t('featureRecovery.status.active');
  if (status === 'degraded') return t('featureRecovery.status.degraded');
  if (status === 'failed') return t('featureRecovery.status.failed');
  return t('featureRecovery.status.blocked');
}

function diagnosisLabel(status: FeatureSettingsDiagnosis['status'], t: Translate): string {
  if (status === 'ok') return t('featureRecovery.diagnosis.ok');
  if (status === 'missing') return t('featureRecovery.diagnosis.missing');
  if (status === 'schema-invalid') return t('featureRecovery.diagnosis.schemaInvalid');
  if (status === 'migration-failed') return t('featureRecovery.diagnosis.migrationFailed');
  return t('featureRecovery.diagnosis.secretReferenceUnavailable');
}

function documentKey(featureId: FeatureId, documentId: string): string {
  return `${featureId}\u0000${documentId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
