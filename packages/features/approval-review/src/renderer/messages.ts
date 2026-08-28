import { defineRendererMessageBundle } from '@setsuna-desktop/feature-core/renderer';

export const approvalReviewMessages = defineRendererMessageBundle({
  namespace: 'feature.approvalReview',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      'feature.approvalReview.settings.group': '审查与安全',
      'feature.approvalReview.settings.model': '审批审查',
      'feature.approvalReview.settings.description': '独立审查需要越过当前权限边界的操作，并决定允许、拒绝或交由你确认。',
      'feature.approvalReview.settings.followCurrent': '跟随当前对话模型',
      'feature.approvalReview.settings.unavailable': '之前选择的模型已不可用',
      'feature.approvalReview.settings.empty': '没有可用模型，请先配置并启用模型服务。',
    },
    'en-US': {
      'feature.approvalReview.settings.group': 'Review and safety',
      'feature.approvalReview.settings.model': 'Approval review',
      'feature.approvalReview.settings.description': 'Independently review actions that cross the current permission boundary and allow, deny, or escalate them to you.',
      'feature.approvalReview.settings.followCurrent': 'Follow the current conversation model',
      'feature.approvalReview.settings.unavailable': 'The previously selected model is unavailable',
      'feature.approvalReview.settings.empty': 'No model is available. Configure and enable a model provider first.',
    },
  },
});
