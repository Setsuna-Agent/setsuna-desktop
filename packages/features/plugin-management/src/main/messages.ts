import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';

const localBundleDialogTitles: Record<RuntimeInterfaceLanguage, string> = Object.freeze({
  'en-US': 'Choose local plugin folder',
  'zh-CN': '选择本地插件目录',
});

export function localPluginBundleDialogTitle(language: RuntimeInterfaceLanguage): string {
  return localBundleDialogTitles[language];
}
