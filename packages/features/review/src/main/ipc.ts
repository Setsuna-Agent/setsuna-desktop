import type { Awaitable, FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { randomUUID } from 'node:crypto';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  REVIEW_IPC_CHANNELS,
  reviewModelSelectionCodec,
  type DesktopReviewCommitInput,
  type ReviewCommitMessageGenerator,
  type ReviewFilePreviewRegistry,
  type ReviewRendererSenderPolicy,
} from '../contracts/index.js';
import { DesktopReviewChangeMonitor } from './change-monitor.js';
import { createReviewImagePreviewUrl } from './image-preview.js';
import { getDesktopGitCommitDetails, getDesktopGitCommitFileDiff, getDesktopGitHistory } from './history.js';
import {
  checkoutReviewBranch,
  commitReviewChanges,
  createAndCheckoutReviewBranch,
  discardUnstagedReviewFiles,
  getCommitMessageGenerationSource,
  getReviewCommitMessage,
  getDesktopReviewState,
  pushReviewBranch,
  pullReviewBranch,
  stageReviewFiles,
  unstageReviewFiles,
} from './state.js';

export type ReviewIpcDependencies = Readonly<{
  commitMessages: ReviewCommitMessageGenerator;
  previews: ReviewFilePreviewRegistry;
  rendererSender: ReviewRendererSenderPolicy;
}>;

const handlerChannels = [
  REVIEW_IPC_CHANNELS.getHistory,
  REVIEW_IPC_CHANNELS.getCommitDetails,
  REVIEW_IPC_CHANNELS.getCommitFileDiff,
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
  REVIEW_IPC_CHANNELS.getCommitMessage,
  REVIEW_IPC_CHANNELS.push,
  REVIEW_IPC_CHANNELS.pull,
  REVIEW_IPC_CHANNELS.generateCommitMessage,
] as const;

export function registerReviewIpc(scope: FeatureScope, dependencies: ReviewIpcDependencies): () => void {
  const monitor = new DesktopReviewChangeMonitor();
  const subscriptions = new Map<string, {
    dispose: () => void;
    handleDestroyed: () => void;
    sender: WebContents;
  }>();
  const subscriptionBySender = new Map<WebContents, string>();
  const latestSubscriptionRequestBySender = new Map<WebContents, string>();
  for (const channel of handlerChannels) ipcMain.removeHandler(channel);

  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.getHistory, (event, value) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) throw new Error('Desktop renderer is unavailable.');
    const input = inputRecord(value);
    const options = inputRecord(input.options);
    return getDesktopGitHistory(String(input.workspaceRoot ?? ''), {
      ref: typeof options.ref === 'string' ? options.ref : undefined,
      skip: options.skip === undefined ? undefined : Number(options.skip),
      limit: options.limit === undefined ? undefined : Number(options.limit),
    });
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.getCommitDetails, (event, value) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) throw new Error('Desktop renderer is unavailable.');
    const input = inputRecord(value);
    return getDesktopGitCommitDetails(String(input.workspaceRoot ?? ''), String(input.oid ?? ''));
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.getCommitFileDiff, (event, value) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) throw new Error('Desktop renderer is unavailable.');
    const input = inputRecord(value);
    return getDesktopGitCommitFileDiff(String(input.workspaceRoot ?? ''), {
      oid: String(input.oid ?? ''),
      filePath: String(input.filePath ?? ''),
      previousPath: typeof input.previousPath === 'string' ? input.previousPath : undefined,
    });
  });

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

  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.getState, (_event, value) => {
    const input = inputRecord(value);
    return getDesktopReviewState(String(input.workspaceRoot ?? ''), {
      baseRef: typeof input.baseRef === 'string' ? input.baseRef : null,
      includeBranchSummary: input.includeBranchSummary !== false,
    });
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.createImagePreview, (event, value) => {
    const input = inputRecord(value);
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) {
      return { ok: false, error: 'Desktop renderer is unavailable.' };
    }
    return createReviewImagePreviewUrl(
      input.workspaceRoot,
      input.preview,
      dependencies.previews,
    );
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.releaseImagePreview, (event, rawPreviewId) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) return false;
    const previewId = String(rawPreviewId ?? '');
    return /^[a-f0-9]{48}$/u.test(previewId) && dependencies.previews.release(previewId);
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.subscribeChanges, async (event, value) => {
    const input = inputRecord(value);
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) {
      throw new Error('Desktop renderer is unavailable.');
    }
    const subscriptionId = randomUUID();
    const sender = event.sender;
    latestSubscriptionRequestBySender.set(sender, subscriptionId);
    let dispose: () => void;
    try {
      dispose = await monitor.subscribe(String(input.workspaceRoot ?? ''), () => {
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
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.unsubscribeChanges, (event, rawSubscriptionId) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) {
      throw new Error('Desktop renderer is unavailable.');
    }
    const subscriptionId = String(rawSubscriptionId ?? '');
    const subscription = subscriptions.get(subscriptionId);
    if (subscription?.sender === event.sender) disposeSubscription(subscriptionId);
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.discardUnstaged, (_event, value) => {
    const input = inputRecord(value);
    return discardUnstagedReviewFiles(String(input.workspaceRoot ?? ''), normalizeFilePathList(input.filePaths));
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.stageFiles, (_event, value) => {
    const input = inputRecord(value);
    return stageReviewFiles(String(input.workspaceRoot ?? ''), normalizeFilePathList(input.filePaths));
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.unstageFiles, (_event, value) => {
    const input = inputRecord(value);
    return unstageReviewFiles(String(input.workspaceRoot ?? ''), normalizeFilePathList(input.filePaths));
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.checkoutBranch, (_event, value) => {
    const input = inputRecord(value);
    return checkoutReviewBranch(String(input.workspaceRoot ?? ''), String(input.branchName ?? ''));
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.createBranch, (_event, value) => {
    const input = inputRecord(value);
    return createAndCheckoutReviewBranch(String(input.workspaceRoot ?? ''), String(input.branchName ?? ''), {
      allowUnstaged: Boolean(input.allowUnstaged),
    });
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.commit, (_event, value) => {
    const input = inputRecord(value);
    return commitReviewChanges(String(input.workspaceRoot ?? ''), normalizeCommitInput(input));
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.getCommitMessage, (event, value) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) throw new Error('Desktop renderer is unavailable.');
    return getReviewCommitMessage(String(inputRecord(value).workspaceRoot ?? ''));
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.push, (_event, value) => {
    const input = inputRecord(value);
    return pushReviewBranch(String(input.workspaceRoot ?? ''));
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.pull, (event, value) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) throw new Error('Desktop renderer is unavailable.');
    const input = inputRecord(value);
    return pullReviewBranch(String(input.workspaceRoot ?? ''), { rebase: input.rebase === true });
  });
  registerScopedIpcHandler(scope, REVIEW_IPC_CHANNELS.generateCommitMessage, async (event, value, signal) => {
    if (!dependencies.rendererSender.isAllowed(event.sender.id)) throw new Error('Desktop renderer is unavailable.');
    const input = inputRecord(value);
    const modelSelection = reviewModelSelectionCodec.parse(input.modelSelection);
    const source = await getCommitMessageGenerationSource(
      String(input.workspaceRoot ?? ''),
      input.includeUnstaged === true,
    );
    const requestId = typeof input.requestId === 'string' && input.requestId.length <= 128 ? input.requestId : undefined;
    const controller = new AbortController();
    const onDestroyed = () => controller.abort();
    event.sender.once('destroyed', onDestroyed);
    try {
      return { message: await dependencies.commitMessages.generate({ ...source, ...(modelSelection ? { modelSelection } : {}) }, {
        signal: AbortSignal.any([signal, controller.signal]),
        ...(requestId ? { onProgress: (message: string) => {
          if (!event.sender.isDestroyed()) event.sender.send(REVIEW_IPC_CHANNELS.commitMessageProgress, { requestId, message });
        } } : {}),
      }) };
    } finally {
      event.sender.removeListener('destroyed', onDestroyed);
    }
  });

  return () => {
    for (const channel of handlerChannels) ipcMain.removeHandler(channel);
    latestSubscriptionRequestBySender.clear();
    for (const subscriptionId of [...subscriptions.keys()]) disposeSubscription(subscriptionId);
    monitor.close();
  };
}

type ScopedIpcHandler = (
  event: IpcMainInvokeEvent,
  input: unknown,
  signal: AbortSignal,
) => Awaitable<unknown>;

function registerScopedIpcHandler(
  scope: FeatureScope,
  channel: string,
  handler: ScopedIpcHandler,
): void {
  ipcMain.handle(channel, (event, input: unknown) => (
    scope.runOperation((signal) => handler(event, input, signal))
  ));
}

function inputRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function normalizeFilePathList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeCommitInput(value: unknown): DesktopReviewCommitInput {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const amend = inputRecord(input.amend);
  return {
    includeUnstaged: input.includeUnstaged === true,
    message: String(input.message ?? ''),
    push: Boolean(input.push),
    sync: Boolean(input.sync),
    ...(input.amend ? { amend: { oid: String(amend.oid ?? ''), branch: typeof amend.branch === 'string' ? amend.branch : null } } : {}),
  };
}
