import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { GitPullRequestArrow } from 'lucide-react';
import { Button, Popover, Tooltip } from '@setsuna-desktop/renderer-ui';
import type { PullRequestReference, ThreadPullRequest, ThreadPullRequestsStateService } from '../../contracts/index.js';
import { pullRequestKey } from '../../contracts/index.js';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import './thread-pull-requests.css';

const StateContext = createContext<ThreadPullRequestsStateService | null>(null);
export type OpenThreadPullRequest = (threadId: string, reference: PullRequestReference) => void;
const NavigationContext = createContext<OpenThreadPullRequest | null>(null);
const EMPTY: readonly ThreadPullRequest[] = Object.freeze([]);

export function ThreadPullRequestsProvider({ children, service }: { children: ReactNode; service: ThreadPullRequestsStateService | null }) {
  return <StateContext.Provider value={service}>{children}</StateContext.Provider>;
}
export function ThreadPullRequestNavigationProvider({ children, onOpen }: { children: ReactNode; onOpen: OpenThreadPullRequest }) {
  return <NavigationContext.Provider value={onOpen}>{children}</NavigationContext.Provider>;
}
function useThreadPullRequests(threadId: string) {
  const service = useContext(StateContext);
  const subscribe = useCallback((listener: () => void) => service?.subscribe(threadId, listener) ?? (() => undefined), [service, threadId]);
  const snapshot = useCallback(() => service?.getSnapshot(threadId) ?? EMPTY, [service, threadId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
type Props = { threadId: string; translate: RendererTranslate; className?: string };
type Status = 'open' | 'draft' | 'merged' | 'closed' | 'unknown' | 'mixed';
function status(item: ThreadPullRequest): Status {
  if (!item.summary) return 'unknown';
  return item.summary.state === 'OPEN' ? item.summary.draft ? 'draft' : 'open' : item.summary.state === 'MERGED' ? 'merged' : 'closed';
}
function groupStatus(items: readonly ThreadPullRequest[]): Status {
  const statuses = new Set(items.map(status));
  // An actionable PR takes precedence; heterogeneous terminal states stay neutral.
  for (const state of ['open', 'draft', 'unknown'] as const) if (statuses.has(state)) return state;
  return statuses.size === 1 ? status(items[0]) : 'mixed';
}
function StatusIcon({ state }: { state: Status }) {
  return <span className={`pr-thread-icon pr-thread-icon--${state}`} aria-hidden="true"><GitPullRequestArrow size={14} /><span className="pr-thread-icon__dot" /></span>;
}
function RequestList({ items, onOpen, translate }: { items: readonly ThreadPullRequest[]; onOpen(item: ThreadPullRequest): void; translate: RendererTranslate }) {
  return <div className="pr-thread-list">{items.map((item) => {
    const title = item.summary?.title || item.attachment.repository;
    const label = translate(`feature.pullRequests.${status(item)}`);
    return <Button variant="ghost" className="pr-thread-list__item" key={pullRequestKey(item.attachment)}
      title={`${item.attachment.repository} #${item.attachment.number} · ${label}${item.error ? ` · ${item.error}` : ''}`}
      aria-label={`${title} #${item.attachment.number} · ${label}`} onClick={() => onOpen(item)}>
      <StatusIcon state={status(item)} /><span className="pr-thread-list__title">{title}</span><span className="pr-thread-list__number">#{item.attachment.number}</span>
    </Button>;
  })}</div>;
}
export function ConversationPullRequests({ threadId, translate }: Props) {
  const items = useThreadPullRequests(threadId);
  const open = useContext(NavigationContext);
  if (!items.length || !open) return null;
  return <section className="pr-thread-section" aria-label={translate('feature.pullRequests.threadRequests')}>
    <div className="pr-thread-section__title">{translate('feature.pullRequests.threadRequests')}</div>
    <RequestList items={items} translate={translate} onOpen={(item) => open(threadId, item.attachment)} />
  </section>;
}
export function ThreadPullRequestBadge({ threadId, translate, className }: Props) {
  const items = useThreadPullRequests(threadId);
  const open = useContext(NavigationContext);
  const [expanded, setExpanded] = useState(false);
  if (!items.length || !open) return null;
  const state = groupStatus(items);
  const label = items.length === 1
    ? `${items[0].summary?.title || items[0].attachment.repository} #${items[0].attachment.number} · ${translate(`feature.pullRequests.${state}`)}`
    : translate('feature.pullRequests.threadRequestCount', { count: items.length });
  const button = <Button variant="ghost" className={`pr-thread-badge ${className ?? ''}`} aria-label={label}
    onClick={(event) => { event.stopPropagation(); if (items.length === 1) open(threadId, items[0].attachment); }}
    onKeyDown={(event) => event.stopPropagation()}><StatusIcon state={state} /></Button>;
  return items.length === 1 ? <Tooltip title={label}>{button}</Tooltip> : <Popover open={expanded} onOpenChange={setExpanded}
    placement="rightTop" contentLabel={label} className="pr-thread-popover" content={<RequestList items={items} translate={translate}
      onOpen={(item) => { setExpanded(false); open(threadId, item.attachment); }} />}>
    {button}
  </Popover>;
}
