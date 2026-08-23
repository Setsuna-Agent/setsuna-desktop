import type { RuntimeConfigState, RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import {
  composeRendererMessages,
  resolveRendererMessage,
  type ComposedRendererMessages,
  type RendererFeatureMessageKey,
} from '@setsuna-desktop/feature-core/renderer';
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
import { hostMessages, type MessageKey } from './messages.js';

export type AppLocale = RuntimeInterfaceLanguage;
export type TranslationParams = Record<string, string | number>;
export type AppMessageKey = MessageKey | RendererFeatureMessageKey;
export type Translate = (key: AppMessageKey, params?: TranslationParams) => string;

export const DEFAULT_APP_LOCALE: AppLocale = 'zh-CN';
export const APP_LOCALE_STORAGE_KEY = 'setsuna-interface-language';
const hostOnlyMessages = composeRendererMessages(hostMessages, []);
const reportedMissingMessages = new Set<string>();

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

export function I18nProvider({
  children,
  initialLocale,
  messageCatalog = hostOnlyMessages,
}: PropsWithChildren<{
  initialLocale?: AppLocale;
  messageCatalog?: ComposedRendererMessages<AppLocale>;
}>) {
  const [locale, setLocaleState] = useState<AppLocale>(() => initialLocale ?? readStoredLocale());
  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    applyLocalePreference(nextLocale);
  }, []);
  const t = useCallback<Translate>(
    (key, params) => translate(locale, key, params, messageCatalog),
    [locale, messageCatalog],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  useEffect(() => applyLocalePreference(locale), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function translate(
  locale: AppLocale,
  key: AppMessageKey,
  params?: TranslationParams,
  messageCatalog: ComposedRendererMessages<AppLocale> = hostOnlyMessages,
): string {
  // Dynamic persisted notice keys can arrive from newer app versions. Keep one missing label from
  // crashing the entire renderer and let the untranslated key remain diagnosable in the UI.
  const template = resolveRendererMessage(messageCatalog, locale, DEFAULT_APP_LOCALE, key) ?? key;
  if (template === key) reportMissingMessage(locale, key);
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

function reportMissingMessage(locale: AppLocale, key: string): void {
  const diagnosticKey = `${locale}\u0000${key}`;
  if (reportedMissingMessages.has(diagnosticKey)) return;
  reportedMissingMessages.add(diagnosticKey);
  console.warn(`[renderer-i18n] Missing message "${key}" for locale "${locale}".`);
}
