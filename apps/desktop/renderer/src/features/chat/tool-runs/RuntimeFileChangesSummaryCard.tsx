import type { ThreadFileChangesResult, WorkspaceFileChangeAction } from '@setsuna-desktop/contracts';
import { Button, useConfirm } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, FileDiff, Redo2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { DesktopReviewOpenHandler } from '../../workspace/model.js';
import { useChatThreadId } from '../conversation/ChatThreadProvider.js';
import { useThreadFileChanges } from '../hooks/ThreadFileChangesProvider.js';
import type { RuntimeFileChangeSummary } from './runtimeFileChanges.js';
import {
  completedFileOperationActionLabel,
  normalizeFileOperationAction,
  pathBaseName,
} from './RuntimeToolRunPresentation.js';

const fileChangePreviewLimit = 3;

export function FileChangesSummaryCard({
  summary,
  toolCallIds = [],
  onApplyChanges,
  onOpenReview,
}: {
  summary: RuntimeFileChangeSummary;
  toolCallIds?: readonly string[];
  onApplyChanges?: (action: WorkspaceFileChangeAction) => void | Promise<void | ThreadFileChangesResult>;
  onOpenReview?: DesktopReviewOpenHandler;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { pendingAction, undone, available, apply } = useThreadFileChanges(useChatThreadId(), toolCallIds);
  const fileCount = summary.files.length;
  const singleFile = fileCount === 1 ? summary.files[0] : undefined;
  const filePaths = useMemo(
    () => [...new Set(summary.files.map((file) => file.path).filter(Boolean))],
    [summary.files],
  );
  const fileTotals = useMemo(() => {
    if (singleFile) return null;
    let additions = 0;
    let deletions = 0;
    for (const file of summary.files) {
      additions += Number.isFinite(file.additions)
        ? Math.max(0, Number(file.additions))
        : 0;
      deletions += Number.isFinite(file.deletions)
        ? Math.max(0, Number(file.deletions))
        : 0;
    }
    return { additions, deletions };
  }, [singleFile, summary.files]);
  const filePathKey = useMemo(() => filePaths.join('\0'), [filePaths]);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const canApply = Boolean(available && onApplyChanges && filePaths.length);
  const hasMoreFiles = fileCount > fileChangePreviewLimit;
  const visibleFiles = showAllFiles || !hasMoreFiles
    ? summary.files
    : summary.files.slice(0, fileChangePreviewLimit);
  const hiddenFileCount = Math.max(0, fileCount - fileChangePreviewLimit);

  useEffect(() => {
    setShowAllFiles(false);
  }, [filePathKey]);

  const applyChanges = async () => {
    if (!canApply || pendingAction || !onApplyChanges) return;
    const action = undone ? 'redo' : 'undo';
    try {
      await apply(onApplyChanges);
    } catch (error) {
      await confirm({
        title: t(action === 'undo' ? 'toolRun.changes.undoFailed' : 'toolRun.changes.redoFailed'),
        description: error instanceof Error ? error.message : String(error),
        acknowledgement: true,
        confirmLabel: t('common.close'),
      });
    }
  };

  return (
    <section className="chat-file-changes" aria-label={t('toolRun.changes.label')}>
      <div className="chat-file-changes__header">
        <span className="chat-file-changes__icon" aria-hidden="true">
          <FileDiff size={14} />
        </span>
        <span className="chat-file-changes__summary">
          <span className="chat-file-changes__title">
            {singleFile
              ? `${completedFileOperationActionLabel(
                normalizeFileOperationAction(singleFile.action),
                t,
              )} ${pathBaseName(singleFile.path, t)}`
              : t('toolRun.changes.filesEdited', { count: fileCount })}
          </span>
          {singleFile ? (
            <ChangeCounts
              additions={singleFile.additions}
              deletions={singleFile.deletions}
              showZero
            />
          ) : fileTotals ? (
            <ChangeCounts
              additions={fileTotals.additions}
              deletions={fileTotals.deletions}
              showZero
            />
          ) : null}
        </span>
        {onOpenReview || onApplyChanges ? (
          <span className="chat-file-changes__actions">
            {onApplyChanges ? (
              <Button variant={undone ? 'ghost' : 'danger'}
                className={`chat-file-changes__action${undone ? '' : ' chat-file-changes__action--danger'}`}
                type="button"
                disabled={!canApply || pendingAction !== null}
                onClick={() => void applyChanges()}
              >
                <span>
                  {t(
                    pendingAction
                      ? pendingAction === 'undo' ? 'toolRun.changes.undoing' : 'toolRun.changes.redoing'
                      : undone
                        ? 'toolRun.changes.redo'
                        : 'toolRun.changes.undo',
                  )}
                </span>
                {undone ? <Redo2 size={13} /> : <Undo2 size={13} />}
              </Button>
            ) : null}
            {onOpenReview ? (
              <Button variant="ghost"
                className="chat-file-changes__action chat-file-changes__action--review"
                type="button"
                onClick={() => onOpenReview()}
              >
                <span>{t('toolRun.changes.review')}</span>
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="chat-file-changes__list">
        {visibleFiles.map((file) => (
          <div className="chat-file-changes__item" key={file.path}>
            <Button variant="ghost"
              className="chat-file-changes__row"
              type="button"
              disabled={!onOpenReview}
              title={file.path}
              onClick={() => onOpenReview?.(file.path)}
            >
              <FileChangePath path={file.path} />
              <ChangeCounts
                additions={file.additions}
                deletions={file.deletions}
                showZero
              />
            </Button>
          </div>
        ))}
        {hasMoreFiles ? (
          <Button variant="ghost"
            className="chat-file-changes__more"
            type="button"
            aria-expanded={showAllFiles}
            onClick={() => setShowAllFiles((current) => !current)}
          >
            <span>
              {showAllFiles
                ? t('toolRun.changes.collapse')
                : t('toolRun.changes.showMore', { count: hiddenFileCount })}
            </span>
            <ChevronDown
              className="chat-file-changes__more-chevron"
              size={13}
            />
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function FileChangePath({ path }: { path: string }) {
  const separatorIndex = Math.max(
    path.lastIndexOf('/'),
    path.lastIndexOf('\\'),
  );
  const directory = separatorIndex >= 0 ? path.slice(0, separatorIndex + 1) : '';
  const name = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
  return (
    <span className="chat-file-changes__path" title={path}>
      {directory
        ? <span className="chat-file-changes__path-dir">{directory}</span>
        : null}
      <span className="chat-file-changes__path-name">{name}</span>
    </span>
  );
}

export function ChangeCounts({
  additions,
  deletions,
  showZero = false,
}: {
  additions?: number;
  deletions?: number;
  showZero?: boolean;
}) {
  const { t } = useI18n();
  const add = Number.isFinite(additions) ? Math.max(0, Number(additions)) : null;
  const del = Number.isFinite(deletions) ? Math.max(0, Number(deletions)) : null;
  if (!showZero && (add || 0) === 0 && (del || 0) === 0) return null;
  return (
    <span
      className="chat-change-counts"
      aria-label={t('toolRun.changes.lineCounts', {
        additions: add || 0,
        deletions: del || 0,
      })}
    >
      <RollingChangeCount
        className="chat-change-counts__add"
        prefix="+"
        value={add || 0}
      />
      <RollingChangeCount
        className="chat-change-counts__del"
        prefix="-"
        value={del || 0}
      />
    </span>
  );
}

function RollingChangeCount({
  className,
  prefix,
  value,
}: {
  className: string;
  prefix: string;
  value: number;
}) {
  const previousValueRef = useRef(value);
  const [roll, setRoll] = useState<{
    current: number;
    direction: 'up' | 'down';
    previous: number | null;
    version: number;
  }>({
    current: value,
    direction: 'up',
    previous: null,
    version: 0,
  });

  useEffect(() => {
    const previous = previousValueRef.current;
    if (previous === value) return;
    previousValueRef.current = value;
    setRoll((currentRoll) => ({
      current: value,
      direction: value >= previous ? 'up' : 'down',
      previous,
      version: currentRoll.version + 1,
    }));
  }, [value]);

  const rolling = roll.previous !== null && roll.previous !== roll.current;
  const values = rolling
    ? roll.direction === 'up'
      ? [roll.previous, roll.current]
      : [roll.current, roll.previous]
    : [roll.current];

  return (
    <span className={`${className} chat-change-counts__item`}>
      <span className="chat-change-counts__sign">{prefix}</span>
      <span
        className={`chat-change-counts__number ${
          rolling ? `is-rolling is-${roll.direction}` : ''
        }`}
      >
        <span
          className="chat-change-counts__number-stack"
          key={roll.version}
          onAnimationEnd={() => {
            setRoll((currentRoll) => (
              currentRoll.previous === null
                ? currentRoll
                : { ...currentRoll, previous: null }
            ));
          }}
        >
          {values.map((item, index) => (
            <span key={`${roll.version}:${index}:${item}`}>{item}</span>
          ))}
        </span>
      </span>
    </span>
  );
}
