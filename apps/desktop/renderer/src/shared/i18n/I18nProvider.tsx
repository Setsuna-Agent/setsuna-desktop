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
import { readBrowserStorageValue, writeBrowserStorageValue } from '../preferences/browserStorage.js';
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
  // Dynamic persisted notice keys can arrive from newer app versions. Keep one missing label from
  // crashing the entire renderer and let the untranslated key remain diagnosable in the UI.
  const localeMessages = messages[locale] as Partial<Record<MessageKey, string>>;
  const fallbackMessages = messages[DEFAULT_APP_LOCALE] as Partial<Record<MessageKey, string>>;
  const template = localeMessages[key] ?? fallbackMessages[key] ?? key;
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
  return normalizeAppLocale(readBrowserStorageValue(APP_LOCALE_STORAGE_KEY)) ?? DEFAULT_APP_LOCALE;
}

function applyLocalePreference(locale: AppLocale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  writeBrowserStorageValue(APP_LOCALE_STORAGE_KEY, locale);
}
