import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';

const zhCNMessages = {
  'browser.openLinkInNewTab': '在新标签页中打开链接',
  'browser.copyLinkAddress': '复制链接地址',
  'browser.openImageInNewTab': '在新标签页中打开图片',
  'browser.copyImage': '复制图片',
  'browser.copyImageAddress': '复制图片地址',
  'browser.downloadImage': '下载图片',
  'browser.undo': '撤销',
  'browser.redo': '重做',
  'browser.cut': '剪切',
  'browser.copy': '复制',
  'browser.paste': '粘贴',
  'browser.delete': '删除',
  'browser.selectAll': '全选',
  'browser.back': '后退',
  'browser.forward': '前进',
  'browser.reload': '重新加载',
  'updater.ready.title': '更新已经准备完成',
  'updater.ready.later': '稍后',
  'updater.ready.openFinder': '打开访达',
  'updater.ready.restart': '重启更新',
  'updater.ready.openDownloads': '打开下载目录',
  'updater.ready.macPackage': '新的 macOS 安装包',
  'updater.ready.windowsPackage': '新的 Windows 安装包',
  'updater.ready.package': '新的安装包',
  'updater.ready.macDetail': '已下载 {name}。打开访达后请手动安装。',
  'updater.ready.windowsDetail': '已下载 {name}。继续后会打开安装程序并退出当前版本。',
  'updater.ready.detail': '已下载 {name}。',
} as const;

export type NativeMessageKey = keyof typeof zhCNMessages;
export type NativeTranslate = (key: NativeMessageKey, params?: Record<string, string | number>) => string;

const enUSMessages: Record<NativeMessageKey, string> = {
  'browser.openLinkInNewTab': 'Open link in new tab',
  'browser.copyLinkAddress': 'Copy link address',
  'browser.openImageInNewTab': 'Open image in new tab',
  'browser.copyImage': 'Copy image',
  'browser.copyImageAddress': 'Copy image address',
  'browser.downloadImage': 'Download image',
  'browser.undo': 'Undo',
  'browser.redo': 'Redo',
  'browser.cut': 'Cut',
  'browser.copy': 'Copy',
  'browser.paste': 'Paste',
  'browser.delete': 'Delete',
  'browser.selectAll': 'Select all',
  'browser.back': 'Back',
  'browser.forward': 'Forward',
  'browser.reload': 'Reload',
  'updater.ready.title': 'Update ready',
  'updater.ready.later': 'Later',
  'updater.ready.openFinder': 'Open in Finder',
  'updater.ready.restart': 'Restart and update',
  'updater.ready.openDownloads': 'Open downloads folder',
  'updater.ready.macPackage': 'new macOS installer',
  'updater.ready.windowsPackage': 'new Windows installer',
  'updater.ready.package': 'new installer',
  'updater.ready.macDetail': '{name} has been downloaded. Open Finder and install it manually.',
  'updater.ready.windowsDetail': '{name} has been downloaded. Continuing opens the installer and exits the current version.',
  'updater.ready.detail': '{name} has been downloaded.',
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
