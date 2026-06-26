import { useCallback, useEffect, useState } from 'react';

export const fontSizeOptions = ['80', '85', '90', '95', '100', '105', '110', '115', '120'] as const;
export type FontSizeMode = typeof fontSizeOptions[number];

export type FontFamilyMode = 'system' | 'geist' | 'serif' | 'mono';

export const fontFamilyOptions: Array<{ label: string; value: FontFamilyMode; css: string }> = [
  {
    label: 'System Default',
    value: 'system',
    css: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif',
  },
  {
    label: 'Geist Sans',
    value: 'geist',
    css: 'Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    label: 'Serif',
    value: 'serif',
    css: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, "Songti SC", serif',
  },
  {
    label: 'Mono',
    value: 'mono',
    css: 'var(--app-code-font-family)',
  },
];

const fontSizeStorageKey = 'setusna-font-size';
const fontFamilyStorageKey = 'setusna-font-family';
const appearanceChangeEventName = 'setsuna-appearance-change';

export function useAppearancePreferences() {
  const [fontSize, setFontSizeState] = useState<FontSizeMode>(() => getInitialFontSize());
  const [fontFamily, setFontFamilyState] = useState<FontFamilyMode>(() => getInitialFontFamily());

  useEffect(() => {
    applyAppearance(fontSize, fontFamily);
  }, [fontFamily, fontSize]);

  useEffect(() => {
    const handleAppearanceChange = () => {
      setFontSizeState(getInitialFontSize());
      setFontFamilyState(getInitialFontFamily());
    };
    window.addEventListener(appearanceChangeEventName, handleAppearanceChange);
    window.addEventListener('storage', handleAppearanceChange);
    return () => {
      window.removeEventListener(appearanceChangeEventName, handleAppearanceChange);
      window.removeEventListener('storage', handleAppearanceChange);
    };
  }, []);

  const setFontSize = useCallback((nextFontSize: FontSizeMode) => {
    window.localStorage.setItem(fontSizeStorageKey, nextFontSize);
    setFontSizeState(nextFontSize);
    applyAppearance(nextFontSize, getInitialFontFamily());
    window.dispatchEvent(new CustomEvent(appearanceChangeEventName));
  }, []);

  const setFontFamily = useCallback((nextFontFamily: FontFamilyMode) => {
    window.localStorage.setItem(fontFamilyStorageKey, nextFontFamily);
    setFontFamilyState(nextFontFamily);
    applyAppearance(getInitialFontSize(), nextFontFamily);
    window.dispatchEvent(new CustomEvent(appearanceChangeEventName));
  }, []);

  return { fontFamily, fontSize, setFontFamily, setFontSize };
}

function getInitialFontSize(): FontSizeMode {
  const saved = window.localStorage.getItem(fontSizeStorageKey);
  return fontSizeOptions.includes(saved as FontSizeMode) ? (saved as FontSizeMode) : '100';
}

function getInitialFontFamily(): FontFamilyMode {
  const saved = window.localStorage.getItem(fontFamilyStorageKey);
  return fontFamilyOptions.some((item) => item.value === saved) ? (saved as FontFamilyMode) : 'system';
}

function applyAppearance(fontSize: FontSizeMode, fontFamily: FontFamilyMode): void {
  const fontScale = Number(fontSize) / 100;
  const font = fontFamilyOptions.find((item) => item.value === fontFamily) ?? fontFamilyOptions[0];
  document.documentElement.dataset.fontSize = fontSize;
  document.documentElement.dataset.fontFamily = fontFamily;
  document.documentElement.style.setProperty('--app-font-size', `${14 * fontScale}px`);
  document.documentElement.style.setProperty('--app-font-family', font.css);
}
