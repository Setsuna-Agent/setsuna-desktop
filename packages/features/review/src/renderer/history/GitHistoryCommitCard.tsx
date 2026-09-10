import { CircleUserRound, Clipboard, Clock3, GitCommitHorizontal, Github } from 'lucide-react';
import type { DesktopGitCommit, DesktopGitCommitDetails } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';

export function GitHistoryCommitCard({ commit, details, error, onRetry, onCopyId }: {
  commit: DesktopGitCommit;
  details: DesktopGitCommitDetails | null;
  error: string | null;
  onRetry: () => void;
  onCopyId: () => void;
}) {
  const { locale, openExternal, notifyError, translate: t } = useReviewRendererHost();
  const date = commitDate(commit.authoredAt, locale);
  const numbers = new Intl.NumberFormat(locale);
  const additions = details?.files.reduce((total, file) => total + file.additions, 0) ?? 0;
  const deletions = details?.files.reduce((total, file) => total + file.deletions, 0) ?? 0;
  const openGitHub = async () => {
    if (!details?.githubUrl) return;
    try {
      if (!await openExternal(details.githubUrl)) throw new Error('Open failed');
    } catch {
      notifyError(t('feature.review.history.openGitHubFailed'));
    }
  };
  return (
    <section className="git-commit-card" aria-label={t('feature.review.history.commitDetails')}>
      <div className="git-commit-card__content">
        <div className="git-commit-card__meta">
          <span className="git-commit-card__author"><CircleUserRound size={12} /><strong>{commit.author}</strong></span>
          <span className="git-commit-card__date"><Clock3 size={12} /><time dateTime={commit.authoredAt}>{date.relative} ({date.absolute})</time></span>
        </div>
        <p className="git-commit-card__message">{details?.message || commit.subject}</p>
      </div>
      <div className="git-commit-card__stats">
        {details ? <>
          <span>{t('feature.review.history.changedFiles', { count: numbers.format(details.files.length) })}</span>
          <span className="git-commit-card__additions">{t('feature.review.history.addedLines', { count: numbers.format(additions) })}</span>
          <span className="git-commit-card__deletions">{t('feature.review.history.deletedLines', { count: numbers.format(deletions) })}</span>
        </> : error ? <span className="git-commit-card__error" role="alert">{error} <button type="button" onClick={onRetry}>{t('feature.review.history.retry')}</button></span>
          : <span className="git-commit-card__loading" role="status">{t('feature.review.history.loading')}</span>}
      </div>
      <footer className="git-commit-card__footer">
        <button type="button" title={t('feature.review.history.copyCommitId')} aria-label={t('feature.review.history.copyCommitId')} onClick={onCopyId}>
          <GitCommitHorizontal size={13} /><code>{commit.oid.slice(0, 8)}</code><Clipboard size={12} />
        </button>
        {details?.githubUrl ? <button type="button" onClick={() => { void openGitHub(); }}><Github size={13} />{t('feature.review.history.openGitHub')}</button> : null}
      </footer>
    </section>
  );
}

function commitDate(value: string, locale: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { absolute: value, relative: '' };
  const seconds = (date.getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units[units.length - 1];
  return {
    relative: new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(Math.round(seconds / divisor), unit),
    absolute: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date),
  };
}
