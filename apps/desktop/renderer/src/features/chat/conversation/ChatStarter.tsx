import {
  Bug,
  GitPullRequest,
  ListChecks,
  ListTodo,
  MessagesSquare,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

type StarterSuggestion = {
  icon: LucideIcon;
  prompt: string;
};

export function ChatStarter({
  children,
  composer,
  settleComposerHeight = 0,
  settleOffsetY = 0,
  settlePhase = null,
}: {
  children: ReactNode;
  composer: ReactNode;
  settleComposerHeight?: number;
  settleOffsetY?: number;
  settlePhase?: 'settling' | 'settled' | null;
}) {
  return (
    <div
      className={`chat-starter font-sans ${settlePhase ? `is-${settlePhase}` : ''}`}
      style={{
        '--chat-starter-composer-height': `${settleComposerHeight}px`,
        '--chat-starter-settle-y': `${settleOffsetY}px`,
      } as CSSProperties}
    >
      <div className="chat-starter__stage">
        {children}

        <div className="chat-starter__composer chat-starter__reveal chat-starter__reveal--composer">
          <div className="chat-starter__composer-motion" data-chat-starter-composer-motion>
            {composer}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatStarterContent({
  modelSetupNotice,
  projectName,
  onSend,
}: {
  modelSetupNotice?: ReactNode;
  projectName?: string;
  onSend: (value: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const title = projectName
    ? t('chat.starter.projectTitle', { project: projectName })
    : t('chat.starter.title');
  const suggestions: StarterSuggestion[] = projectName
    ? [
        { icon: Search, prompt: t('chat.starter.project.explore', { project: projectName }) },
        { icon: GitPullRequest, prompt: t('chat.starter.project.review', { project: projectName }) },
        { icon: ListChecks, prompt: t('chat.starter.project.verify', { project: projectName }) },
      ]
    : [
        { icon: ListTodo, prompt: t('chat.starter.general.plan') },
        { icon: MessagesSquare, prompt: t('chat.starter.general.explain') },
        { icon: Bug, prompt: t('chat.starter.general.debug') },
      ];

  const sendSuggestion = async (prompt: string) => {
    if (pendingPrompt) return;
    setPendingPrompt(prompt);
    try {
      await onSend(prompt).catch(() => false);
    } finally {
      setPendingPrompt(null);
    }
  };

  return (
    <>
      <h1 className="chat-starter__title font-sans">
        <span className="chat-starter__reveal chat-starter__reveal--greeting block text-ink-3">
          {t('chat.starter.greeting')}
        </span>
        <span className="chat-starter__reveal chat-starter__reveal--question block text-ink">
          {title}
        </span>
      </h1>

      {modelSetupNotice ? (
        <div className="chat-starter__notice chat-starter__reveal chat-starter__reveal--notice">
          {modelSetupNotice}
        </div>
      ) : null}

      <div
        aria-label={t('chat.starter.suggestions')}
        className="chat-starter__suggestions chat-starter__reveal chat-starter__reveal--suggestions flex flex-col"
        role="group"
      >
        {suggestions.map(({ icon: Icon, prompt }) => (
          <button
            className="chat-starter__suggestion -mx-2 flex min-h-10 items-center gap-3 rounded-control px-2 py-2.5 text-left text-[14px] transition-[background-color,color,transform] duration-150 ease-out-strong active:scale-[0.99]"
            disabled={pendingPrompt !== null}
            key={prompt}
            type="button"
            onClick={() => void sendSuggestion(prompt)}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 truncate">{prompt}</span>
          </button>
        ))}
      </div>
    </>
  );
}
