import { Button, Popover } from '@setsuna-desktop/renderer-ui';
import { BookMarked, History } from 'lucide-react';
import { BrowserRecordsManager, type BrowserRecordsProps } from './BrowserRecordsManager.js';
import type { BrowserRecordsPanelState } from './useBrowserRecordsPanel.js';

export function BrowserRecordsToolbar({ state, hidden, ...props }: Omit<BrowserRecordsProps, 'onClose'> & {
  state: BrowserRecordsPanelState; hidden: boolean;
}) {
  const t = props.translate;
  return <>{(['bookmarks', 'history'] as const).map((kind) => <Popover key={kind} modal placement="bottomRight"
    open={!hidden && !state.pinned && state.kind === kind}
    onOpenChange={(open) => { if (open) state.open(kind); else if (!state.pinned && state.kind === kind) state.close(); }}
    onCloseAutoFocus={(event) => { if (state.pinned) event.preventDefault(); }}
    className="browser-records__flyout" contentLabel={t(`feature.browser.settings.${kind}`)}
    content={<BrowserRecordsManager {...props} kind={kind} onClose={state.close} onTogglePinned={state.togglePinned} />}>
    <Button variant="ghost" className={`desktop-browser-navigation__button${state.kind === kind ? ' is-active' : ''}`}
      aria-label={t(`feature.browser.settings.${kind}`)} title={t(`feature.browser.settings.${kind}`)}
      onClick={(event) => {
        if (!state.pinned) return;
        event.preventDefault();
        if (state.kind === kind) state.close(); else state.open(kind);
      }}>{kind === 'history' ? <History size={16} /> : <BookMarked size={16} />}</Button>
  </Popover>)}</>;
}
