import { Image as ImageIcon, Sparkles } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { formatTokenCount } from '../conversation/chatContextUsage.js';
import type { ChatModelOption } from './chatModelOptions.js';

export function ChatModelDetails({ option: { model, provider } }: { option: ChatModelOption }) {
  const { t } = useI18n();
  return (
    <div className="chat-model-details">
      <strong className="chat-model-details__name">{model.name || model.code}</strong>
      {model.code !== model.name ? <code className="chat-model-details__code">{model.code}</code> : null}
      <dl className="chat-model-details__parameters">
        <div>
          <dt>{t('chat.model.provider')}</dt>
          <dd>{provider.name || t('chat.model.unnamedProvider')}</dd>
        </div>
        {model.contextWindowTokens ? (
          <div>
            <dt>{t('chat.model.contextWindow')}</dt>
            <dd>{formatTokenCount(model.contextWindowTokens)} tokens</dd>
          </div>
        ) : null}
        {model.maxOutputTokens > 0 ? (
          <div>
            <dt>{t('chat.model.maxOutput')}</dt>
            <dd>{formatTokenCount(model.maxOutputTokens)} tokens</dd>
          </div>
        ) : null}
      </dl>
      {model.thinkingEnabled || model.supportsImages ? (
        <div className="chat-model-details__capabilities">
          {model.thinkingEnabled ? <span><Sparkles size={12} aria-hidden="true" />{t('chat.composer.thinking')}</span> : null}
          {model.supportsImages ? <span><ImageIcon size={12} aria-hidden="true" />{t('chat.model.imageInput')}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
