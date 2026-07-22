import type {
  AnswerRuntimeApprovalInput,
  RuntimeStructuredInputValue,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import {
  compactStructuredInputValues,
  RuntimeStructuredInputField,
  structuredInputDefaults,
} from './RuntimeStructuredInputField.js';

export function RuntimeUserInputActions({
  approvalId,
  run,
  onAnswerApproval,
}: {
  approvalId: string;
  run: RuntimeToolRun;
  onAnswerApproval: (approvalId: string, input: AnswerRuntimeApprovalInput) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const request = run.userInput;
  const expiresAt = request?.expiresAt;
  const [values, setValues] = useState<Record<string, RuntimeStructuredInputValue>>(() =>
    request ? structuredInputDefaults(request.requestedSchema.properties) : {},
  );
  const [submittingAction, setSubmittingAction] = useState<'submit' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(() => remainingSecondsUntil(expiresAt));

  useEffect(() => {
    if (!expiresAt) return undefined;
    const update = () => setRemainingSeconds(remainingSecondsUntil(expiresAt));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (!request) return null;
  const timedOut = remainingSeconds === 0;
  const submit = async (action: 'submit' | 'decline') => {
    if (submittingAction || timedOut) return;
    setSubmittingAction(action);
    setError(null);
    try {
      await onAnswerApproval(approvalId, {
        decision: action === 'submit' ? 'approve' : 'reject',
        userInputResponse: {
          action,
          ...(action === 'submit' ? { values: compactStructuredInputValues(values) } : {}),
        },
      });
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSubmittingAction(null);
    }
  };

  return (
    <form
      className="chat-tool-run__elicitation chat-tool-run__user-input"
      onSubmit={(event) => {
        event.preventDefault();
        void submit('submit');
      }}
    >
      <div className="chat-tool-run__elicitation-header">
        <strong>{request.title || t('toolRun.input.title')}</strong>
        {request.autoResolutionMs ? (
          <span>{timedOut
            ? t('toolRun.input.autoContinuing')
            : t('toolRun.input.autoContinueSeconds', { seconds: remainingSeconds ?? Math.ceil(request.autoResolutionMs / 1_000) })}</span>
        ) : <span>{t('toolRun.input.awaiting')}</span>}
      </div>
      <p className="chat-tool-run__elicitation-message">{request.message}</p>
      <div className="chat-tool-run__elicitation-fields">
        {Object.entries(request.requestedSchema.properties).map(([name, field]) => (
          <RuntimeStructuredInputField
            field={field}
            key={name}
            name={name}
            required={request.requestedSchema.required?.includes(name) === true}
            value={values[name]}
            onChange={(value) => setValues((current) => ({ ...current, [name]: value }))}
          />
        ))}
      </div>
      <div className="chat-tool-run__user-input-note">{t('toolRun.input.secretWarning')}</div>
      <div className="chat-tool-run__actions">
        <button type="submit" disabled={Boolean(submittingAction) || timedOut}>
          {t(submittingAction === 'submit' ? 'toolRun.input.submitting' : 'toolRun.input.submit')}
        </button>
        <button type="button" disabled={Boolean(submittingAction) || timedOut} onClick={() => void submit('decline')}>
          {t(submittingAction === 'decline' ? 'toolRun.input.skipping' : 'toolRun.input.skip')}
        </button>
      </div>
      {error ? <div className="chat-tool-run__action-error" role="alert">{error}</div> : null}
    </form>
  );
}

function remainingSecondsUntil(expiresAt: string | undefined): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1_000));
}
