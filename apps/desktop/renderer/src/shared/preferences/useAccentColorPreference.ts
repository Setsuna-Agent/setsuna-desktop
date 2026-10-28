import { useCallback, useEffect, useState } from 'react';
import { readBrowserStorageValue, writeBrowserStorageValue } from './browserStorage.js';

export const accentColorOptions = [
  { value: 'neutral', label: '默认', lightSwatch: '#242424', darkSwatch: '#f4f4f5' },
  { value: 'blue', label: '蓝色', lightSwatch: '#1677ff', darkSwatch: '#60a5fa' },
  { value: 'purple', label: '紫色', lightSwatch: '#8b3dff', darkSwatch: '#c084fc' },
  { value: 'pink', label: '玫红', lightSwatch: '#ff268d', darkSwatch: '#ff4d9d' },
  { value: 'red', label: '红色', lightSwatch: '#ff3b30', darkSwatch: '#ff4d4f' },
  { value: 'orange', label: '橙色', lightSwatch: '#ff7a00', darkSwatch: 'var(--app-orange)' },
  { value: 'amber', label: '琥珀', lightSwatch: '#ffb800', darkSwatch: '#ffc400' },
  { value: 'green', label: '绿色', lightSwatch: '#00c853', darkSwatch: 'var(--app-green)' },
  { value: 'teal', label: '青绿', lightSwatch: '#00bea3', darkSwatch: '#00c2a8' },
  { value: 'cyan', label: '青蓝', lightSwatch: '#00b5f5', darkSwatch: '#00b8e6' },
] as const;

export type AccentColor = typeof accentColorOptions[number]['value'];

const accentColorStorageKey = 'setsuna-accent-color';
const accentColorChangeEventName = 'setsuna-accent-color-change';

export function useAccentColorPreference() {
  const [accentColor, setAccentColorState] = useState<AccentColor>(() => getInitialAccentColor());

  useEffect(() => {
    applyAccentColor(accentColor);
  }, [accentColor]);

  useEffect(() => {
    const handleAccentColorChange = () => setAccentColorState(getInitialAccentColor());
    window.addEventListener(accentColorChangeEventName, handleAccentColorChange);
    window.addEventListener('storage', handleAccentColorChange);
    return () => {
      window.removeEventListener(accentColorChangeEventName, handleAccentColorChange);
      window.removeEventListener('storage', handleAccentColorChange);
    };
  }, []);

  const setAccentColor = useCallback((nextAccentColor: AccentColor) => {
    writeBrowserStorageValue(accentColorStorageKey, nextAccentColor);
    setAccentColorState(nextAccentColor);
    applyAccentColor(nextAccentColor);
    window.dispatchEvent(new CustomEvent(accentColorChangeEventName));
  }, []);

  return { accentColor, setAccentColor };
}

export function initializeAccentColorPreference(): void {
  applyAccentColor(getInitialAccentColor());
}

function getInitialAccentColor(): AccentColor {
  const saved = readBrowserStorageValue(accentColorStorageKey);
  return accentColorOptions.some((option) => option.value === saved) ? saved as AccentColor : 'neutral';
}

function applyAccentColor(accentColor: AccentColor): void {
  document.documentElement.dataset.accentColor = accentColor;
}
