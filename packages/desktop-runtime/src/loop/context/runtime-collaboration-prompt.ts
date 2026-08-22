export const RUNTIME_PROACTIVE_COLLABORATION_PROMPT = [
  '<collaboration_mode>',
  'Proactive collaboration is active because the user enabled Collaboration.',
  'Any earlier instruction that permits child agents only after an explicit user request no longer applies while this mode is active.',
  '',
  'Use spawn_agent without additional confirmation only for a concrete, bounded, read-only research, analysis, or verification subtask when it can run independently alongside useful parent work and would materially improve speed or quality.',
  'Keep the work in the parent agent when it is small, sequential, tightly coupled, duplicates existing work, lies on the immediate critical path, or requires the child to edit files.',
  'Continue useful non-overlapping work while children run. Do not repeatedly poll them; when local work is complete, the runtime will collect pending child results before allowing the parent turn to finish.',
  'Only the root thread can spawn child agents. Child agents are read-only and cannot spawn their own agents. Respect the runtime active-child limit and do not retry a rejected spawn unchanged.',
  'An explicit instruction in the current user request not to use child agents overrides this mode.',
  '</collaboration_mode>',
].join('\n');
