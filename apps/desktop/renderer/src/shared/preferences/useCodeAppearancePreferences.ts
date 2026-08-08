import { useCallback, useEffect, useState } from 'react';
import { readBrowserStorageValue, writeBrowserStorageValue } from './browserStorage.js';
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

type CodeThemeOptionConfig = {
  label: string;
  value: string;
  themes: { dark: string; light: string };
};

/** Only expose theme families with intentional light and dark variants. */
export const codeThemeOptions = [
  { label: 'Pierre', value: 'pierre', themes: { dark: 'pierre-dark', light: 'pierre-light' } },
  { label: 'GitHub', value: 'github', themes: { dark: 'github-dark', light: 'github-light' } },
  { label: 'One', value: 'one', themes: { dark: 'one-dark-pro', light: 'one-light' } },
  { label: 'Catppuccin', value: 'catppuccin', themes: { dark: 'catppuccin-mocha', light: 'catppuccin-latte' } },
  { label: 'Solarized', value: 'solarized', themes: { dark: 'solarized-dark', light: 'solarized-light' } },
  { label: 'VS Code', value: 'vscode', themes: { dark: 'dark-plus', light: 'light-plus' } },
  { label: 'Material', value: 'material', themes: { dark: 'material-theme', light: 'material-theme-lighter' } },
] as const satisfies readonly CodeThemeOptionConfig[];

export type CodeFontFamilyMode = typeof codeFontFamilyOptions[number]['value'];
export type CodeFontFamilyOption = typeof codeFontFamilyOptions[number];
export type CodeTheme = typeof codeThemeOptions[number]['value'];
export type CodeThemeOption = typeof codeThemeOptions[number];

const codeFontFamilyStorageKey = 'setsuna-code-font-family';
const codeThemeStorageKey = 'setsuna-code-theme:v1';
const legacyCodeThemeStorageKey = 'setsuna-code-highlight-theme';
const legacyCodeThemes: Readonly<Record<string, CodeTheme>> = {
  chatgpt: 'pierre',
  chatgptLight: 'pierre',
  github: 'github',
  one: 'one',
  oneLight: 'one',
  oneDark: 'one',
  catppuccin: 'catppuccin',
  catppuccinMocha: 'catppuccin',
  solarized: 'solarized',
  solarizedLight: 'solarized',
  solarizedDark: 'solarized',
};
export const CODE_APPEARANCE_CHANGE_EVENT_NAME = 'setsuna-code-appearance-change';

export function useCodeAppearancePreferences() {
  const [codeFontFamily, setCodeFontFamilyState] = useState<CodeFontFamilyMode>(() => getInitialCodeFontFamily());
  const [codeTheme, setCodeThemeState] = useState<CodeTheme>(() => getInitialCodeTheme());

  useEffect(() => {
    applyCodeAppearance(codeFontFamily, codeTheme);
  }, [codeFontFamily, codeTheme]);

  useEffect(() => {
    const handleCodeAppearanceChange = () => {
      setCodeFontFamilyState(getInitialCodeFontFamily());
      setCodeThemeState(getInitialCodeTheme());
    };
    window.addEventListener(CODE_APPEARANCE_CHANGE_EVENT_NAME, handleCodeAppearanceChange);
    window.addEventListener('storage', handleCodeAppearanceChange);
    return () => {
      window.removeEventListener(CODE_APPEARANCE_CHANGE_EVENT_NAME, handleCodeAppearanceChange);
      window.removeEventListener('storage', handleCodeAppearanceChange);
    };
  }, []);

  const setCodeFontFamily = useCallback((nextCodeFontFamily: CodeFontFamilyMode) => {
    writeStoredPreference(codeFontFamilyStorageKey, nextCodeFontFamily);
    setCodeFontFamilyState(nextCodeFontFamily);
    applyCodeAppearance(nextCodeFontFamily, getInitialCodeTheme());
    window.dispatchEvent(new CustomEvent(CODE_APPEARANCE_CHANGE_EVENT_NAME));
  }, []);

  const setCodeTheme = useCallback((nextCodeTheme: CodeTheme) => {
    writeStoredPreference(codeThemeStorageKey, nextCodeTheme);
    setCodeThemeState(nextCodeTheme);
    applyCodeAppearance(getInitialCodeFontFamily(), nextCodeTheme);
    window.dispatchEvent(new CustomEvent(CODE_APPEARANCE_CHANGE_EVENT_NAME));
  }, []);

  return { codeFontFamily, codeTheme, setCodeFontFamily, setCodeTheme };
}

export function initializeCodeAppearancePreference(): void {
  applyCodeAppearance(getInitialCodeFontFamily(), getInitialCodeTheme());
}

function getInitialCodeFontFamily(): CodeFontFamilyMode {
  const saved = readStoredPreference(codeFontFamilyStorageKey);
  return codeFontFamilyOptions.some((item) => item.value === saved) ? (saved as CodeFontFamilyMode) : 'system';
}

function getInitialCodeTheme(): CodeTheme {
  const saved = readStoredPreference(codeThemeStorageKey);
  if (codeThemeOptions.some((item) => item.value === saved)) return saved as CodeTheme;
  const legacy = readStoredPreference(legacyCodeThemeStorageKey);
  return legacy && legacyCodeThemes[legacy] ? legacyCodeThemes[legacy] : 'pierre';
}

function applyCodeAppearance(codeFontFamily: CodeFontFamilyMode, codeTheme: CodeTheme): void {
  const font = codeFontFamilyOptions.find((item) => item.value === codeFontFamily) ?? codeFontFamilyOptions[0];
  document.documentElement.dataset.codeFontFamily = codeFontFamily;
  document.documentElement.dataset.codeTheme = codeTheme;
  document.documentElement.style.setProperty('--app-code-font-family', font.css);
}

function readStoredPreference(key: string): string | null {
  return readBrowserStorageValue(key);
}

function writeStoredPreference(key: string, value: string): void {
  writeBrowserStorageValue(key, value);
}

export function getCodeFontFamilyOptionsForPlatform(platform: FontPlatform = getFontPlatform()): CodeFontFamilyOption[] {
  return codeFontFamilyOptions.filter((item) => {
    const platforms = item.platforms as readonly CodeFontPlatformScope[];
    return platforms.includes('all') || platforms.includes(platform);
  });
}
