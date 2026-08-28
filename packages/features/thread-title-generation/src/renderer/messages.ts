import { defineRendererMessageBundle } from '@setsuna-desktop/feature-core/renderer';

export const threadTitleGenerationMessages = defineRendererMessageBundle({
  namespace: 'feature.threadTitleGeneration',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      'feature.threadTitleGeneration.settings.group': '对话辅助',
      'feature.threadTitleGeneration.settings.model': '标题生成',
      'feature.threadTitleGeneration.settings.description': '根据新对话的首条用户消息生成简洁标题。',
      'feature.threadTitleGeneration.settings.followCurrent': '跟随当前对话模型',
      'feature.threadTitleGeneration.settings.unavailable': '之前选择的模型已不可用',
      'feature.threadTitleGeneration.settings.empty': '没有可用模型，请先配置并启用模型服务。',
    },
    'en-US': {
      'feature.threadTitleGeneration.settings.group': 'Conversation helpers',
      'feature.threadTitleGeneration.settings.model': 'Title generation',
      'feature.threadTitleGeneration.settings.description': 'Generate a concise title from the first user message in a new chat.',
      'feature.threadTitleGeneration.settings.followCurrent': 'Follow the current conversation model',
      'feature.threadTitleGeneration.settings.unavailable': 'The previously selected model is unavailable',
      'feature.threadTitleGeneration.settings.empty': 'No model is available. Configure and enable a model provider first.',
    },
  },
});
