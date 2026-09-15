import { Button, DiffViewControls, FileIcon, SelectField, TextField } from '@setsuna-desktop/renderer-ui';
import { MessageSquare, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffLineAnnotation } from '@pierre/diffs/react';
import type { ReactNode } from 'react';
import type { PullRequestDetail, PullRequestDiscussion } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { DiscussionCard } from './DiscussionTimeline.js';
import { PullRequestFileTree } from './PullRequestFileTree.js';
import { Loading } from './status.js';
import { usePullRequestFiles } from './usePullRequestFiles.js';
import type { DiscussionsState } from './useDiscussions.js';

export type DiffFocus = { discussion: PullRequestDiscussion; version: number };
export function PullRequestDiff({ client, detail, account, discussions, focus, onPublished }: {
  client: PullRequestsClient; detail: PullRequestDetail; account: string; discussions: DiscussionsState;
  focus: DiffFocus | null; onPublished(): void;
}) {
  const t = usePrText();
  const { CodePatch } = usePullRequestsHost();
  const [activePath, setActivePath] = useState<string | null>(focus?.discussion.path ?? null);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  const [wrap, setWrap] = useState(true);
  const [activeDiscussion, setActiveDiscussion] = useState<string | null>(focus?.discussion.id ?? null);
  const threadSurface = useRef<HTMLDivElement>(null);
  const codeScroll = useRef<HTMLDivElement>(null);
  const focusedAnnotation = useRef<number | null>(null);
  const files = usePullRequestFiles(client, detail, activePath);
  useEffect(() => { if (codeScroll.current) codeScroll.current.scrollTop = 0; }, [files.path]);
  useEffect(() => {
    if (!focus) return;
    setActivePath(focus.discussion.path);
    setActiveDiscussion(focus.discussion.id);
    setSearch('');
  }, [focus]);
  const threads = discussions.items.filter((item) => item.kind === 'thread' && item.path === files.path);
  const selected = threads.find((item) => item.id === activeDiscussion);
  const annotations = useMemo<DiffLineAnnotation<ReactNode>[]>(() => {
    const groups = new Map<string, PullRequestDiscussion[]>();
    for (const item of threads) {
      if (item.outdated || !item.line || !item.side) continue;
      const key = `${item.side}:${item.line}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.values()].map((items) => ({
      lineNumber: items[0].line!, side: items[0].side === 'LEFT' ? 'deletions' : 'additions',
      metadata: <Button size="small" variant="ghost" className="pr-diff-annotation" icon={<MessageSquare size={14} />} ref={(node) => {
        if (node && focus && items.some((item) => item.id === focus.discussion.id) && focusedAnnotation.current !== focus.version) {
          focusedAnnotation.current = focus.version;
          requestAnimationFrame(() => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
        }
      }} onClick={() => { setActiveDiscussion(items[0].id); requestAnimationFrame(() => threadSurface.current?.scrollIntoView({ block: 'nearest' })); }}>{t('lineDiscussions', { count: items.length })}</Button>,
    }));
  }, [threads, focus, t]);
  const filtered = files.files.filter((file) => file.path.toLowerCase().includes(search.toLowerCase()));
  const file = files.files.find((item) => item.path === files.path);
  return <section className="pr-diff" aria-label={t('diff')}>
    <aside className="pr-diff__navigation">
      <header><TextField leadingIcon={<Search size={14} />} aria-label={t('searchFiles')} placeholder={t('searchFiles')} value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
      </header>
      <div className="pr-diff__files">
        <PullRequestFileTree files={filtered} path={files.path} onSelect={(path) => { setActivePath(path); setActiveDiscussion(null); }} />
        {files.loading ? <Loading /> : null}
      </div>
    </aside>
    <div className="pr-diff__content">
      <header>
        <div className="pr-diff__file-info">
          {files.path ? <FileIcon className="pr-diff__file-icon" path={files.path} /> : null}
          <span className="pr-diff__path" title={file?.previousPath ? `${file.previousPath} → ${files.path}` : files.path ?? ''}>{file?.previousPath ? `${file.previousPath} → ` : ''}{files.path}</span>
          {file ? <span className="pr-diff-counts"><span>+{file.additions}</span><span>−{file.deletions}</span></span> : null}
        </div>
        <div className="pr-diff__view-controls" role="group" aria-label={t('diffLayout')}>
          <DiffViewControls className="app-shell-icon-control" layout={layout} wrap={wrap}
            layoutLabel={t(layout === 'split' ? 'split' : 'unified')} wrapLabel={t(wrap ? 'wrapOn' : 'wrapOff')}
            onLayoutChange={setLayout} onWrapChange={setWrap} />
        </div>
      </header>
      <div className="pr-diff__scroll" ref={codeScroll}>
        {files.error || files.patchError ? <div role="alert"><p className="sd-control-error">{files.error || files.patchError}</p><Button onClick={files.retry}>{t('retry')}</Button></div> : null}
        {files.path && !files.patch && !files.patchError ? <Loading /> : null}
        {!files.path && !files.loading ? <p className="pr-muted">{t('noFiles')}</p> : null}
        {files.patch?.kind === 'text' && files.patch.patch ? <div className="pr-diff__patch"><CodePatch patch={files.patch.patch} layout={layout} wrap={wrap} lineAnnotations={annotations} /></div> : null}
        {files.patch?.kind === 'binary' ? <p className="pr-empty">{t('binaryFile')}</p> : null}
        {files.patch?.kind === 'empty' ? <p className="pr-empty">{t('noTextChanges')}</p> : null}
        {threads.length ? <div className="pr-diff__threads" ref={threadSurface}>
          <SelectField aria-label={t('discussion')} value={selected?.id ?? threads[0].id} onValueChange={setActiveDiscussion}>{threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.comments[0]?.author.login} · {thread.line ?? t('fileComment')}{thread.outdated ? ` · ${t('outdated')}` : ''}</option>)}</SelectField>
          <DiscussionCard key={(selected ?? threads[0]).id} discussion={selected ?? threads[0]} client={client} detail={detail} account={account} onPublished={onPublished} onDiff={(thread) => { setActivePath(thread.path); setActiveDiscussion(thread.id); }} moreReplies={() => void discussions.moreReplies(selected ?? threads[0])} repliesPending={discussions.repliesPending === (selected ?? threads[0]).id} />
        </div> : null}
        {discussions.hasMore ? <Button disabled={discussions.pending} onClick={() => void discussions.more()}>{t('moreDiscussions')}</Button> : null}
      </div>
    </div>
  </section>;
}
