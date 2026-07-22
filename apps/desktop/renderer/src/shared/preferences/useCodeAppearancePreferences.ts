import { useCallback, useEffect, useState } from 'react';
import { getFontPlatform, type FontPlatform } from './useAppearancePreferences.js';

type CodeFontPlatformScope = FontPlatform | 'all';
type CodeFontFamilyOptionConfig = {
  label: string;
  value: string;
  css: string;
  platforms: readonly CodeFontPlatformScope[];
};

export const codeFontFamilyOptions = [
  {
    label: 'System Mono',
    value: 'system',
    css: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    platforms: ['all'],
  },
  {
    label: 'Geist Mono',
    value: 'geistMono',
    css: '"Geist Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    platforms: ['all'],
  },
  {
    label: 'SF Mono',
    value: 'sfMono',
    css: '"SF Mono", "SFMono-Regular", Menlo, Monaco, monospace',
    platforms: ['mac'],
  },
  {
    label: 'Menlo',
    value: 'menlo',
    css: 'Menlo, Monaco, "SF Mono", monospace',
    platforms: ['mac'],
  },
  {
    label: 'Monaco',
    value: 'monaco',
    css: 'Monaco, Menlo, "SF Mono", monospace',
    platforms: ['mac'],
  },
  {
    label: 'Cascadia Code',
    value: 'cascadiaCode',
    css: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    platforms: ['windows'],
  },
  {
    label: 'Consolas',
    value: 'consolas',
    css: 'Consolas, "Cascadia Mono", "Courier New", monospace',
    platforms: ['windows'],
  },
  {
    label: 'Liberation Mono',
    value: 'liberationMono',
    css: '"Liberation Mono", "DejaVu Sans Mono", monospace',
    platforms: ['linux'],
  },
  {
    label: 'DejaVu Sans Mono',
    value: 'dejavuSansMono',
    css: '"DejaVu Sans Mono", "Liberation Mono", monospace',
    platforms: ['linux'],
  },
  {
    label: 'JetBrains Mono',
    value: 'jetbrainsMono',
    css: '"JetBrains Mono", "Geist Mono", "SFMono-Regular", Consolas, monospace',
    platforms: ['all'],
  },
  {
    label: 'Fira Code',
    value: 'firaCode',
    css: '"Fira Code", "Geist Mono", "SFMono-Regular", Consolas, monospace',
    platforms: ['all'],
  },
  {
    label: 'Source Code Pro',
    value: 'sourceCodePro',
    css: '"Source Code Pro", "Geist Mono", "SFMono-Regular", Consolas, monospace',
    platforms: ['all'],
  },
  {
    label: 'Courier New',
    value: 'courierNew',
    css: '"Courier New", Courier, monospace',
    platforms: ['all'],
  },
] as const satisfies readonly CodeFontFamilyOptionConfig[];

export const codeHighlightThemeOptions = [
  { label: 'ChatGPT（推荐）', value: 'chatgpt' },
  { label: 'One', value: 'one' },
  { label: 'GitHub', value: 'github' },
  { label: 'Monokai', value: 'monokai' },
  { label: 'Dracula', value: 'dracula' },
  { label: 'Nord', value: 'nord' },
  { label: 'Tokyo Night', value: 'tokyoNight' },
  { label: 'Catppuccin', value: 'catppuccin' },
  { label: 'Solarized', value: 'solarized' },
] as const;

export const codeColorSchemeOptions = [
  { label: '跟随高亮主题（默认）', value: 'theme' },
  { label: 'One', value: 'one' },
  { label: 'VS Code', value: 'vscode' },
  { label: 'GitHub', value: 'github' },
  { label: 'Material', value: 'material' },
  { label: 'Monokai', value: 'monokai' },
  { label: 'Dracula', value: 'dracula' },
  { label: 'Nord', value: 'nord' },
  { label: 'Tokyo Night', value: 'tokyoNight' },
  { label: 'Catppuccin', value: 'catppuccin' },
  { label: 'Solarized', value: 'solarized' },
] as const;

export type CodeFontFamilyMode = typeof codeFontFamilyOptions[number]['value'];
export type CodeFontFamilyOption = typeof codeFontFamilyOptions[number];
export type CodeHighlightTheme = typeof codeHighlightThemeOptions[number]['value'];
export type CodeColorScheme = typeof codeColorSchemeOptions[number]['value'];

const codeFontFamilyStorageKey = 'setsuna-code-font-family';
const codeHighlightThemeStorageKey = 'setsuna-code-highlight-theme';
const codeColorSchemeStorageKey = 'setsuna-code-color-scheme';
const legacyCodeHighlightThemes: Readonly<Record<string, CodeHighlightTheme>> = {
  chatgptLight: 'chatgpt',
  oneLight: 'one',
  oneDark: 'one',
  catppuccinMocha: 'catppuccin',
  solarizedLight: 'solarized',
  solarizedDark: 'solarized',
};
export const CODE_APPEARANCE_CHANGE_EVENT_NAME = 'setsuna-code-appearance-change';

export function useCodeAppearancePreferences() {
  const [codeFontFamily, setCodeFontFamilyState] = useState<CodeFontFamilyMode>(() => getInitialCodeFontFamily());
  const [codeHighlightTheme, setCodeHighlightThemeState] = useState<CodeHighlightTheme>(() => getInitialCodeHighlightTheme());
  const [codeColorScheme, setCodeColorSchemeState] = useState<CodeColorScheme>(() => getInitialCodeColorScheme());

  useEffect(() => {
    applyCodeAppearance(codeFontFamily, codeHighlightTheme, codeColorScheme);
  }, [codeColorScheme, codeFontFamily, codeHighlightTheme]);

  useEffect(() => {
    const handleCodeAppearanceChange = () => {
      setCodeFontFamilyState(getInitialCodeFontFamily());
      setCodeHighlightThemeState(getInitialCodeHighlightTheme());
      setCodeColorSchemeState(getInitialCodeColorScheme());
    };
    window.addEventListener(CODE_APPEARANCE_CHANGE_EVENT_NAME, handleCodeAppearanceChange);
    window.addEventListener('storage', handleCodeAppearanceChange);
    return () => {
      window.removeEventListener(CODE_APPEARANCE_CHANGE_EVENT_NAME, handleCodeAppearanceChange);
      window.removeEventListener('storage', handleCodeAppearanceChange);
    };
  }, []);

  const setCodeFontFamily = useCallback((nextCodeFontFamily: CodeFontFamilyMode) => {
    window.localStorage.setItem(codeFontFamilyStorageKey, nextCodeFontFamily);
    setCodeFontFamilyState(nextCodeFontFamily);
    applyCodeAppearance(nextCodeFontFamily, getInitialCodeHighlightTheme(), getInitialCodeColorScheme());
    window.dispatchEvent(new CustomEvent(CODE_APPEARANCE_CHANGE_EVENT_NAME));
  }, []);

  const setCodeHighlightTheme = useCallback((nextCodeHighlightTheme: CodeHighlightTheme) => {
    window.localStorage.setItem(codeHighlightThemeStorageKey, nextCodeHighlightTheme);
    setCodeHighlightThemeState(nextCodeHighlightTheme);
    applyCodeAppearance(getInitialCodeFontFamily(), nextCodeHighlightTheme, getInitialCodeColorScheme());
    window.dispatchEvent(new CustomEvent(CODE_APPEARANCE_CHANGE_EVENT_NAME));
  }, []);

  const setCodeColorScheme = useCallback((nextCodeColorScheme: CodeColorScheme) => {
    window.localStorage.setItem(codeColorSchemeStorageKey, nextCodeColorScheme);
    setCodeColorSchemeState(nextCodeColorScheme);
    applyCodeAppearance(getInitialCodeFontFamily(), getInitialCodeHighlightTheme(), nextCodeColorScheme);
    window.dispatchEvent(new CustomEvent(CODE_APPEARANCE_CHANGE_EVENT_NAME));
  }, []);

  return { codeColorScheme, codeFontFamily, codeHighlightTheme, setCodeColorScheme, setCodeFontFamily, setCodeHighlightTheme };
}

export function initializeCodeAppearancePreference(): void {
  applyCodeAppearance(getInitialCodeFontFamily(), getInitialCodeHighlightTheme(), getInitialCodeColorScheme());
}

function getInitialCodeFontFamily(): CodeFontFamilyMode {
  const saved = window.localStorage.getItem(codeFontFamilyStorageKey);
  return codeFontFamilyOptions.some((item) => item.value === saved) ? (saved as CodeFontFamilyMode) : 'system';
}

function getInitialCodeHighlightTheme(): CodeHighlightTheme {
  const saved = window.localStorage.getItem(codeHighlightThemeStorageKey);
  if (saved && legacyCodeHighlightThemes[saved]) return legacyCodeHighlightThemes[saved];
  return codeHighlightThemeOptions.some((item) => item.value === saved) ? (saved as CodeHighlightTheme) : 'chatgpt';
}

function getInitialCodeColorScheme(): CodeColorScheme {
  const saved = window.localStorage.getItem(codeColorSchemeStorageKey);
  return codeColorSchemeOptions.some((item) => item.value === saved) ? (saved as CodeColorScheme) : 'theme';
}

function applyCodeAppearance(codeFontFamily: CodeFontFamilyMode, codeHighlightTheme: CodeHighlightTheme, codeColorScheme: CodeColorScheme): void {
  const font = codeFontFamilyOptions.find((item) => item.value === codeFontFamily) ?? codeFontFamilyOptions[0];
  document.documentElement.dataset.codeFontFamily = codeFontFamily;
  document.documentElement.dataset.codeHighlightTheme = codeHighlightTheme;
  document.documentElement.dataset.codeColorScheme = codeColorScheme;
  document.documentElement.style.setProperty('--app-code-font-family', font.css);
}

export function getCodeFontFamilyOptionsForPlatform(platform: FontPlatform = getFontPlatform()): CodeFontFamilyOption[] {
  return codeFontFamilyOptions.filter((item) => {
    const platforms = item.platforms as readonly CodeFontPlatformScope[];
    return platforms.includes('all') || platforms.includes(platform);
  });
}
