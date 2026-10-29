import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useUiLabels } from '../locale.js';
import { ToastStack, type ToastEntry, type ToastTone } from './stack.js';

export type ToastOptions = {
  /** null keeps actionable feedback available until dismissed or resolved. */
  durationMs?: number | null;
  action?: ToastEntry['action'];
};
export type ToastApi = {
  dismiss(id: number): void;
  error(message: string, options?: ToastOptions): number | null;
  info(message: string, options?: ToastOptions): number | null;
  show(message: string, options?: ToastOptions & { tone?: ToastTone }): number | null;
  success(message: string, options?: ToastOptions): number | null;
  warning(message: string, options?: ToastOptions): number | null;
};

const ToastContext = createContext<ToastApi | null>(null);

/** The host supplies localization; every renderer surface shares the same notification queue. */
export function ToastProvider({ children, label, closeLabel }: PropsWithChildren<{ label?: string; closeLabel?: string }>) {
  const labels = useUiLabels();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextToastId = useRef(0);
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const show = useCallback<ToastApi['show']>((message, options = {}) => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) return null;
    const tone = options.tone ?? 'info';
    const entry: ToastEntry = {
      action: options.action,
      durationMs: options.durationMs === null ? null : Number.isFinite(options.durationMs)
        ? Math.max(1_000, Number(options.durationMs))
        : tone === 'error' ? 5_000 : 3_500,
      id: ++nextToastId.current,
      message: normalizedMessage,
      tone,
    };
    setToasts((current) => enqueueToast(current, entry));
    return entry.id;
  }, []);
  const api = useMemo<ToastApi>(() => ({
    dismiss,
    error: (message, options) => show(message, { ...options, tone: 'error' }),
    info: (message, options) => show(message, { ...options, tone: 'info' }),
    show,
    success: (message, options) => show(message, { ...options, tone: 'success' }),
    warning: (message, options) => show(message, { ...options, tone: 'warning' }),
  }), [dismiss, show]);

  return <ToastContext.Provider value={api}>
    {children}
    <ToastStack entries={toasts.slice(0, 4)} label={label ?? labels.notifications} closeLabel={closeLabel ?? labels.close} onDismiss={dismiss} />
  </ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used within ToastProvider.');
  return api;
}

/** State-owned feedback is withdrawn when cleared or when its view leaves the screen. */
export function ToastNotice(props: { message?: string | null; tone?: ToastTone }) {
  const toast = useContext(ToastContext);
  // SDK controls can run outside the desktop tree; reuse its queue whenever one is present.
  return toast ? <ToastFeedback {...props} /> : <ToastProvider><ToastFeedback {...props} /></ToastProvider>;
}

function ToastFeedback({ message, tone = 'error' }: { message?: string | null; tone?: ToastTone }) {
  const toast = useToast();
  useEffect(() => {
    if (!message) return;
    const id = toast.show(message, { tone });
    return () => { if (id !== null) toast.dismiss(id); };
  }, [message, toast, tone]);
  return null;
}

export function enqueueToast(current: ToastEntry[], entry: ToastEntry): ToastEntry[] {
  const withoutDuplicate = current.filter((toast) => toast.message !== entry.message || toast.tone !== entry.tone);
  return [...withoutDuplicate, entry];
}
