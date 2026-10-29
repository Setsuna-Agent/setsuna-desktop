import { runtimeText, type RuntimeInterfaceLanguage, type RuntimeToolDefinition, type RuntimeConfigState } from '@setsuna-desktop/contracts';

const COLLABORATION_TOOL_NAMES = new Set(['spawn_agent', 'send_input', 'resume_agent', 'interrupt_agent', 'wait', 'close_agent', 'read_agent_result', 'list_agent_profiles']);

export function collaborationToolDefinitions(language?: RuntimeInterfaceLanguage): readonly RuntimeToolDefinition[] {
  const text = runtimeText(language);
  return [
    {
      name: 'list_agent_profiles',
      description: text('List configured agent roles and available model IDs and reasoning efforts. Use these exact IDs for spawn_agent overrides. Settings never change inherited permissions or approval policy.', '列出代理角色和可用模型 ID、思考强度。spawn_agent 覆盖配置时使用这些确切 ID；角色不能更改继承的权限和审批策略。'),
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'spawn_agent',
      description: text('Start a child agent thread for a concrete, bounded subtask that can run independently alongside useful parent work. Children inherit the parent permission and approval settings and may edit files within those permissions. Assign clear file ownership for parallel edits. The parent decides concurrency based on task needs and independent work. Only the root thread can call this tool; returns the child thread and turn identifiers.', '创建子代理处理具体、边界清晰且能与主代理有效工作独立并行的子任务。子代理继承父任务的权限和审批设置，可在权限内修改文件；并行编辑时明确各自负责的文件。主代理根据任务需要和可独立并行的工作决定并发数量。仅根任务可以调用；返回子任务和轮次标识。'),
      inputSchema: {
        type: 'object',
        properties: {
          context_mode: { type: 'string', enum: ['fresh', 'snapshot'], description: text('Both modes inherit user constraints, selected skills, and current input attachment references. fresh omits assistant history; snapshot adds a bounded conversation excerpt. Tool calls and private reasoning are never copied.', '两种模式均继承用户约束、所选技能和当前输入的附件引用。fresh 不带助手历史；snapshot 增加有长度上限的对话摘录，不复制工具调用或私有推理。') },
          role: { type: 'string', description: text('Configured role name; defaults to default. Discover roles with list_agent_profiles.', '已配置的角色名称，默认 default；通过 list_agent_profiles 查询。') },
          model: { type: 'object', properties: { providerId: { type: 'string' }, modelId: { type: 'string' } }, required: ['providerId', 'modelId'], additionalProperties: false },
          reasoning_effort: { type: 'string', description: text('Optional supported effort from list_agent_profiles, or none to disable thinking.', '可选的模型支持的思考强度，none 表示关闭思考。') },
          prompt: { type: 'string', description: text('Task prompt for the child agent.', "交给子代理的任务提示词。") },
          title: { type: 'string', description: text('Optional child thread title.', "可选子任务标题。") },
          name: { type: 'string', description: text('Optional short display name for the child agent.', "可选子代理的简短显示名称。") },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'send_input',
      description: text('Queue a message (maximum 8000 characters) to a direct child, or from a child to its owning parent. Wakes a waiting active recipient; never starts an idle recipient.', "向直属子代理或所属父任务发送消息（最多 8000 字符）。可唤醒正在等待的接收方，不启动空闲任务。"),
      inputSchema: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: text('Receiver thread id.', "接收方任务 ID。") },
          content: { type: 'string', description: text('Mailbox message content.', "邮箱消息内容。") },
        },
        required: ['thread_id', 'content'],
      },
    },
    {
      name: 'resume_agent',
      description: text('Deliver a mailbox message and start the receiver agent if it is idle.', "发送邮箱消息，若接收方代理空闲则启动它。"),
      inputSchema: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: text('Receiver thread id.', "接收方任务 ID。") },
          content: { type: 'string', description: text('Resume prompt or mailbox message content.', "恢复提示词或邮箱消息内容。") },
        },
        required: ['thread_id', 'content'],
      },
    },
    {
      name: 'wait',
      description: text('Suspend only when an unfinished child result blocks the next step. Completed results are delivered automatically before the next model step; do not poll for status. Omit timeout_ms for normal waiting: completion, another available child result, or incoming input wakes the parent. Returns bounded output and a resultRef for read_agent_result when the target finishes.', '仅在未完成的子代理结果阻碍下一步时暂停等待。已完成结果会在下一次模型推理前自动交付，不要轮询状态。正常等待不填 timeout_ms；目标完成、其他子代理结果就绪或新输入会唤醒主代理。目标完成后返回有长度上限的输出和供 read_agent_result 使用的引用。'),
      inputSchema: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: text('Thread id to wait on.', "要等待的任务 ID。") },
          timeout_ms: { type: 'number', minimum: 0, description: text('Optional wait budget in milliseconds. Omit to wait for a result or input without periodic timeouts.', '可选等待时限（毫秒）。省略时等待结果或新输入，不会周期性超时。') },
        },
        required: ['thread_id'],
      },
    },
    {
      name: 'read_agent_result',
      description: text('Read a page of a completed direct child result using resultRef. Offsets and limits count UTF-16 code units; maximum page size is 12000.', '按 resultRef 分页读取直属子任务的终态结果。offset 和 limit 按 UTF-16 字符单元计数，每页最多 12000。'),
      inputSchema: { type: 'object', properties: {
        thread_id: { type: 'string' }, turn_id: { type: 'string' },
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 2, maximum: 12000 },
      }, required: ['thread_id', 'turn_id'] },
    },
    {
      name: 'interrupt_agent',
      description: text('Interrupt a direct child immediately, retaining its conversation and pending results. Use resume_agent to continue the same child with a new instruction.', '立即中断直属子代理，保留对话和待交付结果。通过 resume_agent 在同一个子代理中继续。'),
      inputSchema: { type: 'object', properties: { thread_id: { type: 'string' } }, required: ['thread_id'] },
    },
    {
      name: 'close_agent',
      description: text('Stop tracking a child agent thread; cancels its active turn if one is still running.', "停止跟踪一个子代理任务；若其仍在运行，会取消活动轮次。"),
      inputSchema: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: text('Child thread id to close.', "要关闭的子任务 ID。") },
          reason: { type: 'string', description: text('Optional close reason.', "可选关闭原因。") },
        },
        required: ['thread_id'],
      },
    },
  ];
}

export const COLLABORATION_TOOL_DEFINITIONS = Object.freeze(collaborationToolDefinitions());

export function collaborationToolsEnabled(config: RuntimeConfigState | null | undefined): boolean {
  return config?.features?.multi_agent === true || config?.features?.multi_agent_v2 === true;
}

export function isCollaborationToolName(name: string): boolean {
  return COLLABORATION_TOOL_NAMES.has(name);
}
