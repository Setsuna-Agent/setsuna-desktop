import type {
  DesktopUpdateActionResult,
  DesktopUpdateDownloadSourceInput,
  DesktopUpdateState,
  UpdaterDesktopBridge,
} from '../contracts/index.js';

export type UpdaterRendererSnapshot = Readonly<{
  checking: boolean;
  installing: boolean;
  state: DesktopUpdateState | null;
}>;

const EMPTY_SNAPSHOT: UpdaterRendererSnapshot = Object.freeze({
  checking: false,
  installing: false,
  state: null,
});

export class UpdaterRendererStateService {
  private currentSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private started = false;
  private unsubscribeBridge: (() => void) | null = null;
  readonly available: boolean;

  constructor(private readonly bridge: UpdaterDesktopBridge | null) {
    this.available = bridge !== null;
  }

  readonly snapshot = (): UpdaterRendererSnapshot => this.currentSnapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.started || !this.bridge) return;
    this.started = true;
    const generation = ++this.generation;
    let receivedPush = false;

    this.unsubscribeBridge = this.bridge.onStateChange((state) => {
      if (generation !== this.generation) return;
      receivedPush = true;
      this.update({ state });
    });
    void this.bridge.getState().then((state) => {
      if (generation === this.generation && !receivedPush) this.update({ state });
    }).catch(() => undefined);
  }

  dispose(): void {
    this.generation += 1;
    this.started = false;
    this.unsubscribeBridge?.();
    this.unsubscribeBridge = null;
    this.listeners.clear();
  }

  readonly checkForUpdates = (): Promise<DesktopUpdateState | null> => (
    this.runStateAction('checking', () => this.bridge?.checkForUpdates() ?? null)
  );

  readonly addDownloadSource = (
    input: DesktopUpdateDownloadSourceInput,
  ): Promise<DesktopUpdateState | null> => this.applyState(
    () => this.bridge?.addDownloadSource(input) ?? null,
  );

  readonly selectDownloadSource = (sourceId: string): Promise<DesktopUpdateState | null> => (
    this.applyState(() => this.bridge?.selectDownloadSource(sourceId) ?? null)
  );

  readonly removeDownloadSource = (sourceId: string): Promise<DesktopUpdateState | null> => (
    this.applyState(() => this.bridge?.removeDownloadSource(sourceId) ?? null)
  );

  readonly installReadyUpdate = (): Promise<DesktopUpdateActionResult | null> => (
    this.runInstallAction(() => this.bridge?.quitAndInstall() ?? null)
  );

  readonly promptReadyUpdate = (): Promise<DesktopUpdateActionResult | null> => (
    this.runInstallAction(() => this.bridge?.promptReadyUpdate() ?? null)
  );

  private async runStateAction(
    flag: 'checking',
    action: () => Promise<DesktopUpdateState> | null,
  ): Promise<DesktopUpdateState | null> {
    if (!this.bridge) return null;
    this.update({ [flag]: true });
    try {
      return await this.applyState(action);
    } finally {
      this.update({ [flag]: false });
    }
  }

  private async runInstallAction(
    action: () => Promise<DesktopUpdateActionResult> | null,
  ): Promise<DesktopUpdateActionResult | null> {
    if (!this.bridge) return null;
    this.update({ installing: true });
    try {
      const result = await action();
      if (result) this.update({ state: result.state });
      return result;
    } finally {
      this.update({ installing: false });
    }
  }

  private async applyState(
    action: () => Promise<DesktopUpdateState> | null,
  ): Promise<DesktopUpdateState | null> {
    const state = await action();
    if (state) this.update({ state });
    return state;
  }

  private update(patch: Partial<UpdaterRendererSnapshot>): void {
    this.currentSnapshot = Object.freeze({ ...this.currentSnapshot, ...patch });
    for (const listener of this.listeners) listener();
  }
}
