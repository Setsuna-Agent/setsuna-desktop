import { useState, type AnimationEvent, type ReactNode } from 'react';

export function ChatEntryTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [settled, setSettled] = useState(false);
  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (
      event.currentTarget === event.target
      && event.animationName === 'chat-entry-reveal'
    ) {
      setSettled(true);
    }
  };

  return (
    <div
      className={[
        'chat-entry-transition',
        settled ? 'is-settled' : '',
        className,
      ].filter(Boolean).join(' ')}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="chat-entry-transition__inner">
        {children}
      </div>
    </div>
  );
}
