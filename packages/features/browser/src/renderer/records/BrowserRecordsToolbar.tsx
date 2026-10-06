import { Button, Popover } from '@setsuna-desktop/renderer-ui';
import type { RefObject } from 'react';
import { BrowserFavoritesIcon, BrowserHistoryIcon } from './recordIcons.js';
import { BrowserRecordsManager, type BrowserRecordsProps } from './BrowserRecordsManager.js';
import type { BrowserRecordsPanelState } from './useBrowserRecordsPanel.js';

export function BrowserRecordsToolbar({ menuButtonRef, state, hidden, ...props }: Omit<BrowserRecordsProps, 'onClose'> & {
  menuButtonRef: RefObject<HTMLElement>;
  state: BrowserRecordsPanelState;
  hidden: boolean;
}) {
  const t = props.translate;
  return (
    <span className="desktop-browser-records-toolbar" hidden={!state.kind}>
      {(['bookmarks', 'history'] as const).map((kind) => (
        <Popover
          key={kind}
          modal
          placement="bottomRight"
          open={!hidden && !state.pinned && state.kind === kind}
          onOpenChange={(open) => {
            if (open) {
              state.open(kind);
            } else if (!state.pinned && state.kind === kind) state.close();
          }}
          onCloseAutoFocus={(event) => {
            if (state.pinned) event.preventDefault();
            else {
              // Closing a record panel also hides its shortcut; focus the persistent menu control.
              event.preventDefault();
              menuButtonRef.current?.focus();
            }
          }}
          className="browser-records__flyout"
          contentLabel={t(`feature.browser.settings.${kind}`)}
          content={<BrowserRecordsManager {...props} kind={kind} onClose={state.close} onTogglePinned={state.togglePinned} />}
        >
          <Button
            variant="ghost"
            className={`desktop-browser-navigation__button${state.kind === kind ? ' is-active' : ''}`}
            aria-label={t(`feature.browser.settings.${kind}`)}
            title={t(`feature.browser.settings.${kind}`)}
            hidden={state.kind !== kind}
            onClick={(event) => {
              if (!state.pinned) return;
              event.preventDefault();
              if (state.kind === kind) state.close(); else state.open(kind);
            }}
          >
            {kind === 'history' ? <BrowserHistoryIcon aria-hidden="true" size={14} /> : <BrowserFavoritesIcon aria-hidden="true" size={14} />}
          </Button>
        </Popover>
      ))}
    </span>
  );
}
