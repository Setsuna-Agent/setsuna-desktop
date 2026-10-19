import { Button, Popover } from '@setsuna-desktop/renderer-ui';
import {
  normalizeRuntimeReviewNotice,
  type RuntimeReviewFinding,
  type RuntimeReviewModeNotice,
} from '@setsuna-desktop/contracts';
import { MessageSquare } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../../../shared/i18n/I18nProvider.js';
import { ScrollOverlay } from '../../../../shared/ui/ScrollOverlay.js';
import type { DesktopReviewOpenHandler } from '../../../workspace/model.js';
import { MarkdownRenderer } from '../../markdown/MarkdownRenderer.js';

/** Completed review output: optional summary plus one compact row per finding. */
export function ChatReviewSummaryCard({
  notice,
  onOpenFile,
}: {
  notice: RuntimeReviewModeNotice;
  onOpenFile?: DesktopReviewOpenHandler;
}) {
  const { t } = useI18n();
  const normalizedNotice = normalizeRuntimeReviewNotice(notice);
  const findings = normalizedNotice.findings ?? [];
  const summary = normalizedNotice.summary
    || (!findings.length ? normalizedNotice.review : '');

  return (
    <section className="chat-review-summary-card" aria-label={t('chat.review.completed')}>
      {summary ? (
        <MarkdownRenderer
          content={summary}
          legacyThinkingTags={normalizedNotice.reasoningSeparated !== true}
          streaming={false}
        />
      ) : null}
      {findings.length ? (
        <div className="chat-review-summary-card__panel">
          <div className="chat-review-summary-card__header">
            <MessageSquare aria-hidden="true" size={14} />
            <span>{t('chat.review.comments', { count: findings.length })}</span>
          </div>
          <div className="chat-review-summary-card__findings">
            {findings.map((finding, index) => (
              <ReviewFindingRow
                finding={finding}
                key={`${finding.path}:${finding.startLine}:${index}`}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReviewFindingRow({
  finding,
  onOpenFile,
}: {
  finding: RuntimeReviewFinding;
  onOpenFile?: DesktopReviewOpenHandler;
}) {
  const [open, setOpen] = useState(false);
  // A pending hover delay must not reopen the detail after the row was clicked.
  const dismissed = useRef(false);
  const dismiss = () => {
    dismissed.current = true;
    setOpen(false);
  };
  const location = findingLocation(finding);
  const content = (
    <>
      <span className="chat-review-summary-card__priority" data-priority={finding.priority}>{finding.priority}</span>
      <span className="chat-review-summary-card__title">{finding.title}</span>
      <span className="chat-review-summary-card__location">{location.short}</span>
    </>
  );

  return (
    <Popover
      trigger="hover"
      placement="bottomLeft"
      mouseEnterDelay={0.35}
      mouseLeaveDelay={0.12}
      open={open}
      onOpenChange={(next) => setOpen(next && !dismissed.current)}
      onPointerEnter={() => { dismissed.current = false; }}
      onFocusCapture={() => { dismissed.current = false; }}
      onPointerDownCapture={dismiss}
      className="chat-review-finding-detail"
      content={<ReviewFindingDetail finding={finding} location={location.full} />}
    >
      {onOpenFile ? (
        <Button variant="ghost"
          className="chat-review-summary-card__finding"
          type="button"
          onClick={() => onOpenFile(finding.path, finding.startLine, finding)}
        >
          {content}
        </Button>
      ) : (
        <div className="chat-review-summary-card__finding chat-review-summary-card__finding--static">
          {content}
        </div>
      )}
    </Popover>
  );
}

function ReviewFindingDetail({ finding, location }: { finding: RuntimeReviewFinding; location: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  // The native scrollbar is hidden; the overlay draws on the card edge without taking content width.
  return (
    <div className="chat-review-finding-detail__scroll-area">
      <div className="chat-review-finding-detail__viewport" ref={viewportRef}>
        <div className="chat-review-finding-detail__content">
          <div className="chat-review-finding-detail__heading">
            <span className="chat-review-summary-card__priority" data-priority={finding.priority}>{finding.priority}</span>
            <strong>{finding.title}</strong>
          </div>
          <div className="chat-review-finding-detail__location" title={location}>{location}</div>
          {finding.body ? (
            <div className="chat-review-finding-detail__body">
              <MarkdownRenderer content={finding.body} legacyThinkingTags={false} streaming={false} />
            </div>
          ) : null}
        </div>
      </div>
      <ScrollOverlay scrollRef={viewportRef} />
    </div>
  );
}

/** Row shows `file:line`; the detail keeps the full path and line range. */
function findingLocation(finding: RuntimeReviewFinding): { short: string; full: string } {
  const lines = finding.endLine && finding.endLine !== finding.startLine
    ? `${finding.startLine}-${finding.endLine}`
    : String(finding.startLine);
  const fileName = finding.path.split(/[\\/]/u).pop() || finding.path;
  return { short: `${fileName}:${lines}`, full: `${finding.path}:${lines}` };
}
