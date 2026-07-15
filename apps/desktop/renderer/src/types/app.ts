import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';

export type MainView = 'chat' | 'capabilities' | 'settings';

export type ChatSkillSelectionRequest = {
  skillId: string;
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
