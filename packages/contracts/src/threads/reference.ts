export type RuntimeThreadReference = { id: string; title: string };
export type RuntimeThreadMention = { thread: RuntimeThreadReference; start: number; end: number };

/** Store identity in the message text so drafts, queued turns and history keep the reference. */
export function threadMentionText(thread: RuntimeThreadReference): string {
  const title = (thread.title.replace(/[[\]\\\p{Cc}]/gu, ' ').trim() || thread.id).slice(0, 200);
  return `[@${title}](thread://${thread.id})`;
}

export function isRuntimeThreadReference(value: unknown): value is RuntimeThreadReference {
  if (!value || typeof value !== 'object') return false;
  const thread = value as Partial<RuntimeThreadReference>;
  return typeof thread.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u.test(thread.id)
    && typeof thread.title === 'string';
}

export function parseThreadMentions(content: string): RuntimeThreadMention[] {
  const mentions: RuntimeThreadMention[] = [];
  const pattern = /\[@([^\]\\\p{Cc}]{1,200})\]\(thread:\/\/([A-Za-z0-9][A-Za-z0-9._-]{0,191})\)/gu;
  for (const match of content.matchAll(pattern)) {
    mentions.push({ thread: { id: match[2], title: match[1] }, start: match.index, end: match.index + match[0].length });
  }
  return mentions;
}
