// beUI toast-stack motion, with the application's timed dismissal and live-region semantics.
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from '../button.js';
import { SPRING_LAYOUT } from '../motion.js';
import { overlayContainer } from '../portal.js';

export type ToastTone = 'error' | 'info' | 'success' | 'warning';
export type ToastEntry = {
  durationMs: number | null; id: number; message: string; tone: ToastTone;
  action?: { label: string; onClick(): void };
};
const icons = { error: AlertCircle, warning: AlertTriangle, success: CheckCircle2, info: Info };

export function ToastStack({ entries, label, closeLabel, onDismiss }: {
  entries: ToastEntry[]; label: string; closeLabel: string; onDismiss(id: number): void;
}) {
  const container = overlayContainer();
  if (!container) return null;
  // Radix keeps explicit live regions available while a modal hides the rest of the page.
  return createPortal(<div className="sd-toast-region" data-toast-region aria-label={label} aria-live="polite">
    <AnimatePresence initial={false}>
      {entries.map((entry) => <ToastItem key={entry.id} entry={entry} closeLabel={closeLabel} onDismiss={onDismiss} />)}
    </AnimatePresence>
  </div>, container);
}

function ToastItem({ entry, closeLabel, onDismiss }: { entry: ToastEntry; closeLabel: string; onDismiss(id: number): void }) {
  const reduce = useReducedMotion();
  const Icon = icons[entry.tone];
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(entry.durationMs);
  const paused = hovered || focused;
  useEffect(() => {
    if (paused || remaining.current === null) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(entry.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (remaining.current !== null) remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [entry.id, paused, onDismiss]);
  return <motion.div layout={!reduce} className={`sd-toast sd-toast--${entry.tone}`}
    role={entry.tone === 'error' ? 'alert' : 'status'}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    initial={reduce ? false : { opacity: 0, y: -12, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduce ? 0 : -8 }} transition={SPRING_LAYOUT}>
    <Icon className="sd-toast__icon" size={17} aria-hidden="true" />
    <span className="sd-toast__message">{entry.message}</span>
    {entry.action ? <Button size="small" variant="ghost" onClick={() => {
      onDismiss(entry.id);
      entry.action?.onClick();
    }}>{entry.action.label}</Button> : null}
    <IconButton label={closeLabel} size="small" onClick={() => onDismiss(entry.id)}><X size={14} /></IconButton>
  </motion.div>;
}
