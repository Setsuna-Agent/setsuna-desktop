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
  { label: 'GitHub', value: 'github' },
  { label: 'One Dark', value: 'oneDark' },
  { label: 'Monokai', value: 'monokai' },
] as const;

export type CodeFontFamilyMode = typeof codeFontFamilyOptions[number]['value'];
export type CodeFontFamilyOption = typeof codeFontFamilyOptions[number];
export type CodeHighlightTheme = typeof codeHighlightThemeOptions[number]['value'];

const codeFontFamilyStorageKey = 'setsuna-code-font-family';
const codeHighlightThemeStorageKey = 'setsuna-code-highlight-theme';
export const CODE_APPEARANCE_CHANGE_EVENT_NAME = 'setsuna-code-appearance-change';

export function useCodeAppearancePreferences() {
  const [codeFontFamily, setCodeFontFamilyState] = useState<CodeFontFamilyMode>(() => getInitialCodeFontFamily());
  const [codeHighlightTheme, setCodeHighlightThemeState] = useState<CodeHighlightTheme>(() => getInitialCodeHighlightTheme());

  useEffect(() => {
    applyCodeAppearance(codeFontFamily, codeHighlightTheme);
  }, [codeFontFamily, codeHighlightTheme]);

  useEffect(() => {
    const handleCodeAppearanceChange = () => {
      setCodeFontFamilyState(getInitialCodeFontFamily());
      setCodeHighlightThemeState(getInitialCodeHighlightTheme());
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
    applyCodeAppearance(nextCodeFontFamily, getInitialCodeHighlightTheme());
    window.dispatchEvent(new CustomEvent(CODE_APPEARANCE_CHANGE_EVENT_NAME));
  }, []);

  const setCodeHighlightTheme = useCallback((nextCodeHighlightTheme: CodeHighlightTheme) => {
    window.localStorage.setItem(codeHighlightThemeStorageKey, nextCodeHighlightTheme);
    setCodeHighlightThemeState(nextCodeHighlightTheme);
    applyCodeAppearance(getInitialCodeFontFamily(), nextCodeHighlightTheme);
    window.dispatchEvent(new CustomEvent(CODE_APPEARANCE_CHANGE_EVENT_NAME));
  }, []);

  return { codeFontFamily, codeHighlightTheme, setCodeFontFamily, setCodeHighlightTheme };
}

export function initializeCodeAppearancePreference(): void {
  applyCodeAppearance(getInitialCodeFontFamily(), getInitialCodeHighlightTheme());
}

function getInitialCodeFontFamily(): CodeFontFamilyMode {
  const saved = window.localStorage.getItem(codeFontFamilyStorageKey);
  return codeFontFamilyOptions.some((item) => item.value === saved) ? (saved as CodeFontFamilyMode) : 'system';
}

function getInitialCodeHighlightTheme(): CodeHighlightTheme {
  const saved = window.localStorage.getItem(codeHighlightThemeStorageKey);
  return codeHighlightThemeOptions.some((item) => item.value === saved) ? (saved as CodeHighlightTheme) : 'github';
}

function applyCodeAppearance(codeFontFamily: CodeFontFamilyMode, codeHighlightTheme: CodeHighlightTheme): void {
  const font = codeFontFamilyOptions.find((item) => item.value === codeFontFamily) ?? codeFontFamilyOptions[0];
  document.documentElement.dataset.codeFontFamily = codeFontFamily;
  document.documentElement.dataset.codeHighlightTheme = codeHighlightTheme;
  document.documentElement.style.setProperty('--app-code-font-family', font.css);
}

export function getCodeFontFamilyOptionsForPlatform(platform: FontPlatform = getFontPlatform()): CodeFontFamilyOption[] {
  return codeFontFamilyOptions.filter((item) => {
    const platforms = item.platforms as readonly CodeFontPlatformScope[];
    return platforms.includes('all') || platforms.includes(platform);
  });
}
