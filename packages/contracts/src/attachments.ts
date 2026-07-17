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

/** 旧版及面向模型的附件，其字节数据由 URL 承载，通常为数据 URL。 */
export type RuntimeInlineMessageAttachment = RuntimeMessageAttachmentBase & {
  source?: 'inline';
  url: string;
  assetId?: never;
};

/** 由 runtime 管理的文件引用；渲染进程和持久化线程都不会获得其本地路径。 */
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
