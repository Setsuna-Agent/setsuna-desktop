import { pageScaleInverse } from '../../../shared/lib/zoomedPortalPosition.js';

const messageSelector = '[data-message-id]';

export type ChatMessageScrollAnchor = {
  id: string;
  offset: number;
};

export type HistoryScrollAnchor = {
  height: number;
  top: number;
  loadingSpace: number;
  message?: ChatMessageScrollAnchor;
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
    message: expandingWindow ? undefined : readVisibleChatMessageAnchor(viewport),
  };
}

export function restoredHistoryScrollTop(
  viewport: HTMLElement,
  anchor: HistoryScrollAnchor,
  newLoadingRow: HTMLElement | null,
): number {
  const message = anchor.message;
  const target = findChatMessageAnchorTarget(viewport, message);
  // A partial assistant turn can acquire a different render key when earlier segments arrive.
  const top = target && message
    ? chatMessageAnchorTop(viewport, target, message.offset)
    : anchor.top + viewport.scrollHeight - anchor.height;
  // When paging starts from the top, let a new loading row ahead of the message enter view.
  const loadingSpaceAdded = newLoadingRow && (!target
    || (newLoadingRow.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
    ? Math.max(0, historyLoadingRowSpace(newLoadingRow) - anchor.loadingSpace)
    : 0;
  return Math.max(0, top - loadingSpaceAdded);
}

export function findChatMessageAnchorTarget(viewport: HTMLElement, anchor?: ChatMessageScrollAnchor): HTMLElement | undefined {
  return anchor && Array.from(viewport.querySelectorAll<HTMLElement>(messageSelector))
    .find((node) => node.dataset.messageId === anchor.id);
}

export function readVisibleChatMessageAnchor(viewport: HTMLElement): ChatMessageScrollAnchor | undefined {
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

export function chatMessageAnchorTop(viewport: HTMLElement, target: HTMLElement, offset: number): number {
  return viewport.scrollTop + (target.getBoundingClientRect().top - viewport.getBoundingClientRect().top) * pageScaleInverse() - offset;
}

function historyLoadingRowSpace(row: HTMLElement | null): number {
  if (!row?.parentElement) return 0;
  const height = row.offsetHeight;
  const gap = height && row.nextElementSibling ? Number.parseFloat(getComputedStyle(row.parentElement).rowGap) || 0 : 0;
  return height + gap;
}
