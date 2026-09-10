// beUI toast-stack motion, with the application's timed dismissal and live-region semantics.
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './button.js';
import { SPRING_LAYOUT } from './motion.js';
import { overlayContainer } from './portal.js';

export type ToastTone = 'error' | 'info' | 'success' | 'warning';
export type ToastEntry = { durationMs: number; id: number; message: string; tone: ToastTone };
const icons = { error: AlertCircle, warning: AlertTriangle, success: CheckCircle2, info: Info };

export function ToastStack({ entries, label, closeLabel, onDismiss }: {
  entries: ToastEntry[]; label: string; closeLabel: string; onDismiss(id: number): void;
}) {
  const container = overlayContainer();
  if (!container) return null;
  return createPortal(<div className="sd-toast-region" aria-label={label}>
    <AnimatePresence initial={false}>
      {entries.map((entry) => <ToastItem key={entry.id} entry={entry} closeLabel={closeLabel} onDismiss={onDismiss} />)}
    </AnimatePresence>
  </div>, container);
}

function ToastItem({ entry, closeLabel, onDismiss }: { entry: ToastEntry; closeLabel: string; onDismiss(id: number): void }) {
  const reduce = useReducedMotion();
  const Icon = icons[entry.tone];
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(entry.id), entry.durationMs);
    return () => window.clearTimeout(timer);
  }, [entry.id, entry.durationMs, onDismiss]);
  return <motion.div layout={!reduce} className={`sd-toast sd-toast--${entry.tone}`}
    role={entry.tone === 'error' ? 'alert' : 'status'}
    initial={reduce ? false : { opacity: 0, y: -12, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduce ? 0 : -8 }} transition={SPRING_LAYOUT}>
    <Icon className="sd-toast__icon" size={17} aria-hidden="true" />
    <span className="sd-toast__message">{entry.message}</span>
    <IconButton label={closeLabel} size="small" onClick={() => onDismiss(entry.id)}><X size={14} /></IconButton>
  </motion.div>;
}
