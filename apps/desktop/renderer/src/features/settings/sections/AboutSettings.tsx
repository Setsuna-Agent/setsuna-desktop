import type { DesktopUpdateDownloadSource } from '@setsuna-desktop/contracts';
import { Popconfirm } from 'antd';
import { Info, Monitor, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import type { DesktopUpdaterBridgeState, DesktopUpdaterStateView } from '../../../app/controller/useDesktopUpdater.js';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { Button, IconButton, SelectField, StatusBadge, TextField } from '../../../shared/ui/primitives.js';

export function AboutSettings({ updater }: { updater: DesktopUpdaterStateView }) {
  const { t } = useI18n();
  const state = updater.state;
  const updatePercent = updater.ready ? 100 : Math.round(state?.progress?.percent ?? 0);
  const updateBusy = updater.checking || state?.status === 'checking' || state?.status === 'available' || state?.status === 'downloading';
  const updateUnsupported = state?.canUpdate === false || state?.status === 'unsupported';
  const showCheckButton = Boolean(updater.api && !updater.ready);
  const showProgress = updateBusy || updater.ready;
  const releaseUrl = state?.releaseUrl ?? state?.feedUrl ?? null;
  const platform = state?.platform ?? (typeof window === 'undefined' ? 'desktop' : window.setsunaDesktop?.desktop.platform ?? 'desktop');
  const arch = state?.arch ?? 'unknown';

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__about-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.about.appInfo')}</div>
        <div className="chat-user-settings__group">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Info size={14} />
              <span>{t('settings.about.currentVersion')}</span>
            </span>
            <strong className="chat-user-settings__value">v{updater.currentVersion}</strong>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Monitor size={14} />
              <span>{t('settings.about.platform')}</span>
            </span>
            <code>
              {platform} / {arch}
            </code>
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.about.updates')}</div>
        <div className="chat-user-settings__group chat-user-settings__update-panel">
          <div className="chat-user-settings__update-main">
            {showProgress ? (
              <span className="chat-user-settings__update-progress" style={{ '--settings-update-progress': `${updatePercent}%` } as CSSProperties}>
                <span>{updatePercent}%</span>
              </span>
            ) : null}
            <div className="chat-user-settings__update-copy">
              <strong>
                {updater.statusTitle}
                <StatusBadge tone={updateBadgeTone(state)}>{updateBadgeText(state, t)}</StatusBadge>
              </strong>
              <span>{updater.statusText}</span>
              {updater.updateVersion ? <span>{t('settings.about.targetVersion', { version: updater.updateVersion.replace(/^v/u, '') })}</span> : null}
              {state?.assetName ? <span>{t('settings.about.package', { name: state.assetName })}</span> : null}
              {releaseUrl ? (
                <button className="chat-user-settings__release-link" type="button" title={releaseUrl} onClick={() => void window.setsunaDesktop?.links.openExternal(releaseUrl)}>
                  {t('settings.about.releaseNotes')}<span>{releaseUrl}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="chat-user-settings__update-actions">
            {showCheckButton ? (
              <Button className="chat-user-settings__update-action" icon={<RefreshCw size={14} />} disabled={updateBusy || updateUnsupported} onClick={() => void updater.checkForUpdates()}>
                {updateBusy ? t('settings.about.checking') : t('settings.about.check')}
              </Button>
            ) : null}
            {updater.ready ? (
              <Button className="chat-user-settings__update-action chat-user-settings__update-action--primary" variant="primary" disabled={updater.installing} onClick={() => void updater.installReadyUpdate()}>
                {updater.installButtonText}
              </Button>
            ) : null}
          </div>
        </div>
        <UpdateDownloadSourceSettings updater={updater} />
      </div>
    </div>
  );
}

function UpdateDownloadSourceSettings({ updater }: { updater: DesktopUpdaterStateView }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const sources = updater.state?.downloadSources ?? [];
  const activeSourceId = updater.state?.activeDownloadSourceId ?? sources[0]?.id ?? '';
  const activeSource = sources.find((source) => source.id === activeSourceId) ?? sources[0] ?? null;

  const runSourceAction = async (action: () => Promise<unknown>) => {
    setSourceBusy(true);
    setSourceError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setSourceError(formatUpdaterError(error));
      return false;
    } finally {
      setSourceBusy(false);
    }
  };

  const addSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await runSourceAction(() => updater.addDownloadSource({ name: sourceName, urlTemplate: sourceUrl }));
    if (!saved) return;
    setSourceName('');
    setSourceUrl('');
    setAdding(false);
  };

  const selectSource = async (sourceId: string) => {
    if (!sourceId || sourceId === activeSourceId) return;
    await runSourceAction(() => updater.selectDownloadSource(sourceId));
  };

  const removeActiveSource = async () => {
    if (!activeSource || activeSource.builtIn) return;
    await runSourceAction(() => updater.removeDownloadSource(activeSource.id));
  };

  return (
    <div className="chat-user-settings__group chat-user-settings__download-source-panel">
      <div className="chat-user-settings__download-source-main">
        <div className="chat-user-settings__download-source-copy">
          <strong>{t('settings.about.downloadSource')}</strong>
          <span>{t('settings.about.downloadSourceDescription')}</span>
        </div>
        <div className="chat-user-settings__download-source-actions">
          <SelectField aria-label={t('settings.about.downloadSource')} className="settings-local-control" disabled={sourceBusy || sources.length === 0} value={activeSourceId} onValueChange={(nextValue) => void selectSource(nextValue)}>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>{updateDownloadSourceName(source, t)}</option>
            ))}
          </SelectField>
          <Button icon={<Plus size={14} />} disabled={sourceBusy || !updater.api} onClick={() => {
            setAdding((current) => !current);
            setSourceError(null);
          }}>
            {t('settings.about.addSource')}
          </Button>
          {activeSource && !activeSource.builtIn ? (
            <Popconfirm title={t('settings.about.deleteSourceTitle', { name: activeSource.name })} description={t('settings.about.deleteSourceDescription')} placement="topRight" okText={t('common.delete')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }} onConfirm={() => void removeActiveSource()}>
              <IconButton label={t('settings.about.deleteSourceLabel', { name: activeSource.name })} variant="danger" disabled={sourceBusy}>
                <Trash2 size={14} />
              </IconButton>
            </Popconfirm>
          ) : null}
        </div>
      </div>

      {activeSource ? (
        <div className="chat-user-settings__download-source-current" title={activeSource.urlTemplate}>
          {t('settings.about.currentRule')}<code>{activeSource.urlTemplate === '{url}' ? t('settings.about.githubOriginalUrl') : activeSource.urlTemplate}</code>
        </div>
      ) : null}

      {adding ? (
        <form className="chat-user-settings__download-source-form" onSubmit={(event) => void addSource(event)}>
          <TextField aria-label={t('settings.about.sourceName')} disabled={sourceBusy} maxLength={40} placeholder={t('settings.about.sourceNamePlaceholder')} value={sourceName} onChange={(event) => setSourceName(event.currentTarget.value)} />
          <TextField aria-label={t('settings.about.sourceUrl')} disabled={sourceBusy} placeholder={t('settings.about.sourceUrlPlaceholder')} value={sourceUrl} onChange={(event) => setSourceUrl(event.currentTarget.value)} />
          <div className="chat-user-settings__download-source-form-actions">
            <Button type="submit" variant="primary" disabled={sourceBusy || !sourceName.trim() || !sourceUrl.trim()}>{t('settings.about.addAndUse')}</Button>
            <Button disabled={sourceBusy} onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
          </div>
          <span className="chat-user-settings__download-source-help">{t('settings.about.sourceHelp')}</span>
        </form>
      ) : null}

      {sourceError ? <div className="chat-user-settings__download-source-error" role="alert">{sourceError}</div> : null}
    </div>
  );
}

function formatUpdaterError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message.replace(/^Error invoking remote method '[^']+':\s*/u, '');
}

export function updateDownloadSourceName(
  source: Pick<DesktopUpdateDownloadSource, 'builtIn' | 'id' | 'name'>,
  t: Translate,
): string {
  return source.builtIn && source.id === 'github-direct'
    ? t('settings.about.githubDirect')
    : source.name;
}

function updateBadgeTone(state: DesktopUpdaterBridgeState | null): 'neutral' | 'success' | 'warning' | 'danger' {
  if (state?.status === 'downloaded') return 'warning';
  if (state?.status === 'not-available') return 'success';
  if (state?.status === 'error' || state?.status === 'unsupported') return 'danger';
  return 'neutral';
}

function updateBadgeText(state: DesktopUpdaterBridgeState | null, t: Translate): string {
  if (state?.status === 'downloaded') return t('settings.about.badge.pending');
  if (state?.status === 'downloading') return t('settings.about.badge.downloading');
  if (state?.status === 'checking') return t('settings.about.badge.checking');
  if (state?.status === 'not-available') return t('settings.about.badge.latest');
  if (state?.status === 'error') return t('settings.about.badge.failed');
  if (state?.status === 'unsupported') return t('settings.about.badge.unavailable');
  return t('settings.about.badge.automatic');
}
