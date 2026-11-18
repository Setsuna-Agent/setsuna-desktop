import type { RuntimeMessageAttachment, WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import type { RendererAppRouteId } from '@setsuna-desktop/renderer-contracts/shell';

export type MainView = RendererAppRouteId;

export type ConversationOverviewVisibility = 'auto' | 'hidden' | 'shown';

export type ChatCapabilitySelectionRequest = {
  kind: 'skill' | 'plugin';
  id: string;
  requestId: number;
};

export type ChatWorkspaceMentionRequest = {
  entry: WorkspaceEntrySearchItem;
  requestId: number;
};

export type ChatImageAttachmentRequest = {
  attachment: RuntimeMessageAttachment;
  requestId: number;
};

export type ChatImageAttachmentOutcome =
  | 'added'
  | 'limit-reached'
  | 'unavailable'
  | 'unsupported';
