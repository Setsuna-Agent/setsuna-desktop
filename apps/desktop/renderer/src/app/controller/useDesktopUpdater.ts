import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';

type DesktopUpdaterApi = NonNullable<Window['setsunaDesktop']>['updater'];
type DesktopDownloadSourceInput = Parameters<DesktopUpdaterApi['addDownloadSource']>[0];
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
  addDownloadSource: (input: DesktopDownloadSourceInput) => Promise<DesktopUpdaterBridgeState | null>;
  selectDownloadSource: (sourceId: string) => Promise<DesktopUpdaterBridgeState | null>;
  removeDownloadSource: (sourceId: string) => Promise<DesktopUpdaterBridgeState | null>;
  installReadyUpdate: () => Promise<DesktopUpdateBridgeActionResult | null>;
  promptReadyUpdate: () => Promise<DesktopUpdateBridgeActionResult | null>;
};

export function useDesktopUpdater(): DesktopUpdaterStateView {
  const { t } = useI18n();
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

  const addDownloadSource = useCallback(async (input: DesktopDownloadSourceInput) => {
    if (!api) return null;
    const nextState = await api.addDownloadSource(input);
    setState(nextState);
    return nextState;
  }, [api]);

  const selectDownloadSource = useCallback(async (sourceId: string) => {
    if (!api) return null;
    const nextState = await api.selectDownloadSource(sourceId);
    setState(nextState);
    return nextState;
  }, [api]);

  const removeDownloadSource = useCallback(async (sourceId: string) => {
    if (!api) return null;
    const nextState = await api.removeDownloadSource(sourceId);
    setState(nextState);
    return nextState;
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
      statusTitle: updateStatusTitle(state, checking, t),
      statusText: updateStatusText(state, Boolean(api), checking, t),
      installButtonText: state?.manualInstall ? t('updater.install.finder') : state?.platform === 'linux' ? t('updater.install.downloads') : t('updater.install.restart'),
      checkForUpdates,
      addDownloadSource,
      selectDownloadSource,
      removeDownloadSource,
      installReadyUpdate,
      promptReadyUpdate,
    };
  }, [addDownloadSource, api, checkForUpdates, checking, installReadyUpdate, installing, promptReadyUpdate, removeDownloadSource, selectDownloadSource, state, t]);
}

function updateStatusTitle(state: DesktopUpdaterBridgeState | null, checking: boolean, t: Translate): string {
  const status = state?.status ?? 'idle';

  if (status === 'downloaded') return t('updater.title.downloaded');
  if (status === 'downloading') return t('updater.title.downloading');
  if (status === 'available') return t('updater.title.available');
  if (status === 'checking' || checking) return t('updater.title.checking');
  if (status === 'not-available') return t('updater.title.latest');
  if (status === 'error') return t('updater.title.error');
  if (status === 'unsupported' || state?.canUpdate === false) return t('updater.title.unsupported');

  return t('updater.title.default');
}

function updateStatusText(state: DesktopUpdaterBridgeState | null, hasUpdater: boolean, checking: boolean, t: Translate): string {
  const status = state?.status ?? 'idle';
  const updateVersion = state?.downloadedVersion ?? state?.availableVersion;

  if (status === 'downloaded') {
    if (state?.manualInstall) return t('updater.text.downloadedManual');
    return t('updater.text.downloaded');
  }
  if (status === 'downloading') return updateVersion ? t('updater.text.downloadingVersion', { version: updateVersion }) : t('updater.text.downloading');
  if (status === 'available') return updateVersion ? t('updater.text.availableVersion', { version: updateVersion }) : t('updater.text.available');
  if (status === 'checking' || checking) return t('updater.text.checking');
  if (status === 'not-available') return t('updater.text.latest');
  if (status === 'error') return state?.error || t('updater.text.retry');
  if (status === 'unsupported' || state?.canUpdate === false) return t('updater.text.unsupported');

  return hasUpdater ? t('updater.text.default') : t('updater.text.desktopOnly');
}
