import type { RuntimeConfigState, RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { messages, type MessageKey } from './messages.js';

export type AppLocale = RuntimeInterfaceLanguage;
export type TranslationParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: TranslationParams) => string;

export const DEFAULT_APP_LOCALE: AppLocale = 'zh-CN';
export const APP_LOCALE_STORAGE_KEY = 'setsuna-interface-language';

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: Translate;
};

const defaultContext: I18nContextValue = {
  locale: DEFAULT_APP_LOCALE,
  setLocale: () => undefined,
  t: (key, params) => translate(DEFAULT_APP_LOCALE, key, params),
};

const I18nContext = createContext<I18nContextValue>(defaultContext);

export function I18nProvider({ children, initialLocale }: PropsWithChildren<{ initialLocale?: AppLocale }>) {
  const [locale, setLocaleState] = useState<AppLocale>(() => initialLocale ?? readStoredLocale());
  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    applyLocalePreference(nextLocale);
  }, []);
  const t = useCallback<Translate>((key, params) => translate(locale, key, params), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  useEffect(() => applyLocalePreference(locale), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function translate(locale: AppLocale, key: MessageKey, params?: TranslationParams): string {
  const template: string = messages[locale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match));
}

export function interfaceLanguageFromConfig(config: RuntimeConfigState | null): AppLocale {
  return normalizeAppLocale(config?.desktopSettings?.interfaceLanguage) ?? DEFAULT_APP_LOCALE;
}

export function normalizeAppLocale(value: unknown): AppLocale | null {
  return value === 'zh-CN' || value === 'en-US' ? value : null;
}

export function initializeLocalePreference(): void {
  applyLocalePreference(readStoredLocale());
}

function readStoredLocale(): AppLocale {
  if (typeof window === 'undefined') return DEFAULT_APP_LOCALE;
  try {
    return normalizeAppLocale(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)) ?? DEFAULT_APP_LOCALE;
  } catch {
    return DEFAULT_APP_LOCALE;
  }
}

function applyLocalePreference(locale: AppLocale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Sandboxed previews may deny storage; the in-memory preference still applies.
  }
}
