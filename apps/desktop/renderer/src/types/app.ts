import type { RuntimeMessageAttachment, WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';

export type MainView = 'chat' | 'capabilities' | 'settings';

export type ConversationOverviewVisibility = 'auto' | 'hidden' | 'shown';

export type ChatSkillSelectionRequest = {
  skillId: string;
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
  | 'too-large'
  | 'unavailable'
  | 'unsupported';
