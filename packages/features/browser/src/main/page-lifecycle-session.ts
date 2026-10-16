import type { WebContents } from 'electron';
import { BROWSER_IPC_CHANNELS } from '../contracts/index.js';
import type { BrowserAutomation } from './cdp/automation.js';
import { BrowserPageLifecycle } from './page-lifecycle.js';
import { inspectPageSleepBlocker, nativePageSleepBlocker } from './page-sleep-guard.js';

export function createBrowserPageLifecycle(tabId: string, contents: WebContents, automation: BrowserAutomation): BrowserPageLifecycle {
  let backgroundThrottling: boolean | undefined;
  const restoreThrottling = () => {
    if (backgroundThrottling === undefined) return;
    if (!contents.isDestroyed()) contents.setBackgroundThrottling(backgroundThrottling);
    backgroundThrottling = undefined;
  };
  return new BrowserPageLifecycle({
    blocker: () => nativePageSleepBlocker(contents),
    inspect: async (signal) => {
      const blocker = await inspectPageSleepBlocker(contents);
      signal.throwIfAborted();
      if (blocker) return blocker;
      return await automation.hasActiveMediaCapture(signal) ? 'media' : null;
    },
    setFrozen: async (frozen) => {
      if (contents.isDestroyed() || contents.isCrashed()) {
        restoreThrottling();
        if (frozen) throw new Error('Browser page is unavailable.');
        return;
      }
      if (frozen) {
        // Electron's scheduler override otherwise acknowledges freezing while timers
        // keep running. Restore the exact previous policy when waking or on failure.
        backgroundThrottling = contents.getBackgroundThrottling();
        contents.setBackgroundThrottling(true);
      }
      try {
        await automation.setPageFrozen(frozen);
      } catch (error) {
        restoreThrottling();
        throw error;
      }
      if (!frozen) restoreThrottling();
    },
    changed: (suspended) => {
      if (contents.isDestroyed()) return;
      const host = contents.hostWebContents;
      if (host && !host.isDestroyed()) host.send(BROWSER_IPC_CHANNELS.pageSleepStateChanged, { tabId, suspended });
    },
    // Controller teardown detaches CDP (which thaws the page). A retained guest
    // must also regain its scheduling policy before another session owns it.
    dispose: restoreThrottling,
  });
}
