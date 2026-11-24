import { CornerDownLeft } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import './design-chat-starter.css';

const promptIds = ['layout', 'components', 'palette', 'review'] as const;

export function DesignChatStarter({ onChoose }: Readonly<{ onChoose(prompt: string): void }>) {
  const { t } = useI18n();
  return <section className="design-chat-starter" aria-label={t('feature.design.chat.starter.label')}>
    <span className="design-chat-starter__sketch" aria-hidden="true" />
    <div className="design-chat-starter__prompts">
      {promptIds.map((id) => {
        const prompt = t(`feature.design.chat.starter.${id}`);
        return <button type="button" className="design-chat-starter__prompt" key={id} onClick={() => onChoose(prompt)}>
          <span>{prompt}</span>
          <CornerDownLeft className="design-chat-starter__arrow" size={13} aria-hidden="true" />
        </button>;
      })}
    </div>
  </section>;
}
