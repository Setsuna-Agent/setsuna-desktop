import { useCallback, useEffect, useState } from 'react';

export const accentColorOptions = [
  { value: 'neutral', label: '默认', lightSwatch: '#15171a', darkSwatch: '#f4f4f5' },
  { value: 'blue', label: '蓝色', lightSwatch: '#2563eb', darkSwatch: '#60a5fa' },
  { value: 'purple', label: '紫色', lightSwatch: '#7c3aed', darkSwatch: '#c084fc' },
  { value: 'green', label: '绿色', lightSwatch: '#15803d', darkSwatch: '#4ade80' },
  { value: 'orange', label: '橙色', lightSwatch: '#c2410c', darkSwatch: '#fb923c' },
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
    window.localStorage.setItem(accentColorStorageKey, nextAccentColor);
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
  const saved = window.localStorage.getItem(accentColorStorageKey);
  return accentColorOptions.some((option) => option.value === saved) ? saved as AccentColor : 'neutral';
}

function applyAccentColor(accentColor: AccentColor): void {
  document.documentElement.dataset.accentColor = accentColor;
}
