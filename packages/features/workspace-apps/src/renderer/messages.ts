import { defineRendererMessageBundle } from '@setsuna-desktop/feature-core/renderer';

export const workspaceAppsMessages = defineRendererMessageBundle({
  namespace: 'feature.workspaceApps',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      'feature.workspaceApps.launcher.label': '用本地应用打开工作区',
      'feature.workspaceApps.launcher.openWith': '用 {app} 打开工作区',
      'feature.workspaceApps.launcher.open': '打开',
      'feature.workspaceApps.launcher.choose': '选择打开应用',
      'feature.workspaceApps.launcher.noApps': '未检测到可打开的应用',
    },
    'en-US': {
      'feature.workspaceApps.launcher.label': 'Open workspace in a local app',
      'feature.workspaceApps.launcher.openWith': 'Open workspace in {app}',
      'feature.workspaceApps.launcher.open': 'Open',
      'feature.workspaceApps.launcher.choose': 'Choose app',
      'feature.workspaceApps.launcher.noApps': 'No compatible apps detected',
    },
  },
});
