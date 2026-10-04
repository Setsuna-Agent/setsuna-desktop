import { dialog, type BrowserWindow } from 'electron';
import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';

const permissionLabels: Record<string, [string, string]> = {
  tabs: ['读取浏览器标签页', 'Read browser tabs'],
  activeTab: ['访问当前标签页', 'Access the active tab'],
  storage: ['存储扩展数据', 'Store extension data'],
  scripting: ['在网页中运行脚本', 'Run scripts on websites'],
  webRequest: ['监测网络请求', 'Observe network requests'],
  webRequestBlocking: ['拦截网络请求', 'Block network requests'],
  declarativeNetRequest: ['过滤网络请求', 'Filter network requests'],
  clipboardRead: ['读取剪贴板', 'Read the clipboard'],
  clipboardWrite: ['写入剪贴板', 'Write to the clipboard'],
  downloads: ['管理下载', 'Manage downloads'],
  nativeMessaging: ['与本机应用通信', 'Communicate with native applications'],
  cookies: ['访问网站 Cookie', 'Access website cookies'],
  history: ['访问浏览记录', 'Access browsing history'],
};

export function extensionPermissions(manifest: Record<string, unknown>, language: RuntimeInterfaceLanguage): string[] {
  const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const values = [manifest.permissions, manifest.host_permissions, ...scripts.map((script) => script?.matches)]
    .flatMap((value) => Array.isArray(value) ? value : []);
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))]
    .slice(0, 80).map((value) => permissionLabels[value]?.[language === 'zh-CN' ? 0 : 1] ?? value.slice(0, 200));
}

export async function confirmExtensionInstall(
  window: BrowserWindow, name: string, manifest: Record<string, unknown>, language: RuntimeInterfaceLanguage,
): Promise<boolean> {
  const chinese = language === 'zh-CN';
  const permissions = extensionPermissions(manifest, language);
  const result = await dialog.showMessageBox(window, {
    type: 'question',
    title: chinese ? '安装扩展' : 'Install extension',
    message: chinese ? `添加“${name.slice(0, 160)}”？` : `Add “${name.slice(0, 160)}”?`,
    detail: permissions.length
      ? `${chinese ? '此扩展请求以下权限：' : 'This extension requests these permissions:'}\n\n${permissions.join('\n')}`
      : undefined,
    buttons: chinese ? ['取消', '添加扩展'] : ['Cancel', 'Add extension'],
    defaultId: 0, cancelId: 0, noLink: true,
  });
  return result.response === 1;
}
