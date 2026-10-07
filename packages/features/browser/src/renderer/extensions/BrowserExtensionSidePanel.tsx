import { IconButton, ResizeHandle } from '@setsuna-desktop/renderer-ui';
import { X } from 'lucide-react';
import { useLayoutEffect, type CSSProperties, type RefObject } from 'react';
import { DESKTOP_BROWSER_PARTITION, type BrowserExtension, type BrowserExtensionPanel } from '../../contracts/index.js';
import type { BrowserTranslate } from '../messages.js';
import { useBrowserExtensionPanelResize } from './useBrowserExtensionPanelResize.js';
import './side-panel.css';

export function BrowserExtensionSidePanel({ panel, extensions, contentRef, visible, position, translate, onClose, onWidthChange }: {
  panel: BrowserExtensionPanel | null;
  extensions: readonly BrowserExtension[];
  contentRef: RefObject<HTMLDivElement | null>;
  visible: boolean;
  position: CSSProperties;
  translate: BrowserTranslate;
  onClose(): void;
  onWidthChange(width: number): void;
}) {
  const extension = extensions.find(({ id, enabled }) => enabled && id === panel?.id);
  const resize = useBrowserExtensionPanelResize(Boolean(extension && panel && visible), contentRef);
  useLayoutEffect(() => onWidthChange(resize.width), [onWidthChange, resize.width]);
  if (!extension || !panel) return null;
  return <aside ref={resize.panelRef} className={`browser-extension-panel browser-extension-panel--window${visible ? '' : ' is-hidden'}`}
    aria-label={extension.name} aria-hidden={!visible || undefined} {...(!visible ? { inert: '' } : {})}
    style={{ ...position, width: resize.width }}>
    <ResizeHandle {...resize.handleProps}
      className={`browser-extension-panel__resize-handle${resize.resizing ? ' is-resizing' : ''}`}
      aria-label={translate('feature.browser.extension.resizePanel')}
      title={translate('feature.browser.extension.resizePanel')}
      aria-valuemin={resize.minWidth} aria-valuemax={resize.maxWidth} aria-valuenow={resize.width} />
    <div className="browser-extension-panel__header">
      {extension.icon ? <img src={extension.icon} alt="" /> : null}
      <span>{extension.name}</span>
      <IconButton label={translate('feature.browser.extension.closePanel')} onClick={onClose}><X size={14} /></IconButton>
    </div>
    <webview key={`${panel.id}:${panel.webContentsId ?? 'window'}:${panel.url}`} className="browser-extension-panel__content" src={panel.url}
      partition={DESKTOP_BROWSER_PARTITION} allowpopups={'true' as unknown as boolean} />
  </aside>;
}
