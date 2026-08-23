import { randomUUID } from 'node:crypto';
import { ipcMain, type WebContents } from 'electron';
import {
  REVIEW_IPC_CHANNELS,
  type ReviewCommitMessageGenerator,
  type ReviewFilePreviewRegistry,
  type ReviewRendererSenderPolicy,
} from '../contracts/index.js';
import { DesktopReviewChangeMonitor } from './change-monitor.js';
import { createReviewImagePreviewUrl } from './image-preview.js';
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
} from './state.js';

export type ReviewIpcDependencies = Readonly<{
  commitMessages: ReviewCommitMessageGenerator;
  previews: ReviewFilePreviewRegistry;
  rendererSender: ReviewRendererSenderPolicy;
}>;

const handlerChannels = [
  REVIEW_IPC_CHANNELS.getState,
  REVIEW_IPC_CHANNELS.createImagePreview,
  REVIEW_IPC_CHANNELS.releaseImagePreview,
  REVIEW_IPC_CHANNELS.subscribeChanges,
  REVIEW_IPC_CHANNELS.unsubscribeChanges,
  REVIEW_IPC_CHANNELS.discardUnstaged,
  REVIEW_IPC_CHANNELS.stageFiles,
  REVIEW_IPC_CHANNELS.unstageFiles,
  REVIEW_IPC_CHANNELS.checkoutBranch,
  REVIEW_IPC_CHANNELS.createBranch,
  REVIEW_IPC_CHANNELS.commit,
  REVIEW_IPC_CHANNELS.push,
  REVIEW_IPC_CHANNELS.generateCommitMessage,
] as const;

export function registerReviewIpc(dependencies: ReviewIpcDependencies): () => void {
  const monitor = new DesktopReviewChangeMonitor();
  const subscriptions = new Map<string, {
    dispose: () => void;
    handleDestroyed: () => void;
    sender: WebContents;
  }>();
  const subscriptionBySender = new Map<WebContents, string>();
  const latestSubscriptionRequestBySender = new Map<WebContents, string>();
  for (const channel of handlerChannels) ipcMain.removeHandler(channel);

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

  ipcMain.handle(REVIEW_IPC_CHANNELS.getState, async (_event, input) =>
    getDesktopReviewState(String(input?.workspaceRoot ?? ''), {
      baseRef: typeof input?.baseRef === 'string' ? input.baseRef : null,
      includeBranchSummary: input?.includeBranchSummary !== false,
    }),
  );
  ipcMain.handle(REVIEW_IPC_CHANNELS.createImagePreview, async (event, input) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) {
      return { ok: false, error: 'Desktop renderer is unavailable.' };
    }
    return createReviewImagePreviewUrl(
      input?.workspaceRoot,
      input?.preview,
      dependencies.previews,
    );
  });
  ipcMain.handle(REVIEW_IPC_CHANNELS.releaseImagePreview, (event, rawPreviewId) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) return false;
    const previewId = String(rawPreviewId ?? '');
    return /^[a-f0-9]{48}$/u.test(previewId) && dependencies.previews.release(previewId);
  });
  ipcMain.handle(REVIEW_IPC_CHANNELS.subscribeChanges, async (event, input) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) {
      throw new Error('Desktop renderer is unavailable.');
    }
    const subscriptionId = randomUUID();
    const sender = event.sender;
    latestSubscriptionRequestBySender.set(sender, subscriptionId);
    let dispose: () => void;
    try {
      dispose = await monitor.subscribe(String(input?.workspaceRoot ?? ''), () => {
        if (!sender.isDestroyed()) sender.send(REVIEW_IPC_CHANNELS.changed, { subscriptionId });
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
  ipcMain.handle(REVIEW_IPC_CHANNELS.unsubscribeChanges, (event, rawSubscriptionId) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) {
      throw new Error('Desktop renderer is unavailable.');
    }
    const subscriptionId = String(rawSubscriptionId ?? '');
    const subscription = subscriptions.get(subscriptionId);
    if (subscription?.sender === event.sender) disposeSubscription(subscriptionId);
  });
  ipcMain.handle(REVIEW_IPC_CHANNELS.discardUnstaged, async (_event, input) =>
    discardUnstagedReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle(REVIEW_IPC_CHANNELS.stageFiles, async (_event, input) =>
    stageReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle(REVIEW_IPC_CHANNELS.unstageFiles, async (_event, input) =>
    unstageReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle(REVIEW_IPC_CHANNELS.checkoutBranch, async (_event, input) =>
    checkoutReviewBranch(String(input?.workspaceRoot ?? ''), String(input?.branchName ?? '')),
  );
  ipcMain.handle(REVIEW_IPC_CHANNELS.createBranch, async (_event, input) =>
    createAndCheckoutReviewBranch(String(input?.workspaceRoot ?? ''), String(input?.branchName ?? ''), {
      allowUnstaged: Boolean(input?.allowUnstaged),
    }),
  );
  ipcMain.handle(REVIEW_IPC_CHANNELS.commit, async (_event, input) =>
    commitReviewChanges(String(input?.workspaceRoot ?? ''), normalizeCommitInput(input)),
  );
  ipcMain.handle(REVIEW_IPC_CHANNELS.push, async (_event, input) => pushReviewBranch(String(input?.workspaceRoot ?? '')));
  ipcMain.handle(REVIEW_IPC_CHANNELS.generateCommitMessage, async (_event, input) => {
    const source = await getCommitMessageGenerationSource(
      String(input?.workspaceRoot ?? ''),
      input?.includeUnstaged !== false,
    );
    return { message: await dependencies.commitMessages.generate(source) };
  });

  return () => {
    for (const channel of handlerChannels) ipcMain.removeHandler(channel);
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
