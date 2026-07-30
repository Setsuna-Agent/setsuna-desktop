import { ChevronDown, FileDiff, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { RuntimeFileChangeSummary } from './runtimeFileChanges.js';
import {
  completedFileOperationActionLabel,
  normalizeFileOperationAction,
  pathBaseName,
} from './RuntimeToolRunPresentation.js';

const fileChangePreviewLimit = 3;

export function FileChangesSummaryCard({
  summary,
  onDiscardChanges,
  onOpenReview,
}: {
  summary: RuntimeFileChangeSummary;
  onDiscardChanges?: (filePaths: string[]) => void | Promise<void>;
  onOpenReview?: (filePath?: string) => void;
}) {
  const { t } = useI18n();
  const [discarding, setDiscarding] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
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
  const canDiscard = Boolean(onDiscardChanges && filePaths.length && !discarded);
  const hasMoreFiles = fileCount > fileChangePreviewLimit;
  const visibleFiles = showAllFiles || !hasMoreFiles
    ? summary.files
    : summary.files.slice(0, fileChangePreviewLimit);
  const hiddenFileCount = Math.max(0, fileCount - fileChangePreviewLimit);

  useEffect(() => {
    setShowAllFiles(false);
  }, [filePathKey]);

  const discardChanges = async () => {
    if (!canDiscard || discarding || !onDiscardChanges) return;
    setDiscarding(true);
    setDiscardError(null);
    try {
      await onDiscardChanges(filePaths);
      setDiscarded(true);
    } catch (error) {
      setDiscardError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiscarding(false);
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
        {onOpenReview || onDiscardChanges ? (
          <span className="chat-file-changes__actions">
            {onDiscardChanges ? (
              <button
                className="chat-file-changes__action chat-file-changes__action--danger"
                type="button"
                disabled={!canDiscard || discarding}
                onClick={() => void discardChanges()}
              >
                <span>
                  {t(
                    discarding
                      ? 'toolRun.changes.undoing'
                      : discarded
                        ? 'toolRun.changes.undone'
                        : 'toolRun.changes.undo',
                  )}
                </span>
                <Undo2 size={13} />
              </button>
            ) : null}
            {onOpenReview ? (
              <button
                className="chat-file-changes__action chat-file-changes__action--review"
                type="button"
                onClick={() => onOpenReview()}
              >
                <span>{t('toolRun.changes.review')}</span>
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {discardError
        ? <div className="chat-file-changes__error">{discardError}</div>
        : null}
      <div className="chat-file-changes__list">
        {visibleFiles.map((file) => (
          <div className="chat-file-changes__item" key={file.path}>
            <button
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
            </button>
          </div>
        ))}
        {hasMoreFiles ? (
          <button
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
          </button>
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
