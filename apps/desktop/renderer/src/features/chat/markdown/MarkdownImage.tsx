import { ImagePreview } from '@setsuna-desktop/renderer-ui';
import { useContext, useEffect, useState, type ImgHTMLAttributes } from 'react';
import type { ExtraProps } from 'react-markdown';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { resolveMarkdownLinkTarget } from './markdownLinks.js';
import { useAvailableMarkdownFile } from './useMarkdownWorkspaceFiles.js';
import { MarkdownLinkLabelContext } from './MarkdownLinkLabelContext.js';

export function MarkdownImage({ alt = '', node: _node, src, ...props }: ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
  const { t } = useI18n();
  const isLinkLabel = useContext(MarkdownLinkLabelContext);
  const { workspaceRoot, workspaceFiles, onOpenWorkspaceFileContextMenu } = useMarkdownNavigation();
  const target = resolveMarkdownLinkTarget(src, workspaceRoot);
  const filePath = useAvailableMarkdownFile(target.kind === 'workspace' ? target.path : null, workspaceFiles);
  const key = `${workspaceRoot ?? ''}:${filePath ?? ''}`;
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null);
  const [failedSource, setFailedSource] = useState<string>();
  useEffect(() => {
    if (!workspaceRoot || !filePath) return;
    let active = true;
    // The native bridge validates the workspace boundary and serves a bounded preview URL.
    void window.setsunaDesktop?.desktop.createWorkspaceFilePreview(workspaceRoot, filePath).then((result) => {
      if (active && result.ok) setPreview({ key, url: result.url });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [filePath, key, workspaceRoot]);
  const source = target.kind === 'external' && /^https?:/iu.test(target.href)
    ? target.href : preview?.key === key ? preview.url : undefined;
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
