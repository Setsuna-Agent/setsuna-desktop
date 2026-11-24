import { pageScaleInverse } from '../../../shared/lib/zoomedPortalPosition.js';

const messageSelector = '[data-message-id]';

type VisibleMessage = {
  id: string;
  offset: number;
};

export type HistoryScrollAnchor = {
  height: number;
  top: number;
  loadingSpace: number;
  message?: VisibleMessage;
};

export function readHistoryScrollAnchor(
  viewport: HTMLElement,
  loadingRow: HTMLElement | null,
  expandingWindow: boolean,
): HistoryScrollAnchor {
  return {
    height: viewport.scrollHeight,
    top: viewport.scrollTop,
    loadingSpace: historyLoadingRowSpace(loadingRow),
    // Revealing the local window can insert segments inside the anchored assistant row.
    message: expandingWindow ? undefined : visibleHistoryMessage(viewport),
  };
}

export function restoredHistoryScrollTop(
  viewport: HTMLElement,
  anchor: HistoryScrollAnchor,
  newLoadingRow: HTMLElement | null,
): number {
  const message = anchor.message;
  const target = message && Array.from(viewport.querySelectorAll<HTMLElement>(messageSelector))
    .find((node) => node.dataset.messageId === message.id);
  // A partial assistant turn can acquire a different render key when earlier segments arrive.
  const top = target && message
    ? viewport.scrollTop + messageViewportOffset(target, viewport.getBoundingClientRect().top) - message.offset
    : anchor.top + viewport.scrollHeight - anchor.height;
  // When paging starts from the top, let a new loading row ahead of the message enter view.
  const loadingSpaceAdded = newLoadingRow && (!target
    || (newLoadingRow.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
    ? Math.max(0, historyLoadingRowSpace(newLoadingRow) - anchor.loadingSpace)
    : 0;
  return Math.max(0, top - loadingSpaceAdded);
}

function visibleHistoryMessage(viewport: HTMLElement): VisibleMessage | undefined {
  const bounds = viewport.getBoundingClientRect();
  if (bounds.bottom <= bounds.top) return undefined;
  for (const node of viewport.querySelectorAll<HTMLElement>(messageSelector)) {
    const message = node.getBoundingClientRect();
    if (message.top >= bounds.bottom) break;
    if (node.dataset.messageId && message.height > 0 && message.bottom > bounds.top) {
      return { id: node.dataset.messageId, offset: (message.top - bounds.top) * pageScaleInverse() };
    }
  }
  return undefined;
}

function messageViewportOffset(message: HTMLElement, viewportTop: number): number {
  return (message.getBoundingClientRect().top - viewportTop) * pageScaleInverse();
}

function historyLoadingRowSpace(row: HTMLElement | null): number {
  if (!row?.parentElement) return 0;
  const height = row.offsetHeight;
  const gap = height && row.nextElementSibling ? Number.parseFloat(getComputedStyle(row.parentElement).rowGap) || 0 : 0;
  return height + gap;
}
