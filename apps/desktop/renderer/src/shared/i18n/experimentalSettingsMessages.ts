export const experimentalSettingsZhCN = {
  'settings.section.experimental': '实验性功能',
  'settings.experimental.viewDetails': '查看详情',
  'settings.experimental.backgroundCompaction': '后台上下文压缩',
  'settings.experimental.backgroundCompactionDescription': '提前准备长对话的压缩结果，尽量缩短后续等待。默认关闭。',
  'settings.experimental.backgroundCompaction.trigger.title': '何时开始',
  'settings.experimental.backgroundCompaction.trigger.description': '上下文用量达到自动压缩触发阈值的约 80% 时，Setsuna 会尝试在后台调用模型，把较早的消息整理成更短的上下文，当前对话继续进行。',
  'settings.experimental.backgroundCompaction.apply.title': '何时使用结果',
  'settings.experimental.backgroundCompaction.apply.description': '在后续请求模型前，Setsuna 会检查已完成的结果是否仍适用于当前会话，再用它替换较早的上下文，并保留新增消息。原始聊天记录不会删除；若触及自动压缩阈值时结果仍未完成，仍需等待。',
  'settings.experimental.backgroundCompaction.cost.title': '用量与限制',
  'settings.experimental.backgroundCompaction.cost.description': '提前压缩也会消耗模型用量。切换模型、修改历史或取消任务，可能让结果作废；已产生的用量仍会记录。压缩可能遗漏细节，实际等待时间也取决于模型和网络。',
  'settings.experimental.backgroundCompaction.disabled.title': '关闭后会怎样',
  'settings.experimental.backgroundCompaction.disabled.description': '停止提前压缩，取消未完成的压缩任务并丢弃尚未使用的结果。对话达到自动压缩阈值后，仍会在继续请求模型前执行压缩；已经应用的压缩不会撤销。',
} as const;

export const experimentalSettingsEnUS = {
  'settings.section.experimental': 'Experimental features',
  'settings.experimental.viewDetails': 'View details',
  'settings.experimental.backgroundCompaction': 'Background context compaction',
  'settings.experimental.backgroundCompactionDescription': 'Prepare compacted context ahead of time in long conversations to reduce later waits. Off by default.',
  'settings.experimental.backgroundCompaction.trigger.title': 'When it starts',
  'settings.experimental.backgroundCompaction.trigger.description': 'At about 80% of the automatic compaction threshold, Setsuna attempts to call a model in the background to condense older messages into shorter context. Your conversation continues while this runs.',
  'settings.experimental.backgroundCompaction.apply.title': 'When the result is used',
  'settings.experimental.backgroundCompaction.apply.description': 'Before a later model request, Setsuna checks that the completed result still applies to the conversation, then uses it in place of older context while keeping new messages. Your original chat history is not deleted. If the automatic compaction threshold is reached before the result is ready, you still need to wait.',
  'settings.experimental.backgroundCompaction.cost.title': 'Usage and limitations',
  'settings.experimental.backgroundCompaction.cost.description': 'Preparing context uses model tokens. Switching models, editing history, or cancelling a task may invalidate the result; usage already incurred is still recorded. Compaction can omit details, and waiting time also depends on the model and network.',
  'settings.experimental.backgroundCompaction.disabled.title': 'What happens when it is off',
  'settings.experimental.backgroundCompaction.disabled.description': 'Advance preparation stops, unfinished compaction tasks are cancelled, and unused results are discarded. At the automatic compaction threshold, compaction still runs before the next model request. Previously applied compaction is not undone.',
} as const;
