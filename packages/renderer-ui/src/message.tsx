// Adapted from beUI Message Bubble (MIT): https://beui.dev/components/agents/message-bubble
import type { ReactNode } from 'react';
import { cn } from './utils.js';

export function MessageBubble({ content, footer, align = 'start', variant = 'ghost', className }: {
  content: ReactNode; footer?: ReactNode; align?: 'start' | 'end'; variant?: 'soft' | 'ghost'; className?: string;
}) {
  return <div className={cn('sd-message', `sd-message--${align}`, className)}>
    <div className="sd-message__body"><div className={cn('sd-message__content', `sd-message__content--${variant}`)}>{content}</div>
      {footer ? <div className="sd-message__footer">{footer}</div> : null}
    </div>
  </div>;
}
