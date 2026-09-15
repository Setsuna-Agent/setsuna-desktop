import { useEffect, useRef, useState } from 'react';
import type { PullRequestDetail, PullRequestDiscussion, PullRequestDiscussionInput } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { errorText } from './context.js';

type Kind = PullRequestDiscussionInput['kind'];
const kinds: Kind[] = ['comments', 'reviews', 'threads', 'commits'];
type Feed = { items: PullRequestDiscussion[]; cursor: string | null; depth: number; error: string };
export function useDiscussions(client: PullRequestsClient, detail: PullRequestDetail, revision: number) {
  const [feeds, setFeeds] = useState<Partial<Record<Kind, Feed>>>({});
  const [pending, setPending] = useState(false);
  const [repliesPending, setRepliesPending] = useState<string | null>(null);
  const [replyError, setReplyError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const current = useRef(feeds);
  current.current = feeds;
  const { repository, number, updatedAt } = detail;
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setRepliesPending(null);
    void Promise.all(kinds.map(async (kind) => {
      try {
        let cursor: string | null = null;
        let depth = 0;
        let items: PullRequestDiscussion[] = [];
        const previous = current.current[kind];
        do {
          const page = await client.discussions({ repository, number, kind, cursor }, request.signal);
          items = mergeDiscussions(items, page.items);
          cursor = page.cursor;
          depth += 1;
        } while (cursor && depth < (previous?.depth ?? 1));
        if (kind === 'threads') {
          for (const item of items) {
            const count = previous?.items.find((entry) => entry.id === item.id)?.comments.length ?? 0;
            while (item.replyCursor && item.comments.length < count) {
              const next = await client.replies({ repository, number, threadId: item.id, cursor: item.replyCursor }, request.signal);
              item.comments = [...new Map([...item.comments, ...next.comments].map((entry) => [entry.id, entry])).values()];
              item.replyCursor = next.cursor;
            }
          }
        }
        if (!request.signal.aborted) setFeeds((previous) => ({ ...previous, [kind]: { items, cursor, depth, error: '' } }));
      } catch (cause) {
        if (!request.signal.aborted) setFeeds((previous) => ({ ...previous, [kind]: { items: previous[kind]?.items ?? [], cursor: previous[kind]?.cursor ?? null, depth: previous[kind]?.depth ?? 1, error: errorText(cause) } }));
      }
    })).finally(() => { if (!request.signal.aborted) setPending(false); });
    return () => request.abort();
  }, [client, repository, number, updatedAt, revision]);

  const more = async () => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || pending) return;
    setPending(true);
    try {
      await Promise.all(kinds.filter((kind) => current.current[kind]?.cursor).map(async (kind) => {
        const feed = current.current[kind]!;
        try {
          const next = await client.discussions({ repository, number, kind, cursor: feed.cursor }, signal);
          if (!signal.aborted) setFeeds((previous) => ({ ...previous, [kind]: { ...next, depth: feed.depth + 1, error: '', items: mergeDiscussions(previous[kind]?.items ?? [], next.items) } }));
        } catch (cause) { if (!signal.aborted) setFeeds((previous) => ({ ...previous, [kind]: { ...feed, error: errorText(cause) } })); }
      }));
    } finally { if (!signal.aborted) setPending(false); }
  };
  const moreReplies = async (discussion: PullRequestDiscussion) => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || pending || repliesPending) return;
    setRepliesPending(discussion.id);
    setReplyError('');
    try {
      const result = await client.replies({ repository, number, threadId: discussion.id, cursor: discussion.replyCursor }, signal);
      if (!signal.aborted) setFeeds((previous) => ({ ...previous, threads: previous.threads ? {
        ...previous.threads, items: previous.threads.items.map((item) => item.id !== discussion.id ? item : {
          ...item, replyCursor: result.cursor, comments: [...new Map([...item.comments, ...result.comments].map((entry) => [entry.id, entry])).values()],
        }),
      } : undefined }));
    } catch (cause) { if (!signal.aborted) setReplyError(errorText(cause)); }
    finally { if (!signal.aborted) setRepliesPending(null); }
  };
  const items = Object.values(feeds).flatMap((feed) => feed?.items ?? []).sort((a, b) => (a.comments[0]?.createdAt ?? '').localeCompare(b.comments[0]?.createdAt ?? ''));
  return { items, pending, more, moreReplies, repliesPending, hasMore: Object.values(feeds).some((feed) => feed?.cursor), errors: [...Object.values(feeds).flatMap((feed) => feed?.error ? [feed.error] : []), ...(replyError ? [replyError] : [])] };
}
export type DiscussionsState = ReturnType<typeof useDiscussions>;
function mergeDiscussions(current: PullRequestDiscussion[], next: PullRequestDiscussion[]) {
  return [...new Map([...current, ...next].map((item) => [item.id, item])).values()];
}
