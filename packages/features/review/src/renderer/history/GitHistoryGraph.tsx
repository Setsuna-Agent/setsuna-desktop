import { ChevronDown, GitBranch, GitCommitHorizontal, Tag } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopGitCommit, DesktopGitRef } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { GitHistoryCommitMenu } from './GitHistoryCommitMenu.js';
import { GitHistoryScrollArea } from './GitHistoryScrollArea.js';
import { GIT_GRAPH_LANE_WIDTH, GIT_GRAPH_ROW_HEIGHT, layoutGitHistory, type GitGraphRow } from './gitGraph.js';

export const GitHistoryGraph = memo(function GitHistoryGraph({
  workspaceRoot, commits, refs, head, selectedOid, loading, hasMore, error, onSelect, onSelectRef, onLoadMore, onRetry,
}: {
  workspaceRoot: string;
  commits: DesktopGitCommit[];
  refs: DesktopGitRef[];
  head: string | null;
  selectedOid: string | null;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  onSelect: (oid: string) => void;
  onSelectRef: (ref: DesktopGitRef) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const { translate: t } = useReviewRendererHost();
  const [expanded, setExpanded] = useState(true);
  const [viewport, setViewport] = useState({ top: 0, height: 300 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => layoutGitHistory(commits), [commits]);
  const selectedIndex = commits.findIndex((commit) => commit.oid === selectedOid);
  const refsByOid = useMemo(() => {
    const result = new Map<string, DesktopGitRef[]>();
    for (const ref of refs) result.set(ref.oid, [...(result.get(ref.oid) ?? []), ref]);
    return result;
  }, [refs]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !expanded) return;
    const observer = new ResizeObserver(() => setViewport({ top: element.scrollTop, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);
  useEffect(() => {
    const index = selectedIndex;
    const element = scrollRef.current;
    if (index < 0 || !element) return;
    const top = index * GIT_GRAPH_ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + GIT_GRAPH_ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + GIT_GRAPH_ROW_HEIGHT - element.clientHeight;
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [expanded, selectedIndex]);
  const start = Math.max(0, Math.floor(viewport.top / GIT_GRAPH_ROW_HEIGHT) - 8);
  const end = Math.min(commits.length, Math.ceil((viewport.top + viewport.height) / GIT_GRAPH_ROW_HEIGHT) + 8);

  return (
    <section className={'git-history-graph' + (expanded ? '' : ' is-collapsed')}>
      <button className="git-history-section-heading" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <GitCommitHorizontal size={14} />
        <span className="git-history-graph__heading">{t('feature.review.history.graph')}</span>
        <span className="git-changes-count">{commits.length}{hasMore ? '+' : ''}</span>
        <ChevronDown size={13} className={expanded ? '' : 'is-collapsed'} />
      </button>
      {expanded ? (
        <GitHistoryScrollArea className="git-history-graph__scroll" scrollRef={scrollRef} onScroll={(event) => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
          <div className="git-history-graph__rows" role="list" style={{ height: commits.length * GIT_GRAPH_ROW_HEIGHT }}>
            {commits.slice(start, end).map((commit, offset) => {
              const index = start + offset;
              return (
                <GitHistoryCommitMenu key={commit.oid} workspaceRoot={workspaceRoot} commit={commit} onOpenChanges={onSelect}>
                  <div className={'git-history-row' + (selectedOid === commit.oid ? ' is-selected' : '')} role="listitem" style={{ top: index * GIT_GRAPH_ROW_HEIGHT, height: GIT_GRAPH_ROW_HEIGHT }}>
                    <button
                      className="git-history-row__commit"
                      type="button"
                      aria-pressed={selectedOid === commit.oid}
                      data-git-commit={commit.oid}
                      onClick={() => onSelect(commit.oid)}
                      onKeyDown={(event) => {
                        const next = event.key === 'ArrowDown' ? commits[index + 1] : event.key === 'ArrowUp' ? commits[index - 1] : null;
                        if (next) {
                          event.preventDefault();
                          onSelect(next.oid);
                          requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLButtonElement>('[data-git-commit="' + next.oid + '"]')?.focus());
                        }
                      }}
                    >
                      <GraphGlyph row={rows[index]} head={head === commit.oid} merge={commit.parents.length > 1} />
                      <span className={'git-history-row__subject' + (head === commit.oid ? ' is-head' : '')}>{commit.subject || commit.oid.slice(0, 8)}</span>
                      <span className="git-history-row__author">{commit.author}</span>
                    </button>
                    <span className="git-history-row__refs">
                      {(refsByOid.get(commit.oid) ?? []).map((ref) => (
                        <button className={'git-history-ref is-' + ref.kind} type="button" key={ref.name} title={ref.label} onClick={() => onSelectRef(ref)}>
                          {ref.kind === 'tag' ? <Tag size={10} /> : <GitBranch size={10} />}
                          <span>{ref.label}</span>
                        </button>
                      ))}
                    </span>
                  </div>
                </GitHistoryCommitMenu>
              );
            })}
          </div>
          {error ? <div className="git-history-status" role="alert">{error}<button type="button" onClick={onRetry}>{t('feature.review.history.retry')}</button></div> : null}
          {!commits.length && !error ? <p className="git-history-status">{t(loading ? 'feature.review.history.loading' : 'feature.review.history.emptyHistory')}</p> : null}
          {hasMore ? <button className="git-history-more" type="button" disabled={loading} onClick={onLoadMore}>{t(loading ? 'feature.review.history.loading' : 'feature.review.history.more')}</button> : null}
        </GitHistoryScrollArea>
      ) : null}
    </section>
  );
});

function GraphGlyph({ row, head, merge }: { row: GitGraphRow; head: boolean; merge: boolean }) {
  // The first lane shares the 14px icon column used by the sidebar headings and files.
  const x = (lane: number) => 7 + lane * GIT_GRAPH_LANE_WIDTH;
  return (
    <svg className="git-history-row__graph" width={14 + (row.columns - 1) * GIT_GRAPH_LANE_WIDTH} height={GIT_GRAPH_ROW_HEIGHT} aria-hidden="true">
      {row.edges.map((edge, index) => {
        const mid = (edge.start + edge.end) / 2;
        const d = 'M ' + x(edge.from) + ' ' + edge.start + ' C ' + x(edge.from) + ' ' + mid + ', ' + x(edge.to) + ' ' + mid + ', ' + x(edge.to) + ' ' + edge.end;
        return <path key={index} d={d} fill="none" stroke={edge.color} strokeWidth={1.5} />;
      })}
      <circle cx={x(row.lane)} cy={GIT_GRAPH_ROW_HEIGHT / 2} r={head ? 5 : 4} fill={head || merge ? 'var(--git-nav-bg)' : row.color} stroke={row.color} strokeWidth={1.5} />
      {merge ? <circle cx={x(row.lane)} cy={GIT_GRAPH_ROW_HEIGHT / 2} r={1.5} fill={row.color} /> : null}
    </svg>
  );
}
