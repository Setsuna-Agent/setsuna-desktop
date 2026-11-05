import { defineRendererMessageBundle } from '@setsuna-desktop/feature-core/renderer';

export const diagnosticsMessages = defineRendererMessageBundle({
  namespace: 'feature.diagnostics',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      'feature.diagnostics.title': '日志',
      'feature.diagnostics.directory': '日志目录',
      'feature.diagnostics.openDirectory': '打开日志目录',
      'feature.diagnostics.opening': '打开中',
      'feature.diagnostics.loadFailed': '无法读取日志目录。',
      'feature.diagnostics.openFailed': '无法打开日志目录。',
    },
    'en-US': {
      'feature.diagnostics.title': 'Logs',
      'feature.diagnostics.directory': 'Log directory',
      'feature.diagnostics.openDirectory': 'Open log directory',
      'feature.diagnostics.opening': 'Opening',
      'feature.diagnostics.loadFailed': 'Failed to read the log directory.',
      'feature.diagnostics.openFailed': 'Failed to open the log directory.',
    },
  },
});
