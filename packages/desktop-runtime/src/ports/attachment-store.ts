import type {
  RuntimeAttachmentUploadInput,
  RuntimeMessageAttachment,
  RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';

export type RuntimeResolvedAttachment = {
  attachment: RuntimeStoredMessageAttachment;
  absolutePath: string;
  readableRoot: string;
};

export type RuntimeAttachmentValidationCode =
  | 'attachment_empty'
  | 'attachment_invalid'
  | 'attachment_too_large'
  | 'attachment_unsupported';

export class RuntimeAttachmentValidationError extends Error {
  constructor(
    message: string,
    readonly code: RuntimeAttachmentValidationCode,
  ) {
    super(message);
    this.name = 'RuntimeAttachmentValidationError';
  }
}

export type AttachmentStore = {
  recover(validThreadIds: string[]): Promise<void>;
  create(input: RuntimeAttachmentUploadInput): Promise<RuntimeStoredMessageAttachment>;
  deletePending(assetId: string): Promise<boolean>;
  claimForThread(threadId: string, attachments: RuntimeMessageAttachment[]): Promise<RuntimeMessageAttachment[]>;
  retainForThread(threadId: string, attachments: RuntimeMessageAttachment[]): Promise<void>;
  releaseThread(threadId: string): Promise<void>;
  resolveForThread(threadId: string, attachments: RuntimeMessageAttachment[]): Promise<RuntimeResolvedAttachment[]>;
};

