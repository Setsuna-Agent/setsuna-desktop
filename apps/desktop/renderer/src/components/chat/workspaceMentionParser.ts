import type { WorkspaceEntry } from '@setsuna-desktop/contracts';

export type WorkspaceMentionTextPart =
  | { start: number; type: 'text'; value: string }
  | {
    entryType: WorkspaceEntry['type'];
    path: string;
    serializedText: string;
    start: number;
    type: 'mention';
  };

const serializedWorkspaceMentionPattern = /(^|\s)@([^@\s][^\s]*)/gu;

export function parseWorkspaceMentionText(content: string): WorkspaceMentionTextPart[] {
  const parts: WorkspaceMentionTextPart[] = [];
  let contentOffset = 0;

  for (const match of content.matchAll(serializedWorkspaceMentionPattern)) {
    const matchStart = match.index ?? 0;
    const boundary = match[1] ?? '';
    const path = match[2] ?? '';
    const mentionStart = matchStart + boundary.length;
    const mentionEnd = matchStart + match[0].length;

    if (mentionStart > contentOffset) {
      parts.push({ start: contentOffset, type: 'text', value: content.slice(contentOffset, mentionStart) });
    }
    parts.push({
      entryType: path.endsWith('/') ? 'directory' : 'file',
      path,
      serializedText: content.slice(mentionStart, mentionEnd),
      start: mentionStart,
      type: 'mention',
    });
    contentOffset = mentionEnd;
  }

  if (contentOffset < content.length) {
    parts.push({ start: contentOffset, type: 'text', value: content.slice(contentOffset) });
  }
  return parts;
}
