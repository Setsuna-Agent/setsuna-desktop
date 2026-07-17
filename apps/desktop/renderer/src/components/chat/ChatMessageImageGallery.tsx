import { useState, type CSSProperties } from 'react';
import { Dropdown, Image, type MenuProps } from 'antd';
import { Copy, FolderOpen } from 'lucide-react';
import type { RuntimeInlineMessageAttachment } from '@setsuna-desktop/contracts';

type ChatImageAction = 'copy' | 'reveal';
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
  attachments: RuntimeInlineMessageAttachment[];
  variant: 'user' | 'assistant';
}) {
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  if (!attachments.length) return null;
  const columns = chatImageGalleryColumns(attachments.length);
  const multiple = attachments.length > 1;
  const style: GalleryStyle = {
    '--chat-image-gallery-columns': columns,
    '--chat-image-gallery-width': `${columns * 176 + (columns - 1) * 8}px`,
  };

  const runAction = async (action: ChatImageAction, attachment: RuntimeInlineMessageAttachment) => {
    try {
      const desktop = window.setsunaDesktop?.desktop;
      if (!desktop) {
        setActionStatus('当前环境无法执行图片操作');
        return;
      }
      const result = action === 'copy'
        ? await desktop.copyImageToClipboard(attachment.url)
        : await desktop.revealImageInFolder({
            ...(attachment.localAssetId ? { assetId: attachment.localAssetId } : {}),
            dataUrl: attachment.url,
            name: attachment.name,
          });
      setActionStatus(result.ok
        ? action === 'copy' ? '图片已复制' : '已在文件夹中显示图片'
        : result.error);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : '图片操作失败');
    }
  };

  return (
    <div className="chat-image-gallery-shell">
      <Image.PreviewGroup>
        <div
          className={`chat-image-gallery chat-image-gallery--${variant} ${multiple ? 'chat-image-gallery--multiple' : 'chat-image-gallery--single'}`}
          style={style}
          aria-label={`${attachments.length} 张图片`}
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
      {actionStatus ? <div className="chat-image-gallery__status" aria-live="polite">{actionStatus}</div> : null}
    </div>
  );
}

function ChatMessageImage({
  attachment,
  onAction,
}: {
  attachment: RuntimeInlineMessageAttachment;
  onAction: (action: ChatImageAction) => void;
}) {
  const items: MenuProps['items'] = [
    {
      key: 'copy',
      icon: <Copy size={14} />,
      label: '复制图片',
    },
    {
      key: 'reveal',
      icon: <FolderOpen size={14} />,
      label: '在文件夹中显示',
    },
  ];

  return (
    <Dropdown
      rootClassName="chat-image-context-menu-root"
      trigger={['contextMenu']}
      transitionName=""
      menu={{
        items,
        onClick: ({ key }) => onAction(key as ChatImageAction),
      }}
    >
      <div className="chat-message-image" title={attachment.name}>
        <Image
          src={attachment.url}
          alt={attachment.name}
          className="chat-message-image__content"
          preview={{ mask: null }}
        />
      </div>
    </Dropdown>
  );
}
