import { useCallback, useEffect, useMemo, useState } from 'react';

type DesktopUpdaterApi = NonNullable<Window['setsunaDesktop']>['updater'];
export type DesktopUpdaterBridgeState = Awaited<ReturnType<DesktopUpdaterApi['getState']>>;
export type DesktopUpdateBridgeActionResult = Awaited<ReturnType<DesktopUpdaterApi['quitAndInstall']>>;

export type DesktopUpdaterStateView = {
  api: DesktopUpdaterApi | null;
  state: DesktopUpdaterBridgeState | null;
  checking: boolean;
  installing: boolean;
  ready: boolean;
  currentVersion: string;
  updateVersion: string | null;
  statusTitle: string;
  statusText: string;
  installButtonText: string;
  checkForUpdates: () => Promise<DesktopUpdaterBridgeState | null>;
  installReadyUpdate: () => Promise<DesktopUpdateBridgeActionResult | null>;
  promptReadyUpdate: () => Promise<DesktopUpdateBridgeActionResult | null>;
};

export function useDesktopUpdater(): DesktopUpdaterStateView {
  const api = typeof window === 'undefined' ? null : window.setsunaDesktop?.updater ?? null;
  const [state, setState] = useState<DesktopUpdaterBridgeState | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!api) return undefined;

    let mounted = true;
    api
      .getState()
      .then((nextState) => {
        if (mounted) setState(nextState);
      })
      .catch(() => undefined);

    const unsubscribe = api.onStateChange((nextState) => {
      setState(nextState);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [api]);

  const checkForUpdates = useCallback(async () => {
    if (!api) return null;
    setChecking(true);
    try {
      const nextState = await api.checkForUpdates();
      setState(nextState);
      return nextState;
    } finally {
      setChecking(false);
    }
  }, [api]);

  const installReadyUpdate = useCallback(async () => {
    if (!api) return null;
    setInstalling(true);
    try {
      const result = await api.quitAndInstall();
      setState(result.state);
      return result;
    } finally {
      setInstalling(false);
    }
  }, [api]);

  const promptReadyUpdate = useCallback(async () => {
    if (!api) return null;
    setInstalling(true);
    try {
      const result = await api.promptReadyUpdate();
      setState(result.state);
      return result;
    } finally {
      setInstalling(false);
    }
  }, [api]);

  return useMemo(() => {
    const status = state?.status ?? 'idle';
    const ready = status === 'downloaded';
    const updateVersion = state?.downloadedVersion ?? state?.availableVersion ?? null;

    return {
      api,
      state,
      checking,
      installing,
      ready,
      currentVersion: state?.currentVersion ?? '0.0.0',
      updateVersion,
      statusTitle: updateStatusTitle(state, checking),
      statusText: updateStatusText(state, Boolean(api), checking),
      installButtonText: state?.manualInstall ? '打开访达' : state?.platform === 'linux' ? '打开下载目录' : '重启安装',
      checkForUpdates,
      installReadyUpdate,
      promptReadyUpdate,
    };
  }, [api, checkForUpdates, checking, installReadyUpdate, installing, promptReadyUpdate, state]);
}

function updateStatusTitle(state: DesktopUpdaterBridgeState | null, checking: boolean): string {
  const status = state?.status ?? 'idle';

  if (status === 'downloaded') return '更新已下载';
  if (status === 'downloading') return '正在下载更新';
  if (status === 'available') return '发现新版本';
  if (status === 'checking' || checking) return '正在检查更新';
  if (status === 'not-available') return '已是最新版本';
  if (status === 'error') return '更新检查失败';
  if (status === 'unsupported' || state?.canUpdate === false) return '不支持在线更新';

  return '桌面端更新';
}

function updateStatusText(state: DesktopUpdaterBridgeState | null, hasUpdater: boolean, checking: boolean): string {
  const status = state?.status ?? 'idle';
  const updateVersion = state?.downloadedVersion ?? state?.availableVersion;

  if (status === 'downloaded') {
    if (state?.manualInstall) return '安装包已准备完成。点击右上角铃铛或下方按钮后，打开访达定位安装包。';
    return '安装包已准备完成。点击右上角铃铛或下方按钮后，重启完成安装。';
  }
  if (status === 'downloading') return updateVersion ? `新版本 ${updateVersion} 正在自动下载。` : '发现新版本，正在自动下载。';
  if (status === 'available') return updateVersion ? `发现新版本 ${updateVersion}，已开始自动下载。` : '发现新版本，已开始自动下载。';
  if (status === 'checking' || checking) return '正在从 GitHub Release 检查最新版本。';
  if (status === 'not-available') return '当前安装的版本已经是最新版本。';
  if (status === 'error') return state?.error || '请稍后再试。';
  if (status === 'unsupported' || state?.canUpdate === false) return state?.error || '开发模式默认不自动更新，正式安装包会启用。';

  return hasUpdater ? '应用启动后会自动检查并下载可用更新。' : '仅桌面端支持在线更新。';
}
