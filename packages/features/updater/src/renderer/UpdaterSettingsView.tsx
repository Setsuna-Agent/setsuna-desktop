import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { Popconfirm } from 'antd';
import { Info, Monitor, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type {
  DesktopUpdateDownloadSource,
  DesktopUpdateState,
} from '../contracts/index.js';
import type { UpdaterRendererStateService } from './service.js';
import { useUpdaterServiceView, type UpdaterViewModel } from './view-model.js';
import './updater.css';

export function UpdaterSettingsView({
  openExternal,
  platform,
  service,
  translate,
  ui,
}: Readonly<{
  openExternal(url: string): Promise<boolean>;
  platform: string;
  service: UpdaterRendererStateService;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const updater = useUpdaterServiceView(service, translate);
  const { Button, Group, Row, Section } = ui;
  const state = updater.state;
  const updatePercent = updater.ready ? 100 : Math.round(state?.progress?.percent ?? 0);
  const updateBusy = updater.checking
    || state?.status === 'checking'
    || state?.status === 'available'
    || state?.status === 'downloading';
  const updateUnsupported = state?.canUpdate === false || state?.status === 'unsupported';
  const showCheckButton = updater.available && !updater.ready;
  const showProgress = updateBusy || updater.ready;
  const releaseUrl = state?.releaseUrl ?? state?.feedUrl ?? null;
  const displayedPlatform = state?.platform ?? platform;
  const arch = state?.arch ?? 'unknown';

  return (
    <Section className="updater-settings" featureId="updater">
      <Group title={translate('feature.updater.settings.appInfo')}>
        <Row
          icon={<Info size={14} />}
          label={translate('feature.updater.settings.currentVersion')}
        >
          <strong className="updater-settings__value">v{updater.currentVersion}</strong>
        </Row>
        <Row
          icon={<Monitor size={14} />}
          label={translate('feature.updater.settings.platform')}
        >
          <code className="updater-settings__platform">{displayedPlatform} / {arch}</code>
        </Row>
      </Group>

      <Group
        className="updater-settings__update-group"
        title={translate('feature.updater.settings.updates')}
      >
        <div className="updater-settings__update-panel">
          <div className="updater-settings__update-main">
            {showProgress ? (
              <span
                className="updater-settings__update-progress"
                style={{ '--updater-progress': `${updatePercent}%` } as CSSProperties}
              >
                <span>{updatePercent}%</span>
              </span>
            ) : null}
            <div className="updater-settings__update-copy">
              <strong>
                {updater.statusTitle}
                <UpdaterStatusBadge tone={updateBadgeTone(state)}>
                  {updateBadgeText(state, translate)}
                </UpdaterStatusBadge>
              </strong>
              <span>{updater.statusText}</span>
              {updater.updateVersion ? (
                <span>
                  {translate('feature.updater.settings.targetVersion', {
                    version: updater.updateVersion.replace(/^v/u, ''),
                  })}
                </span>
              ) : null}
              {state?.assetName ? (
                <span>{translate('feature.updater.settings.package', { name: state.assetName })}</span>
              ) : null}
              {releaseUrl ? (
                <button
                  className="updater-settings__release-link"
                  type="button"
                  title={releaseUrl}
                  onClick={() => void openExternal(releaseUrl)}
                >
                  {translate('feature.updater.settings.releaseNotes')}<span>{releaseUrl}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="updater-settings__update-actions">
            {showCheckButton ? (
              <Button
                className="updater-settings__update-action"
                icon={<RefreshCw size={14} />}
                disabled={updateBusy || updateUnsupported}
                onClick={() => void updater.checkForUpdates()}
              >
                {updateBusy
                  ? translate('feature.updater.settings.checking')
                  : translate('feature.updater.settings.check')}
              </Button>
            ) : null}
            {updater.ready ? (
              <Button
                className="updater-settings__update-action"
                variant="primary"
                disabled={updater.installing}
                onClick={() => void updater.installReadyUpdate()}
              >
                {updater.installButtonText}
              </Button>
            ) : null}
          </div>
        </div>
      </Group>
      <UpdateDownloadSourceSettings updater={updater} translate={translate} ui={ui} />
    </Section>
  );
}

function UpdateDownloadSourceSettings({
  updater,
  translate,
  ui,
}: Readonly<{
  updater: UpdaterViewModel;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { Button, Group, IconButton, SelectField, TextField } = ui;
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
    const saved = await runSourceAction(() => updater.addDownloadSource({
      name: sourceName,
      urlTemplate: sourceUrl,
    }));
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
    <Group className="updater-settings__download-source-group">
      <div className="updater-settings__download-source-panel">
        <div className="updater-settings__download-source-main">
          <div className="updater-settings__download-source-copy">
            <strong>{translate('feature.updater.settings.downloadSource')}</strong>
            <span>{translate('feature.updater.settings.downloadSourceDescription')}</span>
          </div>
          <div className="updater-settings__download-source-actions">
            <SelectField
              aria-label={translate('feature.updater.settings.downloadSource')}
              className="updater-settings__download-source-select"
              disabled={sourceBusy || sources.length === 0}
              value={activeSourceId}
              onValueChange={(nextValue) => void selectSource(nextValue)}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {updateDownloadSourceName(source, translate)}
                </option>
              ))}
            </SelectField>
            <Button
              className="updater-settings__compact-action"
              icon={<Plus size={14} />}
              disabled={sourceBusy || !updater.available}
              onClick={() => {
                setAdding((current) => !current);
                setSourceError(null);
              }}
            >
              {translate('feature.updater.settings.addSource')}
            </Button>
            {activeSource && !activeSource.builtIn ? (
              <Popconfirm
                title={translate('feature.updater.settings.deleteSourceTitle', { name: activeSource.name })}
                description={translate('feature.updater.settings.deleteSourceDescription')}
                placement="topRight"
                okText={translate('feature.updater.common.delete')}
                cancelText={translate('feature.updater.common.cancel')}
                okButtonProps={{ danger: true }}
                onConfirm={() => void removeActiveSource()}
              >
                <IconButton
                  className="updater-settings__compact-action"
                  label={translate('feature.updater.settings.deleteSourceLabel', {
                    name: activeSource.name,
                  })}
                  variant="danger"
                  disabled={sourceBusy}
                >
                  <Trash2 size={14} />
                </IconButton>
              </Popconfirm>
            ) : null}
          </div>
        </div>

        {activeSource ? (
          <div className="updater-settings__download-source-current" title={activeSource.urlTemplate}>
            {translate('feature.updater.settings.currentRule')}
            <code>
              {activeSource.urlTemplate === '{url}'
                ? translate('feature.updater.settings.githubOriginalUrl')
                : activeSource.urlTemplate}
            </code>
          </div>
        ) : null}

        {adding ? (
          <form className="updater-settings__download-source-form" onSubmit={(event) => void addSource(event)}>
            <TextField
              aria-label={translate('feature.updater.settings.sourceName')}
              disabled={sourceBusy}
              maxLength={40}
              placeholder={translate('feature.updater.settings.sourceNamePlaceholder')}
              value={sourceName}
              onChange={(event) => setSourceName(event.currentTarget.value)}
            />
            <TextField
              aria-label={translate('feature.updater.settings.sourceUrl')}
              disabled={sourceBusy}
              placeholder={translate('feature.updater.settings.sourceUrlPlaceholder')}
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.currentTarget.value)}
            />
            <div className="updater-settings__download-source-form-actions">
              <Button
                className="updater-settings__compact-action"
                type="submit"
                variant="primary"
                disabled={sourceBusy || !sourceName.trim() || !sourceUrl.trim()}
              >
                {translate('feature.updater.settings.addAndUse')}
              </Button>
              <Button
                className="updater-settings__compact-action"
                disabled={sourceBusy}
                onClick={() => setAdding(false)}
              >
                {translate('feature.updater.common.cancel')}
              </Button>
            </div>
            <span className="updater-settings__download-source-help">
              {translate('feature.updater.settings.sourceHelp')}
            </span>
          </form>
        ) : null}

        {sourceError ? (
          <div className="updater-settings__download-source-error" role="alert">{sourceError}</div>
        ) : null}
      </div>
    </Group>
  );
}

function UpdaterStatusBadge({
  children,
  tone,
}: Readonly<{
  children: ReactNode;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}>) {
  return (
    <span className={`updater-settings__status updater-settings__status--${tone}`}>
      {children}
    </span>
  );
}

function formatUpdaterError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message.replace(/^Error invoking remote method '[^']+':\s*/u, '');
}

export function updateDownloadSourceName(
  source: Pick<DesktopUpdateDownloadSource, 'builtIn' | 'id' | 'name'>,
  translate: RendererTranslate,
): string {
  return source.builtIn && source.id === 'github-direct'
    ? translate('feature.updater.settings.githubDirect')
    : source.name;
}

function updateBadgeTone(
  state: DesktopUpdateState | null,
): 'neutral' | 'success' | 'warning' | 'danger' {
  if (state?.status === 'downloaded') return 'warning';
  if (state?.status === 'not-available') return 'success';
  if (state?.status === 'error' || state?.status === 'unsupported') return 'danger';
  return 'neutral';
}

function updateBadgeText(state: DesktopUpdateState | null, t: RendererTranslate): string {
  if (state?.status === 'downloaded') return t('feature.updater.settings.badge.pending');
  if (state?.status === 'downloading') return t('feature.updater.settings.badge.downloading');
  if (state?.status === 'checking') return t('feature.updater.settings.badge.checking');
  if (state?.status === 'not-available') return t('feature.updater.settings.badge.latest');
  if (state?.status === 'error') return t('feature.updater.settings.badge.failed');
  if (state?.status === 'unsupported') return t('feature.updater.settings.badge.unavailable');
  return t('feature.updater.settings.badge.automatic');
}
