import type { DesktopReviewCommitMessage } from '../../contracts/index.js';
import type { ReviewTranslate } from '../messages.js';

export type CommitMessageDocument = { text: string; commentPrefix: string };

export function createCommitMessageDocument(commit: DesktopReviewCommitMessage, t: ReviewTranslate): CommitMessageDocument {
  // Renderer hot reload may run against an older main process. Never open a partial amend document.
  if (typeof commit.context !== 'string' || !commit.context.trim()) throw new Error(t('feature.review.git.commitContextUnavailable'));
  const message = commit.message.replace(/\r\n?/g, '\n').trimEnd();
  const lines = message.split('\n');
  let commentPrefix = '#';
  // Existing Markdown headings are commit text, so choose a prefix that cannot erase them on save.
  while (lines.some((line) => line.startsWith(commentPrefix))) commentPrefix += '#';
  const context = `Please enter the commit message for your changes. Lines starting\nwith '${commentPrefix}' will be ignored, and an empty message aborts the commit.\n\n${commit.context}\n`;
  const comments = context.split(/\r?\n/).map((line) => commentPrefix + (line && !line.startsWith('\t') ? ' ' : '') + line).join('\n');
  return { text: `${message}\n\n${comments}\n`, commentPrefix };
}

/** Match editor comment handling only; ordinary commits must retain literal # lines. */
export function readCommitMessageDocument({ text, commentPrefix }: CommitMessageDocument): string {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .filter((line) => !line.startsWith(commentPrefix)).join('\n').trim();
}
