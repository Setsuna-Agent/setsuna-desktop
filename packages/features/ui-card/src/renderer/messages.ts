import { defineRendererMessageBundle } from '@setsuna-desktop/feature-core/renderer';

export const uiCardMessages = defineRendererMessageBundle({
  namespace: 'feature.uiCard',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      'feature.uiCard.invalidSource': '无法验证这张交互卡片的插件来源。',
      'feature.uiCard.providedBy': '由 {name} 提供',
    },
    'en-US': {
      'feature.uiCard.invalidSource': 'The Plugin source for this interactive card could not be verified.',
      'feature.uiCard.providedBy': 'Provided by {name}',
    },
  },
});
