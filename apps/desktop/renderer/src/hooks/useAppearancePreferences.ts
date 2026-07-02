import { useCallback, useEffect, useState } from 'react';

export const fontSizeOptions = ['80', '85', '90', '95', '100', '105', '110', '115', '120'] as const;
export type FontSizeMode = typeof fontSizeOptions[number];

export type FontPlatform = 'mac' | 'windows' | 'linux';
type FontPlatformScope = FontPlatform | 'all';
type FontFamilyOptionConfig = {
  label: string;
  value: string;
  css: string;
  platforms: readonly FontPlatformScope[];
};

export const fontFamilyOptions = [
  {
    label: 'System Default',
    value: 'system',
    css: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif',
    platforms: ['all'],
  },
  {
    label: 'Geist Sans',
    value: 'geist',
    css: 'Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    platforms: ['all'],
  },
  {
    label: 'Helvetica Neue',
    value: 'helveticaNeue',
    css: '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", sans-serif',
    platforms: ['mac'],
  },
  {
    label: 'Helvetica',
    value: 'helvetica',
    css: 'Helvetica, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", sans-serif',
    platforms: ['mac'],
  },
  {
    label: 'Arial',
    value: 'arial',
    css: 'Arial, "Helvetica Neue", Helvetica, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
    platforms: ['all'],
  },
  {
    label: 'Arial Narrow',
    value: 'arialNarrow',
    css: '"Arial Narrow", Arial, "Helvetica Neue", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
    platforms: ['all'],
  },
  {
    label: 'Arial Black',
    value: 'arialBlack',
    css: '"Arial Black", Arial, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
    platforms: ['all'],
  },
  {
    label: 'Arial Rounded MT Bold',
    value: 'arialRounded',
    css: '"Arial Rounded MT Bold", Arial, "PingFang SC", "Hiragino Sans GB", sans-serif',
    platforms: ['mac'],
  },
  {
    label: 'Arial Unicode MS',
    value: 'arialUnicode',
    css: '"Arial Unicode MS", Arial, "PingFang SC", "Hiragino Sans GB", sans-serif',
    platforms: ['mac'],
  },
  {
    label: 'Segoe UI Variable',
    value: 'segoeUiVariable',
    css: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Segoe UI',
    value: 'segoeUi',
    css: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Microsoft YaHei UI',
    value: 'microsoftYaheiUi',
    css: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Microsoft YaHei',
    value: 'microsoftYahei',
    css: '"Microsoft YaHei", "Microsoft YaHei UI", "Segoe UI", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Microsoft JhengHei UI',
    value: 'microsoftJhengheiUi',
    css: '"Microsoft JhengHei UI", "Microsoft JhengHei", "Segoe UI", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Microsoft JhengHei',
    value: 'microsoftJhenghei',
    css: '"Microsoft JhengHei", "Microsoft JhengHei UI", "Segoe UI", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'SimSun',
    value: 'simSun',
    css: 'SimSun, NSimSun, "Microsoft YaHei UI", "Microsoft YaHei", serif',
    platforms: ['windows'],
  },
  {
    label: 'SimHei',
    value: 'simHei',
    css: 'SimHei, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Consolas',
    value: 'consolas',
    css: 'Consolas, "Courier New", "Microsoft YaHei UI", monospace',
    platforms: ['windows'],
  },
  {
    label: 'Courier New',
    value: 'courierNew',
    css: '"Courier New", Consolas, Menlo, Monaco, monospace',
    platforms: ['all'],
  },
  {
    label: 'Calibri',
    value: 'calibri',
    css: 'Calibri, "Segoe UI", "Microsoft YaHei UI", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Cambria',
    value: 'cambria',
    css: 'Cambria, Georgia, "Times New Roman", serif',
    platforms: ['windows'],
  },
  {
    label: 'Candara',
    value: 'candara',
    css: 'Candara, Calibri, "Segoe UI", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Trebuchet MS',
    value: 'trebuchetMs',
    css: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Georgia',
    value: 'georgia',
    css: 'Georgia, "Times New Roman", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", serif',
    platforms: ['all'],
  },
  {
    label: 'Times New Roman',
    value: 'timesNewRoman',
    css: '"Times New Roman", Times, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", serif',
    platforms: ['all'],
  },
  {
    label: 'Menlo',
    value: 'menlo',
    css: 'Menlo, Monaco, "SF Mono", "PingFang SC", "Hiragino Sans GB", monospace',
    platforms: ['mac'],
  },
  {
    label: 'Monaco',
    value: 'monaco',
    css: 'Monaco, Menlo, "SF Mono", "PingFang SC", "Hiragino Sans GB", monospace',
    platforms: ['mac'],
  },
  {
    label: 'Microsoft Sans Serif',
    value: 'microsoftSansSerif',
    css: '"Microsoft Sans Serif", "Segoe UI", Arial, sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Verdana',
    value: 'verdana',
    css: 'Verdana, Geneva, "Segoe UI", "Microsoft YaHei UI", sans-serif',
    platforms: ['all'],
  },
  {
    label: 'Tahoma',
    value: 'tahoma',
    css: 'Tahoma, Geneva, "Segoe UI", "Microsoft YaHei UI", sans-serif',
    platforms: ['windows'],
  },
  {
    label: 'Ubuntu',
    value: 'ubuntu',
    css: 'Ubuntu, "Noto Sans SC", "Source Han Sans SC", sans-serif',
    platforms: ['linux'],
  },
  {
    label: 'Cantarell',
    value: 'cantarell',
    css: 'Cantarell, "Noto Sans SC", "Source Han Sans SC", sans-serif',
    platforms: ['linux'],
  },
  {
    label: 'Noto Sans SC',
    value: 'notoSansSc',
    css: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", sans-serif',
    platforms: ['linux'],
  },
  {
    label: 'Source Han Sans SC',
    value: 'sourceHanSansSc',
    css: '"Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei UI", sans-serif',
    platforms: ['linux'],
  },
  {
    label: 'WenQuanYi Micro Hei',
    value: 'wenquanyiMicroHei',
    css: '"WenQuanYi Micro Hei", "Noto Sans SC", "Source Han Sans SC", sans-serif',
    platforms: ['linux'],
  },
  {
    label: 'Serif',
    value: 'serif',
    css: 'serif',
    platforms: ['all'],
  },
] as const satisfies readonly FontFamilyOptionConfig[];

export type FontFamilyMode = typeof fontFamilyOptions[number]['value'];
export type FontFamilyOption = typeof fontFamilyOptions[number];

const fontSizeStorageKey = 'setusna-font-size';
const fontFamilyStorageKey = 'setusna-font-family';
const appearanceChangeEventName = 'setsuna-appearance-change';

const legacyFontSizeMap: Record<string, FontSizeMode> = {
  small: '90',
  medium: '100',
  large: '110',
  xlarge: '115',
};

const legacyFontFamilyMap: Partial<Record<string, FontFamilyMode>> = {
  apple: 'system',
  arialRoundedMtBold: 'arialRounded',
  hiraginoSansGb: 'system',
  inter: 'helveticaNeue',
  mono: 'courierNew',
  pingFangSc: 'system',
  roboto: 'helveticaNeue',
  sfProDisplay: 'system',
  sfProText: 'system',
  sourceHan: 'sourceHanSansSc',
};

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
  if (fontSizeOptions.includes(saved as FontSizeMode)) return saved as FontSizeMode;
  return saved ? legacyFontSizeMap[saved] ?? '100' : '100';
}

function getInitialFontFamily(): FontFamilyMode {
  const saved = window.localStorage.getItem(fontFamilyStorageKey);
  if (fontFamilyOptions.some((item) => item.value === saved)) return saved as FontFamilyMode;
  return saved ? legacyFontFamilyMap[saved] ?? 'system' : 'system';
}

function applyAppearance(fontSize: FontSizeMode, fontFamily: FontFamilyMode): void {
  const font = fontFamilyOptions.find((item) => item.value === fontFamily) ?? fontFamilyOptions[0];
  document.documentElement.dataset.fontSize = fontSize;
  document.documentElement.dataset.fontFamily = fontFamily;
  document.documentElement.style.removeProperty('--app-font-size');
  document.documentElement.style.setProperty('--app-font-family', font.css);
  syncNativeTitlebarScale(Number(fontSize) / 100);
}

function syncNativeTitlebarScale(pageScale: number): void {
  if (typeof window === 'undefined') return;
  const bridge = window.setsunaDesktop;
  if (!bridge || bridge.desktop.platform !== 'darwin') return;
  // Native macOS traffic lights do not participate in CSS zoom, so main keeps them aligned with the scaled titlebar.
  void bridge.windowControls.setTitlebarScale(pageScale).catch(() => undefined);
}

export function getFontPlatform(): FontPlatform {
  if (typeof navigator === 'undefined') return 'mac';
  const platformText = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (platformText.includes('win')) return 'windows';
  if (platformText.includes('linux') || platformText.includes('x11')) return 'linux';
  return 'mac';
}

export function getFontFamilyOptionsForPlatform(platform: FontPlatform = getFontPlatform()): FontFamilyOption[] {
  return fontFamilyOptions.filter((item) => {
    const platforms = item.platforms as readonly FontPlatformScope[];
    return platforms.includes('all') || platforms.includes(platform);
  });
}
