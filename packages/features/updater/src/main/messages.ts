import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';

const zhCNMessages = {
  'ready.title': '更新已经准备完成',
  'ready.later': '稍后',
  'ready.openFinder': '打开访达',
  'ready.restart': '重启更新',
  'ready.openDownloads': '打开下载目录',
  'ready.macPackage': '新的 macOS 安装包',
  'ready.windowsPackage': '新的 Windows 安装包',
  'ready.package': '新的安装包',
  'ready.macDetail': '已下载 {name}。打开访达后请手动安装。',
  'ready.windowsDetail': '已下载 {name}。继续后会打开安装程序并退出当前版本。',
  'ready.detail': '已下载 {name}。',
} as const;

type UpdaterNativeMessageKey = keyof typeof zhCNMessages;
type UpdaterNativeTranslate = (
  key: UpdaterNativeMessageKey,
  params?: Record<string, string | number>,
) => string;

const enUSMessages: Record<UpdaterNativeMessageKey, string> = {
  'ready.title': 'Update ready',
  'ready.later': 'Later',
  'ready.openFinder': 'Open in Finder',
  'ready.restart': 'Restart and update',
  'ready.openDownloads': 'Open downloads folder',
  'ready.macPackage': 'new macOS installer',
  'ready.windowsPackage': 'new Windows installer',
  'ready.package': 'new installer',
  'ready.macDetail': '{name} has been downloaded. Open Finder and install it manually.',
  'ready.windowsDetail': '{name} has been downloaded. Continuing opens the installer and exits the current version.',
  'ready.detail': '{name} has been downloaded.',
};

const updaterNativeMessages: Record<
  RuntimeInterfaceLanguage,
  Record<UpdaterNativeMessageKey, string>
> = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages,
};

export function createUpdaterNativeTranslate(
  locale: RuntimeInterfaceLanguage,
): UpdaterNativeTranslate {
  return (key, params) => {
    const template = updaterNativeMessages[locale][key];
    if (!params) return template;
    return template.replace(
      /\{(\w+)\}/gu,
      (match, name: string) => String(params[name] ?? match),
    );
  };
}
