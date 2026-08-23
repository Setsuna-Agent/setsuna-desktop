import { defineRendererMessageBundle } from '@setsuna-desktop/feature-core/renderer';

export const terminalMessages = defineRendererMessageBundle({
  namespace: 'feature.terminal',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      'feature.terminal.error': '终端错误',
      'feature.terminal.exited': '进程已退出：{code}',
      'feature.terminal.closed': '终端已关闭',
      'feature.terminal.restartBlocked': '终端仍在运行，无法重新启动。',
      'feature.terminal.starting': '终端正在启动...',
      'feature.terminal.unavailable': '桌面终端桥不可用',
      'feature.terminal.shellExited': 'Shell 已退出',
      'feature.terminal.restarting': '正在重启...',
      'feature.terminal.restart': '重新启动',
    },
    'en-US': {
      'feature.terminal.error': 'Terminal error',
      'feature.terminal.exited': 'Process exited: {code}',
      'feature.terminal.closed': 'Terminal closed',
      'feature.terminal.restartBlocked': 'The terminal is still running and cannot be restarted.',
      'feature.terminal.starting': 'Terminal is starting...',
      'feature.terminal.unavailable': 'The desktop terminal bridge is unavailable',
      'feature.terminal.shellExited': 'Shell exited',
      'feature.terminal.restarting': 'Restarting...',
      'feature.terminal.restart': 'Restart',
    },
  },
});
