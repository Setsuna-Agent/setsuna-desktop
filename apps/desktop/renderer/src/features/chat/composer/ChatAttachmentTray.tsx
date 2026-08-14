import { isRuntimeInlineMessageAttachment } from '@setsuna-desktop/contracts';
import { Image } from 'antd';
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
}: {
  disabled?: boolean;
  items: ChatComposerAttachmentItem[];
  onRemove: (key: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className={`chat-attachment-tray ${items.length ? 'is-open' : ''}`}>
      <div className="chat-attachment-tray__clip">
        <Image.PreviewGroup>
          <div className="chat-attachments" aria-label={t('chat.attachments.label')}>
            {items.map((item) => (
              <ComposerAttachmentCard disabled={disabled} item={item} key={item.key} onRemove={onRemove} />
            ))}
          </div>
        </Image.PreviewGroup>
      </div>
    </div>
  );
}

function ComposerAttachmentCard({
  disabled,
  item,
  onRemove,
}: {
  disabled: boolean;
  item: ChatComposerAttachmentItem;
  onRemove: (key: string) => void;
}) {
  const { t } = useI18n();
  const inlineImage = item.attachment
    && isRuntimeInlineMessageAttachment(item.attachment)
    && isChatPreviewableImageType(item.attachment.type)
    ? item.attachment
    : null;
  const imagePreviewUrl = isChatPreviewableImageType(item.type)
    ? item.previewUrl ?? inlineImage?.url
    : undefined;
  const removing = item.status === 'removing';
  return (
    <div
      className={`chat-attachment ${imagePreviewUrl ? 'chat-attachment--image' : 'chat-attachment--file'} ${removing ? 'is-removing' : ''} ${item.status === 'error' ? 'has-error' : ''}`}
      title={item.error || item.name}
    >
      {imagePreviewUrl ? (
        <Image src={imagePreviewUrl} alt={item.name} className="chat-attachment__image" preview={{ mask: null }} />
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
      <button
        className="chat-attachment__remove"
        type="button"
        aria-label={t('chat.attachments.remove', { name: item.name })}
        disabled={disabled || removing}
        onClick={() => onRemove(item.key)}
      >
        <X size={12} />
      </button>
    </div>
  );
}
