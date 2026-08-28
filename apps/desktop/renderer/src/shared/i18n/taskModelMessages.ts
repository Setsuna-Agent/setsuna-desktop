export const taskModelZhCN = {
  'settings.section.taskModels': '专用模型',
  'settings.section.taskModelsDescription': '为审查、上下文处理等后台任务指定独立模型。',
  'settings.taskModels.groupReviewSafety': '审查与安全',
  'settings.taskModels.groupContext': '上下文',
  'settings.taskModels.review': '代码审查',
  'settings.taskModels.reviewDescription': '审查工作区更改、分支或提交；建议选择擅长代码分析和工具调用的模型。',
  'settings.taskModels.approvalReview': '审批审查',
  'settings.taskModels.approvalReviewDescription': '独立审查需要越过当前权限边界的操作，并决定允许或拒绝。',
  'settings.taskModels.contextCompaction': '上下文压缩',
  'settings.taskModels.contextCompactionDescription': '接近上下文上限时，把较早的对话整理成可继续使用的摘要。',
  'settings.taskModels.followCurrent': '跟随当前对话模型',
  'settings.taskModels.unavailable': '所选模型已不可用',
} as const;

export const taskModelEnUS = {
  'settings.section.taskModels': 'Task models',
  'settings.section.taskModelsDescription': 'Assign dedicated models to review, context processing, and other background tasks.',
  'settings.taskModels.groupReviewSafety': 'Review and safety',
  'settings.taskModels.groupContext': 'Context',
  'settings.taskModels.review': 'Code review',
  'settings.taskModels.reviewDescription': 'Review workspace changes, branches, or commits. A model strong at code analysis and tool calling is recommended.',
  'settings.taskModels.approvalReview': 'Approval review',
  'settings.taskModels.approvalReviewDescription': 'Independently review actions that cross the current permission boundary and allow or deny them.',
  'settings.taskModels.contextCompaction': 'Context compaction',
  'settings.taskModels.contextCompactionDescription': 'Summarize older conversation history when the context window approaches its limit.',
  'settings.taskModels.followCurrent': 'Follow current chat model',
  'settings.taskModels.unavailable': 'Selected model is unavailable',
} as const;
