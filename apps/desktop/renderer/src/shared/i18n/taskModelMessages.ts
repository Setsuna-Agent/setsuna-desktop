export const taskModelZhCN = {
  'settings.section.taskModels': '专用模型',
  'settings.section.taskModelsDescription': '为审查、上下文处理等后台任务指定独立模型。',
  'settings.taskModels.groupContext': '上下文',
  'settings.taskModels.contextCompaction': '上下文压缩',
  'settings.taskModels.contextCompactionDescription': '接近上下文上限时，把较早的对话整理成可继续使用的摘要。',
  'settings.taskModels.followCurrent': '跟随当前对话模型',
  'settings.taskModels.unavailable': '所选模型已不可用',
} as const;

export const taskModelEnUS = {
  'settings.section.taskModels': 'Task models',
  'settings.section.taskModelsDescription': 'Assign dedicated models to review, context processing, and other background tasks.',
  'settings.taskModels.groupContext': 'Context',
  'settings.taskModels.contextCompaction': 'Context compaction',
  'settings.taskModels.contextCompactionDescription': 'Summarize older conversation history when the context window approaches its limit.',
  'settings.taskModels.followCurrent': 'Follow current chat model',
  'settings.taskModels.unavailable': 'Selected model is unavailable',
} as const;
