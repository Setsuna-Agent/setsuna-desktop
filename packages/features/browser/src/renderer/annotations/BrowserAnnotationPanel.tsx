import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { Trash2, X } from 'lucide-react';
import type { RefObject } from 'react';
import { BROWSER_ANNOTATION_COMMENT_LIMIT, type BrowserDesktopBridge } from '../../contracts/index.js';
import type { BrowserTranslate } from '../messages.js';
import type { useBrowserAnnotations } from './useBrowserAnnotations.js';
import { BrowserAnnotationDock } from './BrowserAnnotationDock.js';
import { useAnnotationPopoverPosition, type AnnotationViewportRef } from './useAnnotationPopoverPosition.js';
import './annotations.css';

export function BrowserAnnotationPanel({ state, translate: t, bridge, tabId, hidden, surfaceRef, webviewRef }: {
  state: ReturnType<typeof useBrowserAnnotations>;
  translate: BrowserTranslate;
  bridge: BrowserDesktopBridge | null;
  tabId: string;
  hidden: boolean;
  surfaceRef: RefObject<HTMLDivElement>;
  webviewRef: AnnotationViewportRef;
}) {
  const position = useAnnotationPopoverPosition({
    bridge, tabId, surfaceRef, webviewRef, target: state.target,
    enabled: state.open && !state.picking && !hidden,
  });
  if (!state.open || hidden) return null;
  const savedIndex = state.annotations.findIndex((item) => item.target.id === state.target?.id);
  const number = savedIndex >= 0 ? savedIndex + 1 : state.annotations.length + 1;

  return <>
    {!state.picking && state.target ? <section className="browser-annotation-editor" ref={position.ref} style={position.style}
      aria-label={t('feature.browser.annotation.comment')}>
      <form onSubmit={(event) => { event.preventDefault(); state.save(); }}>
        <div className="browser-annotation-editor__header">
          <span className="browser-annotation-number">{number}</span>
          <code title={state.target.selector}>{state.target.selector}</code>
          <IconButton className="browser-annotation-editor__close" label={t('feature.browser.annotation.cancel')}
            disabled={state.sending} onClick={state.discard}><X size={14} /></IconButton>
        </div>
        <textarea key={state.target.id} autoFocus rows={3} value={state.comment} disabled={state.sending}
          maxLength={BROWSER_ANNOTATION_COMMENT_LIMIT} aria-label={t('feature.browser.annotation.comment')}
          placeholder={t('feature.browser.annotation.comment')} onChange={(event) => state.setComment(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && state.comment.trim() && !state.sending) {
              event.preventDefault(); state.save();
            }
            if (event.key === 'Escape' && !state.sending) { event.preventDefault(); state.discard(); }
          }} />
        <div className="browser-annotation-editor__footer">
          {savedIndex >= 0 ? <IconButton label={t('feature.browser.annotation.remove')} disabled={state.sending}
            onClick={() => state.remove(state.target!.id)}><Trash2 size={14} /></IconButton> : null}
          <div className="browser-annotation-editor__actions">
            <Button variant="primary" size="small" type="submit" disabled={state.sending || !state.comment.trim()}>
              {t(savedIndex >= 0 || !state.canPick ? 'feature.browser.annotation.save' : 'feature.browser.annotation.saveAndContinue')}
            </Button>
          </div>
        </div>
      </form>
    </section> : null}
    {state.listOpen && !state.picking && state.annotations.length ? <ol className="browser-annotation-list">
      {state.annotations.map((item, index) => <li key={item.target.id}>
        <Button variant="ghost" disabled={state.sending} className="browser-annotation-list__item" onClick={() => state.edit(item)}>
          <span className="browser-annotation-number">{index + 1}</span><span>{item.comment}</span>
        </Button>
        <IconButton disabled={state.sending} label={`${t('feature.browser.annotation.remove')} ${index + 1}`}
          onClick={() => state.remove(item.target.id)}><Trash2 size={13} /></IconButton>
      </li>)}
    </ol> : null}
    <BrowserAnnotationDock state={state} translate={t} />
  </>;
}
