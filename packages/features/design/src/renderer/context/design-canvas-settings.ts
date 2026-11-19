import { useEffect, useState } from 'react';

export const defaultDesignCanvasSettings = { showPixelGrid: false, snapToPixelGrid: false, snapToObjects: true } as const;
export type DesignCanvasSettings = { readonly [Key in keyof typeof defaultDesignCanvasSettings]: boolean };
export type DesignCanvasSetting = keyof DesignCanvasSettings;

const key = 'setsuna.design.canvas-settings';

export function useDesignCanvasSettings() {
  const [settings, setSettings] = useState<DesignCanvasSettings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<DesignCanvasSettings> | null;
      return {
        showPixelGrid: saved?.showPixelGrid === true,
        snapToPixelGrid: saved?.snapToPixelGrid === true,
        snapToObjects: saved?.snapToObjects !== false,
      };
    } catch { return defaultDesignCanvasSettings; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Keep the in-session preference. */ }
  }, [settings]);
  return { settings, toggleSetting: (setting: DesignCanvasSetting) => {
    setSettings((current) => ({ ...current, [setting]: !current[setting] }));
  } };
}
