import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@setsuna-desktop/renderer-ui';
import type { DesktopDiffFile, DesktopReviewFileVersionInput, DesktopReviewTextFileResult } from '../contracts/index.js';
import { useReviewRendererHost } from './host.js';
import { reviewWorkspaceFilePath } from './review-paths.js';
import type { ReviewPathContext } from './review-types.js';

export type ReviewFileViewMode = 'preview' | 'source';

export function canPreviewReviewTextFile(file: DesktopDiffFile, context: ReviewPathContext): boolean {
  return Boolean(!file.contentKind && /\.(md|markdown|mdown|mkd|csv)$/i.test(file.path)
    && context.workspaceRoot && reviewWorkspaceFilePath(file.path, context)
    && !(file.action === 'Deleted' && context.source === 'latest'));
}

export function ReviewFileViewControls({ mode, onChange }: {
  mode: ReviewFileViewMode;
  onChange(mode: ReviewFileViewMode): void;
}) {
  const { translate: t } = useReviewRendererHost();
  const nextMode = mode === 'source' ? 'preview' : 'source';
  return (
    <div className="sd-panel-toolbar__group">
      <Button className="sd-panel-toolbar__text-button" variant="ghost" size="small" type="button"
        onClick={() => onChange(nextMode)}>{t(`feature.review.workspace.file.view.${nextMode}`)}</Button>
    </div>
  );
}

export function ReviewFileDocument({ file, filePath, pathContext, onOpenFile }: {
  file: DesktopDiffFile;
  filePath: string;
  pathContext: ReviewPathContext;
  onOpenFile(filePath: string, line?: number): void;
}) {
  const { bridge, translate: t, ui: { FileDocument } } = useReviewRendererHost();
  const { workspaceRoot, source, baseRef, revisions } = pathContext;
  const version = useMemo<DesktopReviewFileVersionInput>(() => ({
    filePath, source, baseRef, revisions, side: file.action === 'Deleted' ? 'before' : 'after',
  }), [baseRef, file.action, filePath, revisions, source]);
  const [loaded, setLoaded] = useState<{ file: DesktopDiffFile; version: DesktopReviewFileVersionInput; result: DesktopReviewTextFileResult } | null>(null);
  useEffect(() => {
    if (!bridge || !workspaceRoot) return;
    let cancelled = false;
    void bridge.readTextFile(workspaceRoot, version).catch((error: unknown): DesktopReviewTextFileResult => ({
      ok: false, error: error instanceof Error ? error.message : String(error),
    })).then((result) => { if (!cancelled) setLoaded({ file, version, result }); });
    return () => { cancelled = true; };
  }, [bridge, file, version, workspaceRoot]);
  const loadImage = useCallback(async (imagePath: string) => {
    if (!bridge || !workspaceRoot) return null;
    const result = await bridge.createImagePreview(workspaceRoot, { ...version, filePath: imagePath });
    return result.ok ? {
      src: result.url,
      dispose: () => { void bridge.releaseImagePreview(result.previewId).catch(() => undefined); },
    } : null;
  }, [bridge, version, workspaceRoot]);
  const result = loaded?.file === file && loaded.version === version ? loaded.result : null;
  if (!bridge || !workspaceRoot) return <div className="desktop-review-document-status" role="alert">{t('feature.review.workspace.file.documentUnavailable')}</div>;
  if (!result) return <div className="desktop-review-document-status" role="status">{t('feature.review.workspace.file.documentLoading')}</div>;
  if (!result.ok) return <div className="desktop-review-document-status" role="alert">{result.error}</div>;
  return <FileDocument content={result.content} filePath={filePath} onOpenFile={onOpenFile} loadImage={loadImage} />;
}
