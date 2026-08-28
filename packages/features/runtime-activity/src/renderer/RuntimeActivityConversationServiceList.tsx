import type { RuntimeBackgroundShellProcess } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { LoaderCircle, Square, Terminal } from 'lucide-react';
import { singleLineActivityCommand } from './runtime-activity-model.js';

export type RuntimeActivityConversationServiceListProps = Readonly<{
  error: string | null;
  services: readonly RuntimeBackgroundShellProcess[];
  stoppingIds: ReadonlySet<string>;
  translate: RendererTranslate;
  onStop: (processId: string) => void | Promise<void>;
}>;

export function RuntimeActivityConversationServiceList({
  error,
  services,
  stoppingIds,
  translate: t,
  onStop,
}: RuntimeActivityConversationServiceListProps) {
  if (!services.length) return null;
  return (
    <section
      aria-label={t('feature.runtimeActivity.conversationServices.title')}
      className="runtime-activity-conversation-services"
    >
      <div className="runtime-activity-conversation-services__title">
        <span>{t('feature.runtimeActivity.conversationServices.title')}</span>
      </div>
      <div className="runtime-activity-conversation-services__list">
        {services.map((service) => {
          const stopping = stoppingIds.has(service.id);
          const command = singleLineActivityCommand(
            service.command,
            t('feature.runtimeActivity.conversationServices.unnamedCommand'),
          );
          return (
            <div className="runtime-activity-conversation-service" key={service.id}>
              <span className="runtime-activity-conversation-service__icon" aria-hidden="true">
                <Terminal size={13} />
              </span>
              <strong title={service.command}>{command}</strong>
              <button
                aria-label={t('feature.runtimeActivity.conversationServices.stopService', { command })}
                disabled={stopping}
                title={t(stopping
                  ? 'feature.runtimeActivity.conversationServices.stopping'
                  : 'feature.runtimeActivity.conversationServices.stop')}
                type="button"
                onClick={() => void onStop(service.id)}
              >
                {stopping
                  ? <LoaderCircle className="is-spinning" size={13} />
                  : <Square size={11} fill="currentColor" />}
              </button>
            </div>
          );
        })}
      </div>
      {error ? (
        <div
          className="runtime-activity-conversation-services__error"
          role="status"
          title={error}
        >
          {t('feature.runtimeActivity.conversationServices.refreshFailed', { error })}
        </div>
      ) : null}
    </section>
  );
}
