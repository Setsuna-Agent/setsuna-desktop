import type {
  RuntimeThreadGoal,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';

const GOAL_TOOL_NAMES = new Set(['get_goal', 'create_goal', 'update_goal']);

const CREATE_GOAL_TOOL: RuntimeToolDefinition = {
  name: 'create_goal',
  description: [
    'Create or replace the persistent multi-turn goal for this thread, but only when the user explicitly requests goal mode.',
    'Do not infer a goal from an ordinary task. Write a durable, evidence-checkable objective covering the outcome, verification surface, constraints, boundaries, iteration policy, and blocked stop condition.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: 'Concrete objective to pursue across turns.' },
    },
    required: ['objective'],
    additionalProperties: false,
  },
};

const GET_GOAL_TOOL: RuntimeToolDefinition = {
  name: 'get_goal',
  description: 'Read the active persistent goal and its usage counters.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

const UPDATE_GOAL_TOOL: RuntimeToolDefinition = {
  name: 'update_goal',
  description: 'Mark the active goal complete only after a strict audit proves every requirement is achieved. Pausing, clearing, and blocking are runtime or user actions.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['complete'] },
    },
    required: ['status'],
    additionalProperties: false,
  },
};

/** Goal creation is always available; read/completion tools only exist during active pursuit. */
export function goalToolDefinitions(goal: RuntimeThreadGoal | null | undefined): RuntimeToolDefinition[] {
  return goal?.status === 'active'
    ? [CREATE_GOAL_TOOL, GET_GOAL_TOOL, UPDATE_GOAL_TOOL]
    : [CREATE_GOAL_TOOL];
}

export function isGoalToolName(name: string): boolean {
  return GOAL_TOOL_NAMES.has(name);
}
