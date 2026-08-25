import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { createContext, useContext, type ReactNode } from 'react';

type ConversationDebugI18n = Readonly<{
  locale: string;
  t: RendererTranslate;
}>;

const ConversationDebugI18nContext = createContext<ConversationDebugI18n | null>(null);

export function ConversationDebugI18nProvider({
  children,
  locale,
  translate,
}: Readonly<{
  children: ReactNode;
  locale: string;
  translate: RendererTranslate;
}>) {
  return (
    <ConversationDebugI18nContext.Provider value={{ locale, t: translate }}>
      {children}
    </ConversationDebugI18nContext.Provider>
  );
}

export function useConversationDebugI18n(): ConversationDebugI18n {
  const value = useContext(ConversationDebugI18nContext);
  if (!value) throw new Error('ConversationDebugI18nProvider is missing.');
  return value;
}
