import { Popconfirm } from 'antd';
import { Info, Monitor, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import type { DesktopUpdaterBridgeState, DesktopUpdaterStateView } from '../../../app/controller/useDesktopUpdater.js';
import { Button, IconButton, SelectField, StatusBadge, TextField } from '../../../shared/ui/primitives.js';

export function AboutSettings({ updater }: { updater: DesktopUpdaterStateView }) {
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
        <div className="chat-user-settings__group-title">应用信息</div>
        <div className="chat-user-settings__group">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Info size={14} />
              <span>当前版本</span>
            </span>
            <strong className="chat-user-settings__value">v{updater.currentVersion}</strong>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Monitor size={14} />
              <span>平台</span>
            </span>
            <code>
              {platform} / {arch}
            </code>
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">更新</div>
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
                <StatusBadge tone={updateBadgeTone(state)}>{updateBadgeText(state)}</StatusBadge>
              </strong>
              <span>{updater.statusText}</span>
              {updater.updateVersion ? <span>目标版本：v{updater.updateVersion.replace(/^v/u, '')}</span> : null}
              {state?.assetName ? <span>安装包：{state.assetName}</span> : null}
              {releaseUrl ? (
                <button className="chat-user-settings__release-link" type="button" title={releaseUrl} onClick={() => void window.setsunaDesktop?.links.openExternal(releaseUrl)}>
                  更新内容：<span>{releaseUrl}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="chat-user-settings__update-actions">
            {showCheckButton ? (
              <Button className="chat-user-settings__update-action" icon={<RefreshCw size={14} />} disabled={updateBusy || updateUnsupported} onClick={() => void updater.checkForUpdates()}>
                {updateBusy ? '检查中' : '检查更新'}
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
          <strong>下载源</strong>
          <span>版本检查仍使用 GitHub API，安装包和校验文件从所选源下载。</span>
        </div>
        <div className="chat-user-settings__download-source-actions">
          <SelectField aria-label="下载源" className="settings-local-control" disabled={sourceBusy || sources.length === 0} value={activeSourceId} onValueChange={(nextValue) => void selectSource(nextValue)}>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>{source.name}</option>
            ))}
          </SelectField>
          <Button icon={<Plus size={14} />} disabled={sourceBusy || !updater.api} onClick={() => {
            setAdding((current) => !current);
            setSourceError(null);
          }}>
            添加源
          </Button>
          {activeSource && !activeSource.builtIn ? (
            <Popconfirm title={`删除“${activeSource.name}”？`} description="删除当前源后会自动切回 GitHub 直连。" placement="topRight" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void removeActiveSource()}>
              <IconButton label={`删除下载源 ${activeSource.name}`} variant="danger" disabled={sourceBusy}>
                <Trash2 size={14} />
              </IconButton>
            </Popconfirm>
          ) : null}
        </div>
      </div>

      {activeSource ? (
        <div className="chat-user-settings__download-source-current" title={activeSource.urlTemplate}>
          当前规则：<code>{activeSource.urlTemplate === '{url}' ? 'GitHub 原始下载地址' : activeSource.urlTemplate}</code>
        </div>
      ) : null}

      {adding ? (
        <form className="chat-user-settings__download-source-form" onSubmit={(event) => void addSource(event)}>
          <TextField aria-label="下载源名称" disabled={sourceBusy} maxLength={40} placeholder="名称，例如：公司镜像" value={sourceName} onChange={(event) => setSourceName(event.currentTarget.value)} />
          <TextField aria-label="下载源地址" disabled={sourceBusy} placeholder="地址或模板，例如：https://ghfast.example/" value={sourceUrl} onChange={(event) => setSourceUrl(event.currentTarget.value)} />
          <div className="chat-user-settings__download-source-form-actions">
            <Button type="submit" variant="primary" disabled={sourceBusy || !sourceName.trim() || !sourceUrl.trim()}>添加并使用</Button>
            <Button disabled={sourceBusy} onClick={() => setAdding(false)}>取消</Button>
          </div>
          <span className="chat-user-settings__download-source-help">只填地址时会自动追加原始下载 URL；高级用法可在模板中使用 {'{url}'} 或 {'{encodedUrl}'}。</span>
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

function updateBadgeTone(state: DesktopUpdaterBridgeState | null): 'neutral' | 'success' | 'warning' | 'danger' {
  if (state?.status === 'downloaded') return 'warning';
  if (state?.status === 'not-available') return 'success';
  if (state?.status === 'error' || state?.status === 'unsupported') return 'danger';
  return 'neutral';
}

function updateBadgeText(state: DesktopUpdaterBridgeState | null): string {
  if (state?.status === 'downloaded') return '待安装';
  if (state?.status === 'downloading') return '下载中';
  if (state?.status === 'checking') return '检查中';
  if (state?.status === 'not-available') return '最新';
  if (state?.status === 'error') return '失败';
  if (state?.status === 'unsupported') return '不可用';
  return '自动';
}
