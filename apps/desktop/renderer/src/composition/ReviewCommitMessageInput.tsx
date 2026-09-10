import type { ReviewCommitMessageInputProps } from '@setsuna-desktop/feature-review/renderer/host';
import { lazy, Suspense } from 'react';

const EditableWorkspaceFile = lazy(async () => {
  const module = await import('../features/workspace/editor/EditableWorkspaceFile.js');
  return { default: module.EditableWorkspaceFile };
});
const commitFile = { projectId: 'commit-message', path: '.git/COMMIT_EDITMSG' };

/** Reuse workspace editing, line numbers and theme-aware Git syntax without reading or writing .git files. */
export function ReviewCommitMessageInput({ content, onChange, onSave }: ReviewCommitMessageInputProps) {
  return (
    <Suspense fallback={null}>
      <EditableWorkspaceFile
        content={content}
        file={commitFile}
        language="git-commit"
        onChange={onChange}
        onSave={async () => { onSave(); return true; }}
      />
    </Suspense>
  );
}
