import { Dialog } from '@setsuna-desktop/renderer-ui';
import type { ComponentProps } from 'react';
import { usePrText } from './context.js';
import { PullRequestDiff } from './PullRequestDiff.js';

/** Mount the file reader only on demand; its reading state lives in the PR session. */
export function PullRequestDiffDialog({ onClose, ...props }: ComponentProps<typeof PullRequestDiff> & { onClose(): void }) {
  const t = usePrText();
  return <Dialog title={t('diff')} width={1280} className="pr-diff-dialog" onClose={onClose}>
    <PullRequestDiff {...props} />
  </Dialog>;
}
