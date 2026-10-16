import { IconButton, ImagePreview, ImagePreviewGroup } from '@setsuna-desktop/renderer-ui';
import { isRuntimeInlineMessageAttachment, isRuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';

import { LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceFileIcon } from '../../workspace/WorkspaceFileIcon.js';
import {
  formatAttachmentTypeLabel,
  isChatPreviewableImageType,
  type ChatComposerAttachmentItem,
} from './chatAttachments.js';

export function ChatAttachmentTray({
  disabled = false,
  items,
  onRemove,
  threadId,
}: {
  disabled?: boolean;
  items: ChatComposerAttachmentItem[];
  onRemove: (key: string) => void;
  threadId?: string | null;
}) {
  const { t } = useI18n();

  return (
    <div className={`chat-attachment-tray ${items.length ? 'is-open' : ''}`}>
      <div className="chat-attachment-tray__clip">
        <ImagePreviewGroup>
          <div className="chat-attachments" aria-label={t('chat.attachments.label')}>
            {items.map((item) => (
              <ComposerAttachmentCard disabled={disabled} item={item} key={item.key} onRemove={onRemove} threadId={threadId} />
            ))}
          </div>
        </ImagePreviewGroup>
      </div>
    </div>
  );
}

function ComposerAttachmentCard({
  disabled,
  item,
  onRemove,
  threadId,
}: {
  disabled: boolean;
  item: ChatComposerAttachmentItem;
  onRemove: (key: string) => void;
  threadId?: string | null;
}) {
  const { t } = useI18n();
  const storedAssetId = item.attachment && isRuntimeStoredMessageAttachment(item.attachment)
    && isChatPreviewableImageType(item.type) && !item.previewUrl ? item.attachment.assetId : undefined;
  const storedPreview = useStoredAttachmentPreview(threadId, storedAssetId);
  const inlineImage = item.attachment
    && isRuntimeInlineMessageAttachment(item.attachment)
    && isChatPreviewableImageType(item.attachment.type)
    ? item.attachment
    : null;
  const imagePreviewUrl = isChatPreviewableImageType(item.type)
    ? item.previewUrl ?? inlineImage?.url ?? storedPreview
    : undefined;
  const removing = item.status === 'removing';
  return (
    <div
      className={`chat-attachment ${imagePreviewUrl ? 'chat-attachment--image' : 'chat-attachment--file'} ${removing ? 'is-removing' : ''} ${item.status === 'error' ? 'has-error' : ''}`}
      title={item.error || item.name}
    >
      {imagePreviewUrl ? (
        <ImagePreview src={imagePreviewUrl} alt={item.name} className="chat-attachment__image" />
      ) : (
        <>
          <span className="chat-attachment__file-icon" aria-hidden="true">
            {item.status === 'preparing' ? (
              <LoaderCircle className="is-spinning" size={17} />
            ) : item.status === 'error' ? (
              <TriangleAlert size={17} />
            ) : (
              <WorkspaceFileIcon className="chat-attachment__file-type-icon" path={item.name} type="file" />
            )}
          </span>
          <span className="chat-attachment__file-copy">
            <span className="chat-attachment__file-name">{item.name}</span>
            <span className="chat-attachment__file-meta">
              {item.status === 'preparing' ? t('chat.attachments.preparing') : item.status === 'error' ? item.error : formatAttachmentTypeLabel(item.name, item.type)}
            </span>
          </span>
        </>
      )}
      <IconButton variant="danger"
        className="chat-attachment__remove"
        type="button"
        label={t('chat.attachments.remove', { name: item.name })}
        disabled={disabled || removing}
        onClick={() => onRemove(item.key)}
      >
        <X size={12} />
      </IconButton>
    </div>
  );
}

/** Resolve historical images only while their editable attachment card is mounted. */
function useStoredAttachmentPreview(threadId?: string | null, assetId?: string): string | undefined {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    setSource(undefined);
    if (!threadId || !assetId) return;
    let cancelled = false;
    let url: string | undefined;
    void window.setsunaDesktop?.runtime.readAttachmentImage(threadId, assetId).then((result) => {
      if (cancelled || !result.ok) return;
      url = URL.createObjectURL(new Blob([Uint8Array.from(result.data).buffer], { type: result.type }));
      setSource(url);
    }).catch(() => undefined);
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [assetId, threadId]);
  return source;
}
