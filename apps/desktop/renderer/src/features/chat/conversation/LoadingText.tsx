import type { ReactNode } from 'react';

type LoadingTextProps = {
  children: ReactNode;
  className?: string;
};

export function LoadingText({ children, className }: LoadingTextProps) {
  return <span className={['chat-loading-text', className].filter(Boolean).join(' ')}>{children}</span>;
}
