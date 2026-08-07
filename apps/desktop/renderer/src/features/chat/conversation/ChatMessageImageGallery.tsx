import {
  isRuntimeGeneratedMessageAttachment,
  isRuntimeInlineMessageAttachment,
  isRuntimeStoredMessageAttachment,
  type DesktopImageInput,
  type RuntimeGeneratedMessageAttachment,
  type RuntimeInlineMessageAttachment,
  type RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import { Dropdown, Image, type MenuProps } from 'antd';
import { Copy, FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useDesktopImageAction, type DesktopImageAction } from '../../workspace/hooks/useDesktopImageAction.js';

type ChatImageAttachment = RuntimeGeneratedMessageAttachment | RuntimeInlineMessageAttachment | RuntimeStoredMessageAttachment;
type GalleryStyle = CSSProperties & {
  '--chat-image-gallery-columns': number;
  '--chat-image-gallery-width': string;
};

export function chatImageGalleryColumns(imageCount: number): number {
  if (imageCount <= 1) return 1;
  if (imageCount === 2 || imageCount === 4) return 2;
  return 3;
}

export function chatImageGalleryWidth(
  imageCount: number,
  variant: 'user' | 'assistant',
): string {
  if (imageCount <= 1) {
    return variant === 'user' ? 'min(220px, 52vw)' : '360px';
  }
  const columns = chatImageGalleryColumns(imageCount);
  return `${columns * 176 + (columns - 1) * 8}px`;
}

export function ChatMessageImageGallery({
  attachments,
  threadId = null,
  variant,
}: {
  attachments: ChatImageAttachment[];
  threadId?: string | null;
  variant: 'user' | 'assistant';
}) {
  const { t } = useI18n();
  const runDesktopImageAction = useDesktopImageAction();
  if (!attachments.length) return null;
  const columns = chatImageGalleryColumns(attachments.length);
  const multiple = attachments.length > 1;
  const style: GalleryStyle = {
    '--chat-image-gallery-columns': columns,
    '--chat-image-gallery-width': chatImageGalleryWidth(attachments.length, variant),
  };

  const runAction = (action: DesktopImageAction, attachment: ChatImageAttachment) => {
    const input = desktopImageInput(attachment);
    if (input) runDesktopImageAction(action, input);
  };

  return (
    <div className="chat-image-gallery-shell" style={style}>
      <Image.PreviewGroup>
        <div
          className={`chat-image-gallery chat-image-gallery--${variant} ${multiple ? 'chat-image-gallery--multiple' : 'chat-image-gallery--single'}`}
          aria-label={t('chat.image.count', { count: attachments.length })}
        >
          {attachments.map((attachment) => {
            const supportsDesktopActions = !isRuntimeStoredMessageAttachment(attachment);
            return (
              <ChatMessageImage
                attachment={attachment}
                key={attachment.id}
                threadId={threadId}
                onAction={supportsDesktopActions
                  ? (action) => void runAction(action, attachment)
                  : undefined}
              />
            );
          })}
        </div>
      </Image.PreviewGroup>
    </div>
  );
}

function ChatMessageImage({
  attachment,
  onAction,
  threadId,
}: {
  attachment: ChatImageAttachment;
  onAction?: (action: DesktopImageAction) => void;
  threadId: string | null;
}) {
  const { t } = useI18n();
  const imageRef = useRef<HTMLDivElement>(null);
  const { loadError, reservedAspectRatio, source } = useChatImageSource(attachment, imageRef, threadId);
  const reservesLayout = !source && reservedAspectRatio !== null;

  const items: MenuProps['items'] = [
    {
      key: 'copy',
      icon: <Copy size={14} />,
      label: t('chat.image.copy'),
    },
    {
      key: 'reveal',
      icon: <FolderOpen size={14} />,
      label: t('chat.image.reveal'),
    },
  ];

  const image = (
    <div
      className={`chat-message-image${reservesLayout ? ' chat-message-image--reserved' : ''}`}
      ref={imageRef}
      style={reservesLayout ? { aspectRatio: reservedAspectRatio } : undefined}
      title={attachment.name}
    >
      {source ? (
        <Image
          src={source}
          alt={attachment.name}
          className="chat-message-image__content"
          preview={{ mask: null }}
        />
      ) : (
        <div className="chat-message-image__placeholder" role={loadError ? 'alert' : 'status'}>
          {t(loadError ? 'chat.image.unavailable' : 'chat.image.loading')}
        </div>
      )}
    </div>
  );
  if (!onAction) return image;
  return (
    <Dropdown
      rootClassName="chat-image-context-menu-root"
      trigger={['contextMenu']}
      menu={{
        items,
        onClick: ({ key }) => onAction(key as DesktopImageAction),
      }}
    >
      {image}
    </Dropdown>
  );
}

function useChatImageSource(
  attachment: ChatImageAttachment,
  targetRef: RefObject<HTMLDivElement | null>,
  threadId: string | null,
): { loadError: string | null; reservedAspectRatio: number | null; source: string | null } {
  const { t } = useI18n();
  const inlineSource = isRuntimeInlineMessageAttachment(attachment) ? attachment.url : null;
  const generatedAssetId = isRuntimeGeneratedMessageAttachment(attachment) ? attachment.assetId : null;
  const storedAssetId = isRuntimeStoredMessageAttachment(attachment) ? attachment.assetId : null;
  const deferredAssetId = generatedAssetId ?? storedAssetId;
  const [shouldLoad, setShouldLoad] = useState(false);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reservedAspectRatio, setReservedAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    if (!deferredAssetId) {
      setShouldLoad(false);
      return;
    }
    const target = targetRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }
    setShouldLoad(false);
    const observer = new IntersectionObserver(
      ([entry]) => {
        const isIntersecting = entry?.isIntersecting === true;
        if (!isIntersecting) {
          const bounds = target.getBoundingClientRect();
          if (bounds.width > 0 && bounds.height > 0) {
            setReservedAspectRatio(bounds.width / bounds.height);
          }
        }
        setShouldLoad(isIntersecting);
      },
      { rootMargin: '480px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [deferredAssetId, targetRef]);

  useEffect(() => {
    if (!deferredAssetId || !shouldLoad) {
      setLoadedSource(null);
      setLoadError(null);
      return;
    }
    const bridge = window.setsunaDesktop;
    const read = generatedAssetId
      ? bridge?.desktop.readImageAsset(generatedAssetId)
      : storedAssetId && threadId
        ? bridge?.runtime.readAttachmentImage(threadId, storedAssetId)
        : undefined;
    if (!read) {
      setLoadError(t('chat.image.readUnavailable'));
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoadedSource(null);
    setLoadError(null);
    void read
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLoadError(result.error);
          return;
        }
        const bytes = Uint8Array.from(result.data);
        objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: result.type }));
        setLoadedSource(objectUrl);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : t('chat.image.readFailed'));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deferredAssetId, generatedAssetId, shouldLoad, storedAssetId, t, threadId]);

  return { loadError, reservedAspectRatio, source: inlineSource ?? loadedSource };
}

function desktopImageInput(attachment: ChatImageAttachment): DesktopImageInput | null {
  if (isRuntimeGeneratedMessageAttachment(attachment)) {
    return { assetId: attachment.assetId, name: attachment.name };
  }
  if (isRuntimeInlineMessageAttachment(attachment)) return {
    ...(attachment.localAssetId ? { assetId: attachment.localAssetId } : {}),
    dataUrl: attachment.url,
    name: attachment.name,
  };
  return null;
}
