import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { Crosshair, Eye, EyeOff, List, Send, Trash2, X } from 'lucide-react';
import type { BrowserTranslate } from '../messages.js';
import type { useBrowserAnnotations } from './useBrowserAnnotations.js';

export function BrowserAnnotationDock({ state, translate: t }: {
  state: ReturnType<typeof useBrowserAnnotations>;
  translate: BrowserTranslate;
}) {
  if (!state.open) return null;
  return <div className="browser-annotation-dock" role="toolbar" aria-label={t('feature.browser.annotation.label')}>
    <IconButton className="browser-annotation-dock__button" label={t('feature.browser.annotation.pick')}
      aria-pressed={state.picking} disabled={state.sending || (!state.picking && !state.canPick)}
      onClick={() => state.picking ? state.cancelPick() : void state.pick()}><Crosshair size={16} /></IconButton>
    <IconButton className="browser-annotation-dock__button" label={t('feature.browser.annotation.list')}
      aria-pressed={state.listOpen} disabled={state.sending || !state.annotations.length}
      onClick={state.toggleList}><List size={16} /></IconButton>
    <IconButton className="browser-annotation-dock__button"
      label={t(state.markersVisible ? 'feature.browser.annotation.hideMarkers' : 'feature.browser.annotation.showMarkers')}
      aria-pressed={!state.markersVisible} disabled={state.sending || state.picking || !state.canClear}
      onClick={state.toggleMarkers}>{state.markersVisible ? <Eye size={16} /> : <EyeOff size={16} />}</IconButton>
    <IconButton className="browser-annotation-dock__button" label={t('feature.browser.annotation.clear')}
      disabled={state.sending || !state.canClear} onClick={state.clear}><Trash2 size={15} /></IconButton>
    <span className="browser-annotation-dock__divider" aria-hidden="true" />
    <Button variant="primary" className="browser-annotation-dock__send" loading={state.sending}
      aria-label={t('feature.browser.annotation.send')} title={t('feature.browser.annotation.send')}
      disabled={!state.canSend} onClick={() => void state.send()}>{!state.sending ? <Send size={14} /> : null}</Button>
    <IconButton className="browser-annotation-dock__button" label={t('feature.browser.annotation.close')}
      disabled={state.sending} onClick={state.close}><X size={15} /></IconButton>
  </div>;
}
