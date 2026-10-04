import type { BrowserBookmarkInput } from '../browserBookmarks.js';
import type { BrowserTranslate } from '../messages.js';
import { BrowserHistoryRecords } from './BrowserHistoryRecords.js';
import { BrowserBookmarkRecords } from './BrowserBookmarkRecords.js';
import './records.css';

export type BrowserRecordsKind = 'history' | 'bookmarks';
export type BrowserRecordsProps = {
  translate: BrowserTranslate;
  onClose(): void;
  onNavigate?: (url: string) => void;
  currentPage?: BrowserBookmarkInput;
  pinned?: boolean;
  onTogglePinned?: () => void;
  presentation?: 'panel' | 'page';
};

/** Bookmark editing is shared with settings; toolbar panels keep their compact presentation. */
export function BrowserRecordsManager({ kind, ...props }: BrowserRecordsProps & { kind: BrowserRecordsKind }) {
  return <section className={`browser-records${props.presentation === 'page' ? ' browser-records--page' : ''}`} aria-label={props.translate(`feature.browser.settings.${kind}`)}>
    {kind === 'history' ? <BrowserHistoryRecords {...props} /> : <BrowserBookmarkRecords {...props} />}
  </section>;
}
