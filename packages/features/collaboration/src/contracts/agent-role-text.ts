import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { CollaborationAgentRole } from './agents.js';

export const BUILTIN_COLLABORATION_ROLES = ['default', 'worker', 'explorer'] as const;
type BuiltinRole = typeof BUILTIN_COLLABORATION_ROLES[number];
type RoleText = Readonly<{ description: string; instructions: string }>;

/** Keep the shipped v1 text stable so migrations recognize defaults without replacing user edits. */
export const LEGACY_COLLABORATION_ROLE_TEXT: Readonly<Record<BuiltinRole, RoleText>> = {
  default: { description: 'General purpose agent', instructions: '' },
  worker: {
    description: 'Implement and verify a bounded change',
    instructions: 'Implement the assigned change within the agreed file ownership. Coordinate shared files before editing and report changes, validation, and remaining blockers.',
  },
  explorer: {
    description: 'Investigate code and report evidence',
    instructions: 'Investigate the assigned question and report concise findings with file references. Follow the assigned task scope; this role does not alter runtime permissions.',
  },
};

const ROLE_TEXT: Readonly<Record<RuntimeInterfaceLanguage, Readonly<Record<BuiltinRole, RoleText>>>> = {
  'en-US': LEGACY_COLLABORATION_ROLE_TEXT,
  'zh-CN': {
    default: { description: '通用代理', instructions: '' },
    worker: {
      description: '实现并验证范围明确的改动',
      instructions: '在约定的文件分工范围内完成所分配的改动。编辑共享文件前先协调，并汇报改动、验证结果和剩余阻碍。',
    },
    explorer: {
      description: '调查代码并提供依据',
      instructions: '调查所分配的问题，简明汇报结论并附上文件引用。遵守任务范围；此角色不会改变运行时权限。',
    },
  },
};

export function builtinCollaborationRoleText(name: string, language: RuntimeInterfaceLanguage): RoleText | undefined {
  return BUILTIN_COLLABORATION_ROLES.find((role) => role === name) ? ROLE_TEXT[language][name as BuiltinRole] : undefined;
}

/** null follows the interface language; any string, including an empty one, is a user override. */
export function resolveCollaborationRoleText(role: CollaborationAgentRole, language: RuntimeInterfaceLanguage): RoleText {
  const builtin = builtinCollaborationRoleText(role.name, language);
  return { description: role.description ?? builtin?.description ?? '', instructions: role.instructions ?? builtin?.instructions ?? '' };
}
