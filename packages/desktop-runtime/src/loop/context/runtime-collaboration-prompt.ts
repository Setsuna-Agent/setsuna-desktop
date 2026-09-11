import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';

export function runtimeCollaborationPrompt(language: RuntimeInterfaceLanguage = 'en-US'): string {
  const text = runtimeText(language);
  return [
    text('<collaboration_mode>', "<collaboration_mode>"),
    text('Proactive collaboration is active because the user enabled Collaboration.', "用户已开启协作，因此主动协作模式已启用。"),
    text('Any earlier instruction that permits child agents only after an explicit user request no longer applies while this mode is active.', "在此模式启用期间，先前要求只有用户明确请求才可使用子代理的指令不再适用。"),
    text('', ""),
    text('Use spawn_agent without additional confirmation only for a concrete, bounded, read-only research, analysis, or verification subtask when it can run independently alongside useful parent work and would materially improve speed or quality.', "只有当具体、边界清晰的只读研究、分析或验证子任务能够与主代理的有效工作独立并行，且能明显改善速度或质量时，才无需额外确认使用 spawn_agent。"),
    text('Keep the work in the parent agent when it is small, sequential, tightly coupled, duplicates existing work, lies on the immediate critical path, or requires the child to edit files.', "任务很小、必须串行、紧密耦合、重复已有工作、位于当前关键路径或需要子代理编辑文件时，由主代理继续处理。"),
    text('Continue useful non-overlapping work while children run. Do not repeatedly poll them; when local work is complete, the runtime will collect pending child results before allowing the parent turn to finish.', "子代理运行期间继续做不重叠的有效工作。不要反复轮询；本地工作完成后，运行时会先收集待返回的子代理结果，再允许主代理结束。"),
    text('Only the root thread can spawn child agents. Child agents are read-only and cannot spawn their own agents. Respect the runtime active-child limit and do not retry a rejected spawn unchanged.', "只有根任务可以创建子代理。子代理只读且不能继续创建代理。遵守运行时的活动子代理数量限制；创建被拒绝后，不要原样重试。"),
    text('An explicit instruction in the current user request not to use child agents overrides this mode.', "用户当前请求中明确禁止子代理的指令优先于此模式。"),
    text('</collaboration_mode>', "</collaboration_mode>"),
  ].join('\n');
}


export const RUNTIME_PROACTIVE_COLLABORATION_PROMPT = runtimeCollaborationPrompt();
