import { ToastStack, type ToastEntry, type ToastTone } from '@setsuna-desktop/renderer-ui';
export type { ToastEntry, ToastTone } from '@setsuna-desktop/renderer-ui';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

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

const DEFAULT_TOAST_DURATION_MS = 3_500;
const DEFAULT_ERROR_TOAST_DURATION_MS = 5_000;
const MAX_VISIBLE_TOASTS = 4;
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const { t } = useI18n();
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

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack entries={toasts} label={t('toast.region')} closeLabel={t('toast.close')} onDismiss={dismiss} />
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

function toastDurationMs(durationMs: number | undefined, tone: ToastTone): number {
  const fallback = tone === 'error' ? DEFAULT_ERROR_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS;
  if (!Number.isFinite(durationMs)) return fallback;
  return Math.max(1_000, Number(durationMs));
}
