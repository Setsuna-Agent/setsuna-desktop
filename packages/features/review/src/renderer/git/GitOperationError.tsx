import { ChevronRight, CircleAlert, X } from 'lucide-react';
import { useReviewRendererHost } from '../host.js';
import { ReviewIconButton } from '../primitives.js';

/** Keep recovery commands available without letting raw Git output fill the panel. */
export function GitOperationError({ message, onDismiss }: {
  message: string;
  onDismiss: () => void;
}) {
  const { translate: t } = useReviewRendererHost();
  return (
    <div className="git-operation-error" role="alert">
      <details key={message}>
        <summary title={t('feature.review.git.errorDetails')}>
          <CircleAlert className="git-operation-error__icon" size={14} aria-hidden="true" />
          <span>{t('feature.review.git.operationIncomplete')}</span>
          <ChevronRight className="git-operation-error__chevron" size={12} aria-hidden="true" />
        </summary>
        <pre className="git-operation-error__details">{message}</pre>
      </details>
      <ReviewIconButton
        className="git-operation-error__dismiss"
        label={t('feature.review.git.dismissError')}
        onClick={onDismiss}
      >
        <X size={14} aria-hidden="true" />
      </ReviewIconButton>
    </div>
  );
}
