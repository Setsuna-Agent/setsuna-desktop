import type { RuntimeBackgroundShellProcess } from '@setsuna-desktop/contracts';
import { LoaderCircle, Square, Terminal } from 'lucide-react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';

export function ConversationBackgroundServiceList({
  error,
  processes,
  terminatingIds,
  onTerminate,
}: {
  error: string | null;
  processes: RuntimeBackgroundShellProcess[];
  terminatingIds: ReadonlySet<string>;
  onTerminate: (processId: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  if (!processes.length) return null;
  return (
    <section className="chat-conversation-background-services" aria-label={t('conversation.overview.background.title')}>
      <div className="chat-conversation-background-services__title">
        <span>{t('conversation.overview.background.title')}</span>
      </div>
      <div className="chat-conversation-background-services__list">
        {processes.map((process) => {
          const terminating = terminatingIds.has(process.id);
          const command = singleLineCommand(process.command, t);
          return (
            <div className="chat-conversation-background-service" key={process.id}>
              <span className="chat-conversation-background-service__icon" aria-hidden="true">
                <Terminal size={13} />
              </span>
              <strong title={process.command}>{command}</strong>
              <button
                type="button"
                aria-label={t('conversation.overview.background.terminate', { command })}
                title={t(terminating ? 'conversation.overview.background.terminating' : 'conversation.overview.background.stop')}
                disabled={terminating}
                onClick={() => void onTerminate(process.id)}
              >
                {terminating ? <LoaderCircle className="is-spinning" size={13} /> : <Square size={11} fill="currentColor" />}
              </button>
            </div>
          );
        })}
      </div>
      {error ? <div className="chat-conversation-background-services__error" role="status" title={error}>{t('conversation.overview.background.refreshFailed', { error })}</div> : null}
    </section>
  );
}

function singleLineCommand(command: string, t: Translate): string {
  return command.replace(/\s+/gu, ' ').trim() || t('conversation.overview.background.unnamedCommand');
}
