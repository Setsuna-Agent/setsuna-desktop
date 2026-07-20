import { LoaderCircle, Square, Terminal } from 'lucide-react';
import type { RuntimeBackgroundShellProcess } from '@setsuna-desktop/contracts';

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
  if (!processes.length) return null;
  return (
    <section className="chat-conversation-background-services" aria-label="后台服务">
      <div className="chat-conversation-background-services__title">
        <span>后台服务</span>
      </div>
      <div className="chat-conversation-background-services__list">
        {processes.map((process) => {
          const terminating = terminatingIds.has(process.id);
          const command = singleLineCommand(process.command);
          return (
            <div className="chat-conversation-background-service" key={process.id}>
              <span className="chat-conversation-background-service__icon" aria-hidden="true">
                <Terminal size={13} />
              </span>
              <strong title={process.command}>{command}</strong>
              <button
                type="button"
                aria-label={`终止后台服务：${command}`}
                title={terminating ? '正在终止服务' : '终止服务'}
                disabled={terminating}
                onClick={() => void onTerminate(process.id)}
              >
                {terminating ? <LoaderCircle className="is-spinning" size={13} /> : <Square size={11} fill="currentColor" />}
              </button>
            </div>
          );
        })}
      </div>
      {error ? <div className="chat-conversation-background-services__error" role="status" title={error}>刷新失败：{error}</div> : null}
    </section>
  );
}

function singleLineCommand(command: string): string {
  return command.replace(/\s+/gu, ' ').trim() || '未命名命令';
}
