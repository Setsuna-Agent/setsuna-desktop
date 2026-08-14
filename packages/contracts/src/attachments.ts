export const RUNTIME_RASTER_IMAGE_MIME_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const RUNTIME_LOCAL_ATTACHMENT_LINK_PATH = '/internal/attachments/link' as const;

export type RuntimeRasterImageMimeType = typeof RUNTIME_RASTER_IMAGE_MIME_TYPES[number];

export function isRuntimeRasterImageMimeType(value: string): value is RuntimeRasterImageMimeType {
  return (RUNTIME_RASTER_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

type RuntimeMessageAttachmentBase = {
  id: string;
  name: string;
  type: string;
  size: number;
  /** false 表示仅用于对话展示，不再作为下一次模型输入发送。 */
  modelVisible?: boolean;
};

/** 旧版及面向模型的附件，其字节数据由 URL 承载，通常为数据 URL。 */
export type RuntimeInlineMessageAttachment = RuntimeMessageAttachmentBase & {
  source?: 'inline';
  url: string;
  /** 旧版生成图可能同时携带本地副本 ID；新生成图使用 generated 附件。 */
  localAssetId?: string;
  assetId?: never;
};

/**
 * runtime 持久化的受管图片资产。`generated` 作为历史判别字保留，但同一存储
 * 也承载需要在模型请求边界临时解析的工具图片。Base64 不会写入线程事件。
 */
export type RuntimeGeneratedMessageAttachment = RuntimeMessageAttachmentBase & {
  source: 'generated';
  assetId: string;
  url?: never;
  localAssetId?: never;
};

/** 由 runtime 管理的文件引用；渲染进程和持久化线程都不会获得其本地路径。 */
export type RuntimeStoredMessageAttachment = RuntimeMessageAttachmentBase & {
  source: 'runtime';
  assetId: string;
  url?: never;
};

/** User/model input attachments. Generated assets are output-only and never accepted at a send boundary. */
export type RuntimeInputMessageAttachment = RuntimeInlineMessageAttachment | RuntimeStoredMessageAttachment;

export type RuntimeMessageAttachment = RuntimeGeneratedMessageAttachment | RuntimeInputMessageAttachment;

export type RuntimeAttachmentUploadInput = {
  name: string;
  type: string;
  data: Uint8Array;
};

/** Main-only input produced from Electron's trusted path for a renderer-selected File. */
export type RuntimeAttachmentLinkInput = {
  path: string;
  type: string;
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
  return attachment.source !== 'generated' && attachment.source !== 'runtime';
}

export function isRuntimeGeneratedMessageAttachment(
  attachment: RuntimeMessageAttachment,
): attachment is RuntimeGeneratedMessageAttachment {
  return attachment.source === 'generated';
}

export function isRuntimeInputMessageAttachment(
  attachment: RuntimeMessageAttachment,
): attachment is RuntimeInputMessageAttachment {
  return attachment.source !== 'generated';
}
