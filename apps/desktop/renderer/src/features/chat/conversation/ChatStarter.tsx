import type { CSSProperties, ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

export function ChatStarter({
  children,
  composer,
  contextBar,
  settleComposerHeight = 0,
  settleOffsetY = 0,
  settlePhase = null,
}: {
  children: ReactNode;
  composer: ReactNode;
  contextBar?: ReactNode;
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
          {contextBar ? <div className="chat-starter__context">{contextBar}</div> : null}
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
}: {
  modelSetupNotice?: ReactNode;
  projectName?: string;
}) {
  const { t } = useI18n();
  const title = projectName
    ? t('chat.starter.projectTitle', { project: projectName })
    : t('chat.starter.title');

  return (
    <>
      <h1 className="chat-starter__title font-sans">
        <span className="chat-starter__reveal chat-starter__reveal--question block text-ink">
          {title}
        </span>
      </h1>

      {modelSetupNotice ? (
        <div className="chat-starter__notice chat-starter__reveal chat-starter__reveal--notice">
          {modelSetupNotice}
        </div>
      ) : null}
    </>
  );
}
