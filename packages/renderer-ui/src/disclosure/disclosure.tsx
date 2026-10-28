import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function Disclosure({ title, children, defaultOpen = false, className = '' }: Readonly<{
  title: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string;
}>) {
  return <details className={`sd-disclosure ${className}`} open={defaultOpen || undefined}>
    <summary role="button"><ChevronRight size={14} aria-hidden="true" />{title}</summary>
    <div className="sd-disclosure__body">{children}</div>
  </details>;
}
