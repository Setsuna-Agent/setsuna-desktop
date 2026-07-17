export const RUNTIME_FILE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const RUNTIME_FILE_ATTACHMENT_EXTENSIONS = ['.pdf', '.docx'] as const;

export const RUNTIME_FILE_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type RuntimeFileAttachmentMimeType = typeof RUNTIME_FILE_ATTACHMENT_MIME_TYPES[number];

type RuntimeMessageAttachmentBase = {
  id: string;
  name: string;
  type: string;
  size: number;
};

/** Legacy/model-facing attachment whose bytes are carried by a URL, usually a data URL. */
export type RuntimeInlineMessageAttachment = RuntimeMessageAttachmentBase & {
  source?: 'inline';
  url: string;
  assetId?: never;
};

/** Runtime-owned file reference. The renderer and persisted thread never receive its local path. */
export type RuntimeStoredMessageAttachment = RuntimeMessageAttachmentBase & {
  source: 'runtime';
  assetId: string;
  url?: never;
};

export type RuntimeMessageAttachment = RuntimeInlineMessageAttachment | RuntimeStoredMessageAttachment;

export type RuntimeAttachmentUploadInput = {
  name: string;
  type: string;
  data: Uint8Array;
};

export type RuntimeAttachmentDeleteResponse = {
  deleted: boolean;
};

export function isRuntimeStoredMessageAttachment(
  attachment: RuntimeMessageAttachment,
): attachment is RuntimeStoredMessageAttachment {
  return attachment.source === 'runtime';
}

export function isRuntimeInlineMessageAttachment(
  attachment: RuntimeMessageAttachment,
): attachment is RuntimeInlineMessageAttachment {
  return attachment.source !== 'runtime';
}
