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
} as const;

export type BrowserNativeMessageKey = keyof typeof zhCNMessages;
export type BrowserNativeTranslate = (key: BrowserNativeMessageKey) => string;

const enUSMessages: Record<BrowserNativeMessageKey, string> = {
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
};

const messages: Record<RuntimeInterfaceLanguage, Record<BrowserNativeMessageKey, string>> = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages,
};

export function createBrowserNativeTranslate(locale: RuntimeInterfaceLanguage): BrowserNativeTranslate {
  return (key) => messages[locale][key];
}
