import type {
  RuntimeToolDefinition
} from '@setsuna-desktop/contracts';


export const RUN_SHELL_COMMAND_TOOL: RuntimeToolDefinition = {
  name: 'run_shell_command',
  description: 'Run a shell command',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      risk_level: { type: 'string' },
      directory: { type: 'string' },
    },
    required: ['command'],
  },
};

export const APPLY_PATCH_TOOL: RuntimeToolDefinition = {
  name: 'apply_patch',
  description: 'Apply a workspace patch',
  inputSchema: {
    type: 'object',
    properties: {
      patch: { type: 'string' },
      workdir: { type: 'string' },
    },
    required: ['patch'],
  },
};