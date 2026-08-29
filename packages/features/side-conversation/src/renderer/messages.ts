import { defineRendererMessageBundle } from '@setsuna-desktop/feature-core/renderer';

export const sideConversationMessages = defineRendererMessageBundle({
  namespace: 'feature.sideConversation',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      'feature.sideConversation.composer.title': '侧边',
      'feature.sideConversation.composer.description': '新建一个独立的侧边对话',
      'feature.sideConversation.panel.label': '侧边对话',
      'feature.sideConversation.error.openMainFirst': '请先打开一个主对话',
    },
    'en-US': {
      'feature.sideConversation.composer.title': 'Side chat',
      'feature.sideConversation.composer.description': 'Start an independent chat in the side panel',
      'feature.sideConversation.panel.label': 'Side chat',
      'feature.sideConversation.error.openMainFirst': 'Open a primary conversation first',
    },
  },
});
