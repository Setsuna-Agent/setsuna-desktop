import type { BrowserAnnotationMessage } from '@setsuna-desktop/feature-browser/contracts';
import { Button, Popover } from '@setsuna-desktop/renderer-ui';
import { MessageSquare } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import '../styles/chat-browser-annotations.css';

export function BrowserAnnotationReference({ message }: { message: BrowserAnnotationMessage }) {
  const { t } = useI18n();
  const count = message.annotations.length;
  const label = t(count === 1 ? 'feature.browser.annotation.countOne' : 'feature.browser.annotation.countMany', { count });
  return <Popover placement="topLeft" className="chat-browser-annotations__detail" content={
    <ol className="chat-browser-annotations__list" aria-label={label}>
      {message.annotations.map(({ target, comment }, index) => (
        <li key={`${target.id}:${index}`} aria-label={t('feature.browser.annotation.tag', { number: index + 1 })}>
          <code title={target.selector}>{target.tag}</code>
          <p>{comment}</p>
        </li>
      ))}
    </ol>
  }>
    <Button variant="ghost" size="small" className="chat-browser-annotations__tag" title={message.tab.url}
      icon={<MessageSquare size={14} />}>
      {label}
    </Button>
  </Popover>;
}
