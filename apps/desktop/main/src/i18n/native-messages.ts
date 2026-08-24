import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';

const zhCNMessages = {
  'plugins.installLocal.title': '选择本地插件目录',
  'tray.open': '打开 Setsuna Desktop',
  'tray.quit': '退出',
} as const;

export type NativeMessageKey = keyof typeof zhCNMessages;
export type NativeTranslate = (key: NativeMessageKey, params?: Record<string, string | number>) => string;

const enUSMessages: Record<NativeMessageKey, string> = {
  'plugins.installLocal.title': 'Choose local plugin folder',
  'tray.open': 'Open Setsuna Desktop',
  'tray.quit': 'Exit',
};

const nativeMessages: Record<RuntimeInterfaceLanguage, Record<NativeMessageKey, string>> = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages,
};

export function normalizeNativeInterfaceLanguage(value: unknown): RuntimeInterfaceLanguage | null {
  return value === 'zh-CN' || value === 'en-US' ? value : null;
}

export function createNativeTranslate(locale: RuntimeInterfaceLanguage): NativeTranslate {
  return (key, params) => {
    const template = nativeMessages[locale][key];
    if (!params) return template;
    return template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match));
  };
}
