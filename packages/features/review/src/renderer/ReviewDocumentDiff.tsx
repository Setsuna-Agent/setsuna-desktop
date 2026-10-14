import { useCallback } from 'react';
import type { DesktopDiffFile, DesktopReviewFileVersionInput } from '../contracts/index.js';
import { useReviewRendererHost } from './host.js';
import { reviewWorkspaceFilePath } from './review-paths.js';
import type { ReviewPathContext } from './review-types.js';

export function ReviewDocumentDiff({ file, pathContext }: {
  file: DesktopDiffFile;
  pathContext: ReviewPathContext;
}) {
  const sides: DesktopReviewFileVersionInput['side'][] = [];
  if (file.action !== 'Created' && pathContext.source !== 'latest') sides.push('before');
  if (file.action !== 'Deleted') sides.push('after');
  const { translate: t } = useReviewRendererHost();
  if (!sides.length) return <div className="desktop-review-document-status" role="status">
    {t('feature.review.workspace.file.documentUnavailable')}
  </div>;
  return <div className="desktop-review-document-diff">
    {sides.map((side) => <ReviewDocumentVersion key={side} file={file} pathContext={pathContext} side={side} />)}
  </div>;
}

function ReviewDocumentVersion({ file, pathContext, side }: {
  file: DesktopDiffFile;
  pathContext: ReviewPathContext;
  side: DesktopReviewFileVersionInput['side'];
}) {
  const { bridge, translate: t, ui: { DocumentPreview } } = useReviewRendererHost();
  const path = side === 'before' ? file.previousPath ?? file.path : file.path;
  const filePath = reviewWorkspaceFilePath(path, pathContext);
  const { workspaceRoot, source, baseRef, revisions } = pathContext;
  const load = useCallback(async () => {
    if (!bridge || !workspaceRoot || !filePath) throw new Error(t('feature.review.workspace.file.documentUnavailable'));
    const result = await bridge.readDocumentFile(workspaceRoot, { filePath, source, baseRef, revisions, side });
    if (!result.ok) throw new Error(result.error);
    return result.data;
    // A refreshed diff can have the same path while its index/worktree bytes have changed.
  }, [bridge, file, workspaceRoot, filePath, source, baseRef, revisions, side, t]);
  const label = t(side === 'before' ? 'feature.review.workspace.file.imageBefore' : 'feature.review.workspace.file.imageAfter');
  return <DocumentPreview filePath={path} label={`${label}: ${path}`} load={load} />;
}
