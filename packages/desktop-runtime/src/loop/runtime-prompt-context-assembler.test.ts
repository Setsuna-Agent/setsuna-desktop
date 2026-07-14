import { describe, expect, it } from 'vitest';
import type { RuntimeConfigState, RuntimeThread } from '@setsuna-desktop/contracts';
import { RuntimePromptContextAssembler } from './runtime-prompt-context-assembler.js';

describe('RuntimePromptContextAssembler', () => {
  it('prioritizes explicitly selected skills when the full-content budget is exhausted', async () => {
    let instructionEnvironment: unknown;
    const assembler = new RuntimePromptContextAssembler({
      memory: { contextMessages: async () => [] },
      projectInstructions: {
        load: async (input) => {
          instructionEnvironment = input.environment;
          return [];
        },
      },
      skillRegistry: {
        selectedSkillInjections: async () => [
          { id: 'default', name: 'Default Skill', content: '12345', path: '/skills/default/SKILL.md' },
          { id: 'explicit', name: 'Explicit Skill', content: 'abcde', path: '/skills/explicit/SKILL.md' },
        ],
      },
    });
    const environment = {
      id: 'project_1',
      cwd: '/workspace',
      workspaceRoot: '/workspace',
      workspaceRoots: ['/workspace'],
    };

    const result = await assembler.build({
      config: runtimeConfig(),
      hookContextMessages: [],
      skillIds: ['explicit'],
      thread: { id: 'thread_1', projectId: 'project_1' } as RuntimeThread,
      toolContext: {
        environment,
        threadId: 'thread_1',
        projectId: 'project_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: {},
        signal: new AbortController().signal,
      },
      toolRouter: null,
      tools: [],
    });

    const explicit = result.fragments.find((fragment) => fragment.id === 'skill_explicit');
    const defaultSkill = result.fragments.find((fragment) => fragment.id === 'skill_default');
    expect(explicit?.content).toContain('abcde');
    expect(defaultSkill?.content).toContain('budget was exhausted');
    expect(result.selectedSkills.map((skill) => skill.id)).toEqual(['explicit', 'default']);
    expect(instructionEnvironment).toBe(environment);
    expect(result.fragments.find((fragment) => fragment.id === 'desktop_runtime_environment')).toMatchObject({
      role: 'developer',
      source: 'environment',
      trust: 'runtime',
    });
  });
});

function runtimeConfig(): RuntimeConfigState {
  return {
    configPath: '/runtime/config.json',
    dataPath: '/runtime',
    storagePath: '/runtime/memories',
    providers: [],
    globalPrompt: '',
    memory: {
      useMemories: false,
      generateMemories: false,
      dedicatedTools: false,
      disableOnExternalContext: false,
    },
    memoryEnabled: false,
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
    desktopSettings: { skillPromptMaxBytes: 5 },
  };
}
