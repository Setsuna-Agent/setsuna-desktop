import {
  isRuntimeGeneratedMessageAttachment,
  isRuntimeInlineMessageAttachment,
  type DesktopImageInput,
  type RuntimeGeneratedMessageAttachment,
  type RuntimeInlineMessageAttachment,
} from '@setsuna-desktop/contracts';
import { Dropdown, Image, type MenuProps } from 'antd';
import { Copy, FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useDesktopImageAction, type DesktopImageAction } from '../../workspace/hooks/useDesktopImageAction.js';

type ChatImageAttachment = RuntimeGeneratedMessageAttachment | RuntimeInlineMessageAttachment;
type GalleryStyle = CSSProperties & {
  '--chat-image-gallery-columns': number;
  '--chat-image-gallery-width': string;
};

export function chatImageGalleryColumns(imageCount: number): number {
  if (imageCount <= 1) return 1;
  if (imageCount === 2 || imageCount === 4) return 2;
  return 3;
}

export function ChatMessageImageGallery({
  attachments,
  variant,
}: {
  attachments: ChatImageAttachment[];
  variant: 'user' | 'assistant';
}) {
  const { t } = useI18n();
  const runDesktopImageAction = useDesktopImageAction();
  if (!attachments.length) return null;
  const columns = chatImageGalleryColumns(attachments.length);
  const multiple = attachments.length > 1;
  const style: GalleryStyle = {
    '--chat-image-gallery-columns': columns,
    '--chat-image-gallery-width': `${columns * 176 + (columns - 1) * 8}px`,
  };

  const runAction = (action: DesktopImageAction, attachment: ChatImageAttachment) =>
    runDesktopImageAction(action, desktopImageInput(attachment));

  return (
    <div className="chat-image-gallery-shell">
      <Image.PreviewGroup>
        <div
          className={`chat-image-gallery chat-image-gallery--${variant} ${multiple ? 'chat-image-gallery--multiple' : 'chat-image-gallery--single'}`}
          style={style}
          aria-label={t('chat.image.count', { count: attachments.length })}
        >
          {attachments.map((attachment) => (
            <ChatMessageImage
              attachment={attachment}
              key={attachment.id}
              onAction={(action) => void runAction(action, attachment)}
            />
          ))}
        </div>
      </Image.PreviewGroup>
    </div>
  );
}

function ChatMessageImage({
  attachment,
  onAction,
}: {
  attachment: ChatImageAttachment;
  onAction: (action: DesktopImageAction) => void;
}) {
  const { t } = useI18n();
  const imageRef = useRef<HTMLDivElement>(null);
  const { loadError, reservedAspectRatio, source } = useChatImageSource(attachment, imageRef);
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

  return (
    <Dropdown
      rootClassName="chat-image-context-menu-root"
      trigger={['contextMenu']}
      transitionName=""
      menu={{
        items,
        onClick: ({ key }) => onAction(key as DesktopImageAction),
      }}
    >
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
    </Dropdown>
  );
}

function useChatImageSource(
  attachment: ChatImageAttachment,
  targetRef: RefObject<HTMLDivElement | null>,
): { loadError: string | null; reservedAspectRatio: number | null; source: string | null } {
  const { t } = useI18n();
  const inlineSource = isRuntimeInlineMessageAttachment(attachment) ? attachment.url : null;
  const generatedAssetId = isRuntimeGeneratedMessageAttachment(attachment) ? attachment.assetId : null;
  const [shouldLoad, setShouldLoad] = useState(false);
  const [generatedSource, setGeneratedSource] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reservedAspectRatio, setReservedAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    if (!generatedAssetId) {
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
  }, [generatedAssetId, targetRef]);

  useEffect(() => {
    if (!generatedAssetId || !shouldLoad) {
      setGeneratedSource(null);
      setLoadError(null);
      return;
    }
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop) {
      setLoadError(t('chat.image.readUnavailable'));
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setGeneratedSource(null);
    setLoadError(null);
    void desktop.readImageAsset(generatedAssetId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLoadError(result.error);
          return;
        }
        const bytes = Uint8Array.from(result.data);
        objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: result.type }));
        setGeneratedSource(objectUrl);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : t('chat.image.readFailed'));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [generatedAssetId, shouldLoad, t]);

  return { loadError, reservedAspectRatio, source: inlineSource ?? generatedSource };
}

function desktopImageInput(attachment: ChatImageAttachment): DesktopImageInput {
  if (isRuntimeGeneratedMessageAttachment(attachment)) {
    return { assetId: attachment.assetId, name: attachment.name };
  }
  return {
    ...(attachment.localAssetId ? { assetId: attachment.localAssetId } : {}),
    dataUrl: attachment.url,
    name: attachment.name,
  };
}
