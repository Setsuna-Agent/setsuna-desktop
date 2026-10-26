import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
/** Model tool definitions owned by the Goal Feature. */
import type {
  RuntimeThreadGoal,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { GoalToolExecutionResult, GoalCompletionVerification } from '../contracts/index.js';

const GOAL_TOOL_NAMES = new Set(['get_goal', 'create_goal', 'update_goal']);

function createGoalDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: 'create_goal',
    description: [
      text('Create or replace the persistent multi-turn goal for this thread, but only when the user explicitly requests goal mode.', "仅在用户明确要求目标模式时，创建或替换当前任务的持久化多轮目标。"),
      text('Do not infer a goal from an ordinary task. Write a durable, evidence-checkable objective covering the outcome, verification surface, constraints, boundaries, iteration policy, and blocked stop condition.', "不要从普通任务推断目标。目标应长期有效、可用证据检验，覆盖结果、验证方式、约束、边界、迭代策略及受阻停止条件。"),
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: text('Concrete objective to pursue across turns.', "跨轮次持续推进的具体目标。") },
      },
      required: ['objective'],
      additionalProperties: false,
    },
  };
}

function getGoalDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: 'get_goal',
    description: text('Read the active persistent goal and its usage counters.', "读取当前持久化目标及其用量计数。"),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  };
}

function updateGoalDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: 'update_goal',
    description: text('Request completion after verifying every requirement. The runtime independently audits the original objective against recorded evidence. Missing evidence returns specific gaps to repair; three unsuccessful audits in one turn block the Goal. Further tools or user input invalidate a passing audit. Pausing, clearing, and blocking are runtime or user actions.', '完成所有要求的验证后申请完成。运行时会独立对照原始目标审查已记录证据，缺失时返回待修复项；单轮三次验收未通过会阻塞目标。验收通过后的工具执行或用户输入会使其失效。暂停、清除和阻塞由运行时或用户控制。'),
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['complete'] },
      },
      required: ['status'],
      additionalProperties: false,
    },
  };
}

/** Goal tools are withheld while completion waits for the current turn's final outcome. */
export function goalToolDefinitions(
  goal: RuntimeThreadGoal | null | undefined,
  completionPending = false,
  language?: RuntimeInterfaceLanguage,
): RuntimeToolDefinition[] {
  if (completionPending) return [];
  return goal?.status === 'active'
    ? [createGoalDefinition(language), getGoalDefinition(language), updateGoalDefinition(language)]
    : [createGoalDefinition(language)];
}

export function isGoalToolName(name: string): boolean {
  return GOAL_TOOL_NAMES.has(name);
}

export function goalToolResult(
  name: string,
  data: { goal: RuntimeThreadGoal | null; completionPending?: boolean; verification?: GoalCompletionVerification },
  language?: RuntimeInterfaceLanguage,
): GoalToolExecutionResult {
  const text = runtimeText(language);
  const statusLabels = {
    active: '进行中', paused: '已暂停', blocked: '受阻',
    usageLimited: '用量受限', budgetLimited: '预算受限', complete: '已完成',
  };
  const preview = name === 'create_goal'
    ? text('Goal created.', '目标已创建。')
    : data.verification && !data.verification.passed
      ? text('Completion verification found gaps.', '完成验收发现未满足项。')
    : data.completionPending
      ? text('Goal completion will be finalized when this turn completes successfully.', '本轮成功结束后，目标将被标记为完成。')
      : data.goal
        ? text(`Goal is ${data.goal.status}.`, `目标状态：${statusLabels[data.goal.status]}。`)
        : text('No goal is set.', '尚未设置目标。');
  return { content: JSON.stringify({ tool: name, ...data }), data, preview };
}
