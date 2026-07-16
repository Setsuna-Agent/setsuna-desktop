import { useEffect, useState } from 'react';
import type { AnswerRuntimeApprovalInput, RuntimeStructuredInputValue, RuntimeToolRun } from '@setsuna-desktop/contracts';
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
        <strong>{request.title || '需要你的输入'}</strong>
        {request.autoResolutionMs ? (
          <span>{timedOut ? '正在自动继续' : `${remainingSeconds ?? Math.ceil(request.autoResolutionMs / 1_000)} 秒后自动继续`}</span>
        ) : <span>等待回答</span>}
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
      <div className="chat-tool-run__user-input-note">请勿在此填写密码、API Key 或访问令牌。</div>
      <div className="chat-tool-run__actions">
        <button type="submit" disabled={Boolean(submittingAction) || timedOut}>
          {submittingAction === 'submit' ? '提交中' : '提交'}
        </button>
        <button type="button" disabled={Boolean(submittingAction) || timedOut} onClick={() => void submit('decline')}>
          {submittingAction === 'decline' ? '跳过中' : '跳过'}
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
