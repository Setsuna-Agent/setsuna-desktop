import { ImagePreview } from '@setsuna-desktop/renderer-ui';
import { useContext, useState, type ImgHTMLAttributes } from 'react';
import type { ExtraProps } from 'react-markdown';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { useWorkspaceImageSources } from './useWorkspaceImageSources.js';
import { MarkdownLinkLabelContext } from './MarkdownLinkLabelContext.js';

export function MarkdownImage({ alt = '', node: _node, src, ...props }: ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
  const { t } = useI18n();
  const isLinkLabel = useContext(MarkdownLinkLabelContext);
  const { onOpenWorkspaceFileContextMenu } = useMarkdownNavigation();
  const { source, filePath } = useWorkspaceImageSources([src]).get(src) ?? {};
  const [failedSource, setFailedSource] = useState<string>();
  if (!source || source === failedSource) {
    return <span className="chat-markdown__image-alt">{alt || t('chat.markdown.imageUnavailable')}</span>;
  }
  // Linked images navigate; only standalone images own a preview and its portal.
  const Image = isLinkLabel ? 'img' : ImagePreview;
  return <Image {...props} src={source} alt={alt} decoding="async" loading="lazy" referrerPolicy="no-referrer"
    onError={() => setFailedSource(source)}
    onContextMenu={filePath && onOpenWorkspaceFileContextMenu ? (event) => {
      event.preventDefault();
      onOpenWorkspaceFileContextMenu({ filePath, x: event.clientX, y: event.clientY });
    } : undefined} />;
}
