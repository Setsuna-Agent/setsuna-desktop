import { randomUUID } from 'node:crypto';
import { ipcMain, type BrowserWindow, type WebContents } from 'electron';
import { DesktopReviewChangeMonitor } from '../review/change-monitor.js';
import {
  checkoutReviewBranch,
  commitReviewChanges,
  createAndCheckoutReviewBranch,
  discardUnstagedReviewFiles,
  getCommitMessageGenerationSource,
  getDesktopReviewState,
  pushReviewBranch,
  stageReviewFiles,
  unstageReviewFiles,
} from '../review/state.js';
import type { RuntimeHost } from '../runtime/host.js';
import { isDesktopRendererSender } from './sender.js';

const REVIEW_CHANGED_CHANNEL = 'desktop-review:changed';

export function registerReviewIpc(runtimeHost: RuntimeHost, mainWindow: BrowserWindow): () => void {
  const monitor = new DesktopReviewChangeMonitor();
  const subscriptions = new Map<string, {
    dispose: () => void;
    handleDestroyed: () => void;
    sender: WebContents;
  }>();
  const subscriptionBySender = new Map<WebContents, string>();
  const latestSubscriptionRequestBySender = new Map<WebContents, string>();
  const channels = [
    'desktop-review:get-state',
    'desktop-review:subscribe-changes',
    'desktop-review:unsubscribe-changes',
    'desktop-review:discard-unstaged',
    'desktop-review:stage-files',
    'desktop-review:unstage-files',
    'desktop-review:checkout-branch',
    'desktop-review:create-branch',
    'desktop-review:commit',
    'desktop-review:push',
    'desktop-review:generate-commit-message',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  const disposeSubscription = (subscriptionId: string) => {
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription) return;
    subscription.sender.removeListener('destroyed', subscription.handleDestroyed);
    subscription.dispose();
    subscriptions.delete(subscriptionId);
    if (subscriptionBySender.get(subscription.sender) === subscriptionId) {
      subscriptionBySender.delete(subscription.sender);
    }
    if (latestSubscriptionRequestBySender.get(subscription.sender) === subscriptionId) {
      latestSubscriptionRequestBySender.delete(subscription.sender);
    }
  };

  ipcMain.handle('desktop-review:get-state', async (_event, input) =>
    getDesktopReviewState(String(input?.workspaceRoot ?? ''), { baseRef: typeof input?.baseRef === 'string' ? input.baseRef : null }),
  );
  ipcMain.handle('desktop-review:subscribe-changes', async (event, input) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) throw new Error('Desktop renderer is unavailable.');
    const subscriptionId = randomUUID();
    const sender = event.sender;
    latestSubscriptionRequestBySender.set(sender, subscriptionId);
    let dispose: () => void;
    try {
      dispose = await monitor.subscribe(String(input?.workspaceRoot ?? ''), () => {
        if (!sender.isDestroyed()) sender.send(REVIEW_CHANGED_CHANNEL, { subscriptionId });
      });
    } catch (error) {
      if (latestSubscriptionRequestBySender.get(sender) === subscriptionId) {
        latestSubscriptionRequestBySender.delete(sender);
      }
      throw error;
    }
    if (sender.isDestroyed() || latestSubscriptionRequestBySender.get(sender) !== subscriptionId) {
      dispose();
      if (latestSubscriptionRequestBySender.get(sender) === subscriptionId) {
        latestSubscriptionRequestBySender.delete(sender);
      }
      return subscriptionId;
    }
    const previousSubscriptionId = subscriptionBySender.get(sender);
    if (previousSubscriptionId) disposeSubscription(previousSubscriptionId);
    const handleDestroyed = () => disposeSubscription(subscriptionId);
    subscriptions.set(subscriptionId, { dispose, handleDestroyed, sender });
    subscriptionBySender.set(sender, subscriptionId);
    sender.once('destroyed', handleDestroyed);
    return subscriptionId;
  });
  ipcMain.handle('desktop-review:unsubscribe-changes', (event, rawSubscriptionId) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) throw new Error('Desktop renderer is unavailable.');
    const subscriptionId = String(rawSubscriptionId ?? '');
    const subscription = subscriptions.get(subscriptionId);
    if (subscription?.sender === event.sender) disposeSubscription(subscriptionId);
  });
  ipcMain.handle('desktop-review:discard-unstaged', async (_event, input) =>
    discardUnstagedReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle('desktop-review:stage-files', async (_event, input) =>
    stageReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle('desktop-review:unstage-files', async (_event, input) =>
    unstageReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle('desktop-review:checkout-branch', async (_event, input) =>
    checkoutReviewBranch(String(input?.workspaceRoot ?? ''), String(input?.branchName ?? '')),
  );
  ipcMain.handle('desktop-review:create-branch', async (_event, input) =>
    createAndCheckoutReviewBranch(String(input?.workspaceRoot ?? ''), String(input?.branchName ?? ''), {
      allowUnstaged: Boolean(input?.allowUnstaged),
    }),
  );
  ipcMain.handle('desktop-review:commit', async (_event, input) =>
    commitReviewChanges(String(input?.workspaceRoot ?? ''), normalizeCommitInput(input)),
  );
  ipcMain.handle('desktop-review:push', async (_event, input) => pushReviewBranch(String(input?.workspaceRoot ?? '')));
  ipcMain.handle('desktop-review:generate-commit-message', async (_event, input) => {
    const source = await getCommitMessageGenerationSource(
      String(input?.workspaceRoot ?? ''),
      input?.includeUnstaged !== false,
    );
    const result = await runtimeHost.request<{ message?: unknown }>({
      path: '/v1/git/commit-message/generate',
      method: 'POST',
      body: source,
    });
    return { message: String(result.message ?? '').trim() };
  });

  return () => {
    latestSubscriptionRequestBySender.clear();
    for (const subscriptionId of [...subscriptions.keys()]) disposeSubscription(subscriptionId);
    monitor.close();
  };
}

function normalizeFilePathList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeCommitInput(value: unknown): { includeUnstaged: boolean; message: string; push: boolean } {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    includeUnstaged: input.includeUnstaged !== false,
    message: String(input.message ?? ''),
    push: Boolean(input.push),
  };
}
