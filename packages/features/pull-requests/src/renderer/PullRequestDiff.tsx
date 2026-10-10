import { Button, DiffViewControls, FileIcon, TextField } from '@setsuna-desktop/renderer-ui';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DiffLineAnnotation } from '@pierre/diffs/react';
import type { ReactNode } from 'react';
import type { PullRequestDetail, PullRequestDiscussion } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { DiscussionCard } from './DiscussionTimeline.js';
import { PullRequestFileTree } from './PullRequestFileTree.js';
import { PullRequestScrollArea } from './PullRequestScrollArea.js';
import { PullRequestSkeleton } from './loading/PullRequestSkeleton.js';
import { usePullRequestFiles } from './usePullRequestFiles.js';
import { partitionDiffDiscussions } from './discussions/diff-discussions.js';
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
  const codeScroll = useRef<HTMLDivElement>(null);
  const focusedAnnotation = useRef<number | null>(null);
  const files = usePullRequestFiles(client, detail, activePath);
  useEffect(() => { if (codeScroll.current) codeScroll.current.scrollTop = 0; }, [files.path]);
  useEffect(() => {
    if (!focus) return;
    setActivePath(focus.discussion.path);
    setSearch('');
  }, [focus]);
  const threads = discussions.items.filter((item) => item.kind === 'thread' && item.path === files.path);
  const grouped = partitionDiffDiscussions(threads, files.patch?.patch ?? '');
  const renderDiscussion = (discussion: PullRequestDiscussion, inline: boolean) => (
    <div key={discussion.id} ref={(node) => {
      if (node && focus?.discussion.id === discussion.id && focusedAnnotation.current !== focus.version) {
        focusedAnnotation.current = focus.version;
        requestAnimationFrame(() => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
      }
    }}>
      <DiscussionCard discussion={discussion} client={client} detail={detail} account={account}
        inline={inline} onPublished={onPublished} onDiff={(thread) => setActivePath(thread.path)}
        moreReplies={() => void discussions.moreReplies(discussion)}
        repliesPending={discussions.repliesPending === discussion.id} />
    </div>
  );
  const annotations: DiffLineAnnotation<ReactNode>[] = grouped.inline.map((group) => ({
    lineNumber: group.line,
    side: group.side === 'LEFT' ? 'deletions' : 'additions',
    metadata: <div className="pr-diff__inline-discussions">{group.discussions.map((item) => renderDiscussion(item, true))}</div>,
  }));
  const filtered = files.files.filter((file) => file.path.toLowerCase().includes(search.toLowerCase()));
  const file = files.files.find((item) => item.path === files.path);
  return <section className="pr-diff" aria-label={t('diff')}>
    <aside className="pr-diff__navigation">
      <header><TextField leadingIcon={<Search size={14} />} aria-label={t('searchFiles')} placeholder={t('searchFiles')} value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
      </header>
      <PullRequestScrollArea className="pr-diff__files" contentClassName="pr-diff__files-content">
        <PullRequestFileTree files={filtered} path={files.path} onSelect={setActivePath} />
        {files.loading && !files.files.length ? <PullRequestSkeleton kind="files" label={t('loading')} /> : null}
      </PullRequestScrollArea>
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
      <PullRequestScrollArea className="pr-diff__scroll" contentClassName="pr-diff__scroll-content" scrollRef={codeScroll}>
        {files.error || files.patchError ? <div role="alert"><p className="sd-control-error">{files.error || files.patchError}</p><Button onClick={files.retry}>{t('retry')}</Button></div> : null}
        {!files.patch && !files.patchError && !files.error && (files.loading || files.path) ? <PullRequestSkeleton kind="patch" label={t('loading')} /> : null}
        {!files.path && !files.loading ? <p className="pr-muted">{t('noFiles')}</p> : null}
        {files.patch?.kind === 'text' && files.patch.patch ? <div className="pr-diff__patch"><CodePatch patch={files.patch.patch} layout={layout} wrap={wrap} lineAnnotations={annotations} /></div> : null}
        {files.patch?.kind === 'binary' ? <p className="pr-empty">{t('binaryFile')}</p> : null}
        {files.patch?.kind === 'empty' ? <p className="pr-empty">{t('noTextChanges')}</p> : null}
        {grouped.detached.length && (files.patch || files.patchError || files.error) ? <div className="pr-diff__threads">
          {grouped.detached.map((item) => renderDiscussion(item, false))}
        </div> : null}
        {discussions.hasMore ? <Button disabled={discussions.pending} onClick={() => void discussions.more()}>{t('moreDiscussions')}</Button> : null}
      </PullRequestScrollArea>
    </div>
  </section>;
}
