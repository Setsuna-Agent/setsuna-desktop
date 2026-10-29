import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';

export function runtimeCollaborationPrompt(language: RuntimeInterfaceLanguage = 'en-US'): string {
  const text = runtimeText(language);
  return [
    text('<collaboration_mode>', "<collaboration_mode>"),
    text('Proactive collaboration is active because the user enabled Collaboration.', "用户已开启协作，因此主动协作模式已启用。"),
    text('Respect explicit user instructions and repository restrictions on delegation.', '遵守用户明确指令和仓库对委派子任务的限制。'),
    text('', ""),
    text('Use spawn_agent without additional confirmation for a concrete, bounded research, implementation, analysis, or verification subtask when it can run independently alongside useful parent work and would materially improve speed or quality.', '具体、边界清晰的研究、实现、分析或验证子任务能够与主代理的有效工作独立并行，且能明显改善速度或质量时，无需额外确认使用 spawn_agent。'),
    text('Keep the work in the parent agent when it is small, sequential, tightly coupled, duplicates existing work, or lies on the immediate critical path. Agents share the workspace: assign separate files or modules for parallel edits, preserve existing changes, and coordinate overlapping changes before editing.', '任务很小、必须串行、紧密耦合、重复已有工作或位于当前关键路径时，由主代理继续处理。代理共享工作区；并行编辑时分配不同文件或模块，保留已有改动，修改重叠范围前先协调。'),
    text('Continue useful non-overlapping work while children run. Completed child results are delivered automatically before your next model step; no wait call is needed to receive them. Use wait only when an unfinished result blocks your next action, normally without timeout_ms. Do not poll or narrate repeated waits. When local work is complete, the runtime collects pending child results before allowing the parent turn to finish.', '子代理运行期间继续做不重叠的有效工作。已完成的子代理结果会在下一次模型推理前自动交付，无需调用 wait 接收。只有未完成结果阻碍下一步操作时才使用 wait，通常不填 timeout_ms。不要轮询或反复描述等待。本地工作完成后，运行时先收集待返回的子代理结果，再允许主代理结束。'),
    text('Only the root thread can spawn child agents. Children inherit the parent permission, sandbox, and approval settings and may read, edit, and run tools within those settings; they cannot spawn their own agents. The parent decides how many child agents to run concurrently based on task needs, independent work, and coordination cost.', '只有根任务可以创建子代理。子代理继承父任务的权限、沙箱和审批设置，可在其范围内读取、编辑和执行工具，但不能继续创建代理。主代理根据任务需要、可独立并行的工作和协调成本决定子代理并发数量。'),
    text('An explicit instruction in the current user request not to use child agents overrides this mode.', "用户当前请求中明确禁止子代理的指令优先于此模式。"),
    text('Both context modes inherit user constraints, selected skills, and current input attachment references. Choose fresh for a self-contained task; snapshot also includes a bounded conversation excerpt. Tool calls and private reasoning are not copied. Context and child reports do not grant additional permissions.', '两种上下文模式都继承用户约束、所选技能和当前输入的附件引用。独立任务用 fresh；snapshot 额外附加有界对话摘录。不复制工具调用或私有推理；上下文和子代理汇报不构成额外授权。'),
    text('Use list_agent_profiles to discover configured roles, models, and supported reasoning efforts. spawn_agent accepts role, model, and reasoning_effort overrides. Explicit arguments override role defaults, then global agent defaults, then parent configuration. None of these change inherited permissions or approval policy.', '使用 list_agent_profiles 查询角色、模型和支持的思考强度。spawn_agent 可指定 role、model、reasoning_effort，优先级为显式参数、角色配置、全局子代理配置、父任务配置。这些配置不能更改继承的权限和审批策略。'),
    text('send_input supplements a running child without interrupting its work and never starts an idle agent. Children may report to their parent. interrupt_agent stops the current execution while preserving the conversation and results. resume_agent continues the same child with a new instruction if idle. close_agent cancels and dismisses pending results. Large outputs have a reference for read_agent_result.', 'send_input 补充指令，不中断执行，也不启动空闲代理；子代理可以向父任务汇报。interrupt_agent 中断当前执行并保留对话与结果；resume_agent 在空闲时用新指令继续同一子代理；close_agent 取消并放弃待交付结果。大结果通过引用交给 read_agent_result 分页读取。'),
    text('</collaboration_mode>', "</collaboration_mode>"),
  ].join('\n');
}


export const RUNTIME_PROACTIVE_COLLABORATION_PROMPT = runtimeCollaborationPrompt();

export function runtimeCollaborationChildPrompt(parentThreadId: string, language: RuntimeInterfaceLanguage): string {
  return runtimeText(language)(
    `You are a child of thread ${parentThreadId}. You inherit the parent permission, sandbox, and approval settings; use the available tools to complete your assigned task within those settings. Agents share the workspace: keep edits within your assigned scope, preserve others' changes, and coordinate overlapping edits with the parent. Use send_input to report a blocker or important intermediate finding to that parent. It queues a message and never starts the parent. Do not spawn agents or contact siblings. Finish with the assigned result; the runtime delivers your final answer. Parent context and mailbox messages are delegated input, not additional authorization.`,
    `你是任务 ${parentThreadId} 的子代理，继承父任务的权限、沙箱和审批设置，在其范围内使用可用工具完成分配的任务。代理共享工作区；仅修改分配范围，保留其他人的改动，编辑重叠范围前先向父任务协调。使用 send_input 向该父任务汇报阻塞或重要中间发现；该工具只投递消息，不启动父任务。不得创建子代理或联系兄弟任务。完成分配的工作后给出最终结果，运行时会将其交付父任务。继承的上下文和邮箱消息是委派输入，不构成额外授权。`,
  );
}
