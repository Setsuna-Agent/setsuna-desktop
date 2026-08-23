import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  REVIEW_IPC_CHANNELS,
  reviewFeature,
  type DesktopReviewBridge,
  type DesktopReviewChangeEvent,
  type ReviewPreloadBridgeContribution,
} from '../contracts/index.js';

export const reviewPreloadFeature = definePreloadFeature<ReviewPreloadBridgeContribution>({
  definition: reviewFeature,
  bridgeKeys: ['desktopReview'],
  contribute(writer) {
    const desktopReview: DesktopReviewBridge = {
      getState: (workspaceRoot, options) => ipcRenderer.invoke(REVIEW_IPC_CHANNELS.getState, {
        workspaceRoot,
        baseRef: options?.baseRef ?? null,
        includeBranchSummary: options?.includeBranchSummary,
      }),
      createImagePreview: (workspaceRoot, input) => ipcRenderer.invoke(
        REVIEW_IPC_CHANNELS.createImagePreview,
        { workspaceRoot, preview: input },
      ),
      releaseImagePreview: (previewId) => ipcRenderer.invoke(
        REVIEW_IPC_CHANNELS.releaseImagePreview,
        previewId,
      ),
      watchChanges(workspaceRoot, callback) {
        let cancelled = false;
        let subscriptionId: string | null = null;
        const queuedEvents: DesktopReviewChangeEvent[] = [];
        const deliver = (event: DesktopReviewChangeEvent) => {
          if (event.subscriptionId === subscriptionId) callback();
        };
        const listener = (_event: IpcRendererEvent, payload: DesktopReviewChangeEvent) => {
          if (subscriptionId === null) queuedEvents.push(payload);
          else deliver(payload);
        };
        ipcRenderer.on(REVIEW_IPC_CHANNELS.changed, listener);
        void ipcRenderer.invoke(REVIEW_IPC_CHANNELS.subscribeChanges, { workspaceRoot }).then((id) => {
          const resolvedSubscriptionId = String(id);
          if (cancelled) {
            void ipcRenderer.invoke(REVIEW_IPC_CHANNELS.unsubscribeChanges, resolvedSubscriptionId);
            return;
          }
          subscriptionId = resolvedSubscriptionId;
          for (const event of queuedEvents.splice(0, queuedEvents.length)) deliver(event);
        }).catch((error: unknown) => {
          if (!cancelled) console.error(error);
        });
        return () => {
          cancelled = true;
          ipcRenderer.off(REVIEW_IPC_CHANNELS.changed, listener);
          if (subscriptionId) {
            void ipcRenderer.invoke(REVIEW_IPC_CHANNELS.unsubscribeChanges, subscriptionId);
          }
        };
      },
      discardUnstaged: (workspaceRoot, filePaths) => ipcRenderer.invoke(
        REVIEW_IPC_CHANNELS.discardUnstaged,
        { workspaceRoot, filePaths },
      ),
      stageFiles: (workspaceRoot, filePaths) => ipcRenderer.invoke(
        REVIEW_IPC_CHANNELS.stageFiles,
        { workspaceRoot, filePaths },
      ),
      unstageFiles: (workspaceRoot, filePaths) => ipcRenderer.invoke(
        REVIEW_IPC_CHANNELS.unstageFiles,
        { workspaceRoot, filePaths },
      ),
      checkoutBranch: (workspaceRoot, branchName) => ipcRenderer.invoke(
        REVIEW_IPC_CHANNELS.checkoutBranch,
        { workspaceRoot, branchName },
      ),
      createBranch: (workspaceRoot, branchName, options) => ipcRenderer.invoke(
        REVIEW_IPC_CHANNELS.createBranch,
        { workspaceRoot, branchName, allowUnstaged: options?.allowUnstaged ?? false },
      ),
      commit: (workspaceRoot, input) => ipcRenderer.invoke(
        REVIEW_IPC_CHANNELS.commit,
        { workspaceRoot, ...input },
      ),
      push: (workspaceRoot) => ipcRenderer.invoke(REVIEW_IPC_CHANNELS.push, { workspaceRoot }),
      generateCommitMessage: (workspaceRoot, input) => ipcRenderer.invoke(
        REVIEW_IPC_CHANNELS.generateCommitMessage,
        { workspaceRoot, includeUnstaged: input?.includeUnstaged ?? true },
      ),
    };
    writer.set('desktopReview', Object.freeze(desktopReview));
  },
});
