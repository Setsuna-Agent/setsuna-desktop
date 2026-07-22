import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { createPortal } from 'react-dom';

export type ToastTone = 'error' | 'info' | 'success' | 'warning';

export type ToastOptions = {
  durationMs?: number;
};

export type ToastApi = {
  dismiss: (id: number) => void;
  error: (message: string, options?: ToastOptions) => number | null;
  info: (message: string, options?: ToastOptions) => number | null;
  show: (message: string, options?: ToastOptions & { tone?: ToastTone }) => number | null;
  success: (message: string, options?: ToastOptions) => number | null;
  warning: (message: string, options?: ToastOptions) => number | null;
};

export type ToastEntry = {
  durationMs: number;
  id: number;
  message: string;
  tone: ToastTone;
};

const DEFAULT_TOAST_DURATION_MS = 3_500;
const DEFAULT_ERROR_TOAST_DURATION_MS = 5_000;
const MAX_VISIBLE_TOASTS = 4;
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextToastIdRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>((message, options = {}) => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) return null;
    nextToastIdRef.current += 1;
    const tone = options.tone ?? 'info';
    const entry: ToastEntry = {
      durationMs: toastDurationMs(options.durationMs, tone),
      id: nextToastIdRef.current,
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

  const viewport = toasts.length && typeof document !== 'undefined'
    ? createPortal(
        <div className="app-toast-region" aria-label="操作通知">
          {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />)}
        </div>,
        document.body,
      )
    : null;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {viewport}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used within ToastProvider.');
  return api;
}

export function enqueueToast(current: ToastEntry[], entry: ToastEntry): ToastEntry[] {
  const withoutDuplicate = current.filter((toast) => toast.message !== entry.message || toast.tone !== entry.tone);
  return [...withoutDuplicate, entry].slice(-MAX_VISIBLE_TOASTS);
}

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timeoutId = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [onDismiss, toast.durationMs, toast.id]);

  return (
    <div
      className={`app-toast app-toast--${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="app-toast__icon" aria-hidden="true">{toastIcon(toast.tone)}</span>
      <span className="app-toast__message">{toast.message}</span>
      <button type="button" aria-label="关闭提示" onClick={() => onDismiss(toast.id)}>
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

function toastIcon(tone: ToastTone) {
  if (tone === 'success') return <CheckCircle2 size={16} />;
  if (tone === 'warning') return <AlertTriangle size={16} />;
  if (tone === 'error') return <AlertCircle size={16} />;
  return <Info size={16} />;
}

function toastDurationMs(durationMs: number | undefined, tone: ToastTone): number {
  const fallback = tone === 'error' ? DEFAULT_ERROR_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS;
  if (!Number.isFinite(durationMs)) return fallback;
  return Math.max(1_000, Number(durationMs));
}
