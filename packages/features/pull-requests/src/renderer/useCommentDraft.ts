import { useCallback, useSyncExternalStore } from 'react';
import { normalizeQuoteReferences, serializeQuote, type PullRequestQuote, type PullRequestQuoteReference } from './discussions/quote.js';

export type CommentDraft = { body: string; quotes?: PullRequestQuoteReference[]; requestId: string; uncertain: boolean; submittedBody?: string };
type DraftState = { draft: CommentDraft; pending: boolean };
const states = new Map<string, DraftState>();
const listeners = new Map<string, Set<() => void>>();
const draftKey = (key: string) => `setsuna-pr-draft:v1:${key}`;
const notify = (key: string) => listeners.get(key)?.forEach((listener) => listener());

function restoreDraft(key: string): CommentDraft {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(key)) ?? 'null') as CommentDraft | null;
    if (value && typeof value.body === 'string' && value.body.length <= 65_000 && /^[a-zA-Z0-9_-]{16,100}$/u.test(value.requestId) && typeof value.uncertain === 'boolean'
      && (value.submittedBody === undefined || (typeof value.submittedBody === 'string' && value.submittedBody.length <= 65_000))) {
      return { ...value, quotes: normalizeQuoteReferences(value.body, value.quotes) };
    }
  } catch { /* A storage failure must not prevent an in-memory draft. */ }
  return { body: '', requestId: crypto.randomUUID(), uncertain: false };
}

export function readDraftState(key: string): DraftState {
  let state = states.get(key);
  if (!state) {
    state = { draft: restoreDraft(key), pending: false };
    states.set(key, state);
  }
  return state;
}
export const readDraft = (key: string): CommentDraft => readDraftState(key).draft;

export function saveDraft(key: string, draft: CommentDraft): void {
  states.set(key, { ...readDraftState(key), draft });
  try {
    if (draft.body || draft.uncertain) localStorage.setItem(draftKey(key), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(key));
  } catch { /* Keep the current session's copy when browser storage is unavailable. */ }
  notify(key);
}

export function setDraftPublishing(key: string, pending: boolean): void {
  // Both PR tabs can mount an editor for the same thread. Lock both during the one write.
  states.set(key, { ...readDraftState(key), pending });
  notify(key);
}

export function updateDraft(key: string, body: string, quotes: PullRequestQuoteReference[] = []): void {
  const { draft, pending } = readDraftState(key);
  if (pending) return;
  // Editing remains available after a failed lookup; keep the original send separate
  // so checking it later cannot submit edited text with the same request ID.
  saveDraft(key, draft.uncertain
    ? { ...draft, body, quotes, submittedBody: draft.submittedBody ?? draft.body }
    : { body, quotes, requestId: crypto.randomUUID(), uncertain: false });
}

export function appendDraftQuote(key: string, quote: PullRequestQuote): boolean {
  const { draft, pending } = readDraftState(key);
  if (pending || !quote.text.trim()) return false;
  // Reuse the trailing paragraph break; removing/reinserting quotes must not accumulate empty lines.
  const end = Math.max(draft.body.trimEnd().length, draft.quotes?.at(-1)?.end ?? 0);
  const prefix = end ? `${draft.body.slice(0, end)}\n\n` : '';
  const content = serializeQuote(quote);
  const body = `${prefix}${content}\n\n`;
  if (body.length > 65_000) return false;
  updateDraft(key, body, [...(draft.quotes ?? []), { ...quote, id: crypto.randomUUID(), start: prefix.length, end: prefix.length + content.length }]);
  return true;
}

export function settleDraft(key: string, requestId: string, published: boolean): CommentDraft {
  const current = readDraft(key);
  if (current.requestId !== requestId) return current;
  const unchanged = current.body === (current.submittedBody ?? current.body);
  const next = {
    body: published && unchanged ? '' : current.body,
    ...(current.quotes ? { quotes: published && unchanged ? [] : current.quotes } : {}),
    requestId: !published && unchanged ? current.requestId : crypto.randomUUID(), uncertain: false,
  };
  saveDraft(key, next);
  return next;
}

export function useCommentDraft(key: string): DraftState {
  const subscribe = useCallback((listener: () => void) => {
    const subscriptions = listeners.get(key) ?? new Set<() => void>();
    subscriptions.add(listener);
    listeners.set(key, subscriptions);
    return () => {
      subscriptions.delete(listener);
      if (!subscriptions.size) listeners.delete(key);
    };
  }, [key]);
  return useSyncExternalStore(subscribe, () => readDraftState(key));
}
