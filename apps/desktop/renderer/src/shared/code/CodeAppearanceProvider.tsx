import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import {
  codeFontFamilyOptions,
  codeThemeOptions,
  useCodeAppearancePreferences,
  type CodeFontFamilyMode,
  type CodeTheme,
} from '../preferences/useCodeAppearancePreferences.js';
import {
  useResolvedThemeMode,
  type ResolvedThemeMode,
} from '../preferences/useThemeTransition.js';

type CodeAppearanceContextValue = {
  codeFontFamily: CodeFontFamilyMode;
  codeTheme: CodeTheme;
  fontFamily: string;
  resolvedTheme: ResolvedThemeMode;
  setCodeFontFamily: (font: CodeFontFamilyMode) => void;
  setCodeTheme: (theme: CodeTheme) => void;
  themes: Readonly<{ dark: string; light: string }>;
};

const defaultTheme = codeThemeOptions[0];
const defaultFont = codeFontFamilyOptions[0];
const fallbackValue: CodeAppearanceContextValue = {
  codeFontFamily: defaultFont.value,
  codeTheme: defaultTheme.value,
  fontFamily: defaultFont.css,
  resolvedTheme: 'light',
  setCodeFontFamily: () => undefined,
  setCodeTheme: () => undefined,
  themes: defaultTheme.themes,
};
const CodeAppearanceContext = createContext<CodeAppearanceContextValue | null>(null);

export function CodeAppearanceProvider({ children }: PropsWithChildren) {
  const preferences = useCodeAppearancePreferences();
  const resolvedTheme = useResolvedThemeMode();
  const font = codeFontFamilyOptions.find((option) => option.value === preferences.codeFontFamily) ?? defaultFont;
  const theme = codeThemeOptions.find((option) => option.value === preferences.codeTheme) ?? defaultTheme;
  const value = useMemo<CodeAppearanceContextValue>(() => ({
    codeFontFamily: preferences.codeFontFamily,
    codeTheme: preferences.codeTheme,
    fontFamily: font.css,
    resolvedTheme,
    setCodeFontFamily: preferences.setCodeFontFamily,
    setCodeTheme: preferences.setCodeTheme,
    themes: theme.themes,
  }), [
    font.css,
    preferences.codeFontFamily,
    preferences.codeTheme,
    preferences.setCodeFontFamily,
    preferences.setCodeTheme,
    resolvedTheme,
    theme.themes,
  ]);

  return <CodeAppearanceContext.Provider value={value}>{children}</CodeAppearanceContext.Provider>;
}

export function useCodeAppearance(): CodeAppearanceContextValue {
  return useContext(CodeAppearanceContext) ?? fallbackValue;
}
