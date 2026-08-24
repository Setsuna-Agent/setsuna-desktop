import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useMemo, useSyncExternalStore } from 'react';
import type {
  DesktopUpdateActionResult,
  DesktopUpdateDownloadSourceInput,
  DesktopUpdateState,
} from '../contracts/index.js';
import { useUpdaterRendererService } from './context.js';
import type { UpdaterRendererStateService } from './service.js';

export type UpdaterViewModel = Readonly<{
  available: boolean;
  state: DesktopUpdateState | null;
  checking: boolean;
  installing: boolean;
  ready: boolean;
  currentVersion: string;
  updateVersion: string | null;
  statusTitle: string;
  statusText: string;
  installButtonText: string;
  alertLabel: string;
  checkForUpdates(): Promise<DesktopUpdateState | null>;
  addDownloadSource(input: DesktopUpdateDownloadSourceInput): Promise<DesktopUpdateState | null>;
  selectDownloadSource(sourceId: string): Promise<DesktopUpdateState | null>;
  removeDownloadSource(sourceId: string): Promise<DesktopUpdateState | null>;
  installReadyUpdate(): Promise<DesktopUpdateActionResult | null>;
  promptReadyUpdate(): Promise<DesktopUpdateActionResult | null>;
}>;

export function useUpdaterView(translate: RendererTranslate): UpdaterViewModel {
  return useUpdaterServiceView(useUpdaterRendererService(), translate);
}

export function useUpdaterServiceView(
  service: UpdaterRendererStateService,
  translate: RendererTranslate,
): UpdaterViewModel {
  const snapshot = useSyncExternalStore(service.subscribe, service.snapshot, service.snapshot);
  const { checking, installing, state } = snapshot;

  return useMemo(() => {
    const status = state?.status ?? 'idle';
    const ready = status === 'downloaded';
    const updateVersion = state?.downloadedVersion ?? state?.availableVersion ?? null;
    return {
      available: service.available,
      state,
      checking,
      installing,
      ready,
      currentVersion: state?.currentVersion ?? '0.0.0',
      updateVersion,
      statusTitle: updateStatusTitle(state, checking, translate),
      statusText: updateStatusText(state, service.available, checking, translate),
      installButtonText: state?.manualInstall
        ? translate('feature.updater.install.finder')
        : state?.platform === 'linux'
          ? translate('feature.updater.install.downloads')
          : translate('feature.updater.install.restart'),
      alertLabel: state?.manualInstall
        ? translate('feature.updater.topbar.openInstaller')
        : translate('feature.updater.topbar.restartUpdate'),
      checkForUpdates: service.checkForUpdates,
      addDownloadSource: service.addDownloadSource,
      selectDownloadSource: service.selectDownloadSource,
      removeDownloadSource: service.removeDownloadSource,
      installReadyUpdate: service.installReadyUpdate,
      promptReadyUpdate: service.promptReadyUpdate,
    };
  }, [checking, installing, service, state, translate]);
}

function updateStatusTitle(
  state: DesktopUpdateState | null,
  checking: boolean,
  t: RendererTranslate,
): string {
  const status = state?.status ?? 'idle';
  if (status === 'downloaded') return t('feature.updater.title.downloaded');
  if (status === 'downloading') return t('feature.updater.title.downloading');
  if (status === 'available') return t('feature.updater.title.available');
  if (status === 'checking' || checking) return t('feature.updater.title.checking');
  if (status === 'not-available') return t('feature.updater.title.latest');
  if (status === 'error') return t('feature.updater.title.error');
  if (status === 'unsupported' || state?.canUpdate === false) {
    return t('feature.updater.title.unsupported');
  }
  return t('feature.updater.title.default');
}

function updateStatusText(
  state: DesktopUpdateState | null,
  hasUpdater: boolean,
  checking: boolean,
  t: RendererTranslate,
): string {
  const status = state?.status ?? 'idle';
  const updateVersion = state?.downloadedVersion ?? state?.availableVersion;
  if (status === 'downloaded') {
    return state?.manualInstall
      ? t('feature.updater.text.downloadedManual')
      : t('feature.updater.text.downloaded');
  }
  if (status === 'downloading') {
    return updateVersion
      ? t('feature.updater.text.downloadingVersion', { version: updateVersion })
      : t('feature.updater.text.downloading');
  }
  if (status === 'available') {
    return updateVersion
      ? t('feature.updater.text.availableVersion', { version: updateVersion })
      : t('feature.updater.text.available');
  }
  if (status === 'checking' || checking) return t('feature.updater.text.checking');
  if (status === 'not-available') return t('feature.updater.text.latest');
  if (status === 'error') return state?.error || t('feature.updater.text.retry');
  if (status === 'unsupported' || state?.canUpdate === false) {
    return t('feature.updater.text.unsupported');
  }
  return hasUpdater ? t('feature.updater.text.default') : t('feature.updater.text.desktopOnly');
}
