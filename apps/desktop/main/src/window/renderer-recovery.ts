import type { BrowserWindow, RenderProcessGoneDetails } from 'electron';
import type { DiagnosticReporter } from '@setsuna-desktop/contracts';
import { diagnosticErrorFields, reportDiagnostic } from '../diagnostics/report.js';

const RETRY_DELAY_MS = 1_000;
const STABLE_UPTIME_MS = 60_000;
const MAX_RECOVERY_ATTEMPTS = 2;

type RecoveryOptions = {
  load(): Promise<void>;
  canRecover(): boolean;
  onDiagnostic?: DiagnosticReporter;
};

/** Recover a lost desktop renderer, never a merely slow or background-throttled page. */
export function registerDesktopRendererRecovery(window: BrowserWindow, options: RecoveryOptions): void {
  // BrowserWindow's native webContents getter is unavailable during closed cleanup.
  const contents = window.webContents;
  let disposed = false;
  let pending = false;
  let loading = false;
  let attempts = 0;
  // Native show/hide expresses presentation; macOS isVisible() also depends on
  // occlusion and must not veto recovery after an explicit show/restore/focus.
  let presented = window.isVisible() || window.isFocused();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stable: ReturnType<typeof setTimeout> | undefined;
  const available = () => !disposed && !window.isDestroyed() && !contents.isDestroyed() && options.canRecover();
  const schedule = () => {
    if (!pending || loading || retry || !available() || !presented || window.isMinimized()) return;
    if (attempts >= MAX_RECOVERY_ATTEMPTS) return;
    retry = setTimeout(() => {
      retry = undefined;
      if (!pending || !available() || !presented || window.isMinimized()) return;
      pending = false;
      loading = true;
      attempts += 1;
      const startedAt = performance.now();
      reportDiagnostic(options.onDiagnostic, 'renderer-recovery-started', { senderId: contents.id, attempt: attempts });
      void Promise.resolve().then(() => {
        if (available()) return options.load();
      }).then(() => {
        if (!available() || pending) return;
        reportDiagnostic(options.onDiagnostic, 'renderer-recovery-loaded', {
          senderId: contents.id, attempt: attempts, elapsedMs: Math.round(performance.now() - startedAt),
        });
        // A successful file load alone must not reset a repeated renderer crash loop.
        stable = setTimeout(() => { attempts = 0; }, STABLE_UPTIME_MS);
      }).catch((error: unknown) => {
        pending = true;
        console.error('[desktop-renderer] recovery load failed', { senderId: contents.id, attempt: attempts }, error);
        reportDiagnostic(options.onDiagnostic, 'renderer-recovery-failed', {
          senderId: contents.id, attempt: attempts, ...diagnosticErrorFields(error),
        });
      }).finally(() => {
        loading = false;
        if (pending && attempts >= MAX_RECOVERY_ATTEMPTS) {
          console.error('[desktop-renderer] automatic recovery limit reached', { senderId: contents.id });
          reportDiagnostic(options.onDiagnostic, 'renderer-recovery-limit-reached', { senderId: contents.id, attempts });
        }
        schedule();
      });
    }, RETRY_DELAY_MS);
  };
  const gone = (_event: unknown, details: RenderProcessGoneDetails) => {
    clearTimeout(stable);
    stable = undefined;
    console.error('[desktop-renderer] render process gone', {
      senderId: contents.id, reason: details.reason, exitCode: details.exitCode,
    });
    if (details.reason === 'clean-exit' || !available()) return;
    pending = true;
    if (attempts >= MAX_RECOVERY_ATTEMPTS) {
      console.error('[desktop-renderer] automatic recovery limit reached', { senderId: contents.id });
      reportDiagnostic(options.onDiagnostic, 'renderer-recovery-limit-reached', { senderId: contents.id, attempts });
    }
    // Hidden windows stay idle until shown; recovery never steals focus or restarts runtime.
    schedule();
  };
  const unresponsive = () => {
    console.warn('[desktop-renderer] window unresponsive', { senderId: contents.id });
  };
  const shown = () => { presented = true; schedule(); };
  const hidden = () => { presented = false; clearTimeout(retry); retry = undefined; };
  contents.on('render-process-gone', gone);
  window.on('unresponsive', unresponsive);
  window.on('show', shown);
  window.on('restore', shown);
  window.on('focus', shown);
  window.on('hide', hidden);
  // Resources may have loaded before slow service preparation finished. Catch a
  // process lost in that gap without adding work to the startup readiness path.
  if (contents.isCrashed()) {
    pending = true;
    schedule();
  }
  window.once('closed', () => {
    disposed = true;
    clearTimeout(retry);
    clearTimeout(stable);
    contents.removeListener('render-process-gone', gone);
    window.removeListener('unresponsive', unresponsive);
    window.removeListener('show', shown);
    window.removeListener('restore', shown);
    window.removeListener('focus', shown);
    window.removeListener('hide', hidden);
  });
}
