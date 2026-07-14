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

  it('injects external project workflow data before narrower project instructions', async () => {
    let workflowEnvironment: unknown;
    const assembler = new RuntimePromptContextAssembler({
      memory: { contextMessages: async () => [] },
      projectWorkflow: {
        resolve: async ({ environment }) => {
          workflowEnvironment = environment;
          return {
            root: '/workspace',
            cwd: '/workspace',
            manifests: [{ kind: 'node-package', path: '/workspace/package.json', directory: '/workspace' }],
            packageManager: { name: 'pnpm', version: '7.33.7', evidence: ['package.json#packageManager'] },
            scripts: [{
              name: 'test',
              definition: 'vitest run --config vitest.unit.config.ts',
              invocation: 'pnpm test',
              cwd: '/workspace',
              sourcePath: '/workspace/package.json',
              truncated: false,
            }],
            warnings: [],
          };
        },
      },
      projectInstructions: {
        load: async () => [{
          content: 'Use the repository test script.',
          directory: '/workspace',
          path: '/workspace/AGENTS.md',
          truncated: false,
        }],
      },
    });
    const environment = {
      id: 'project_1',
      cwd: '/workspace',
      workspaceRoot: '/workspace',
      workspaceRoots: ['/workspace'],
    };

    const result = await assembler.build({
      config: null,
      hookContextMessages: [],
      skillIds: [],
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

    const workflowIndex = result.fragments.findIndex((fragment) => fragment.id === 'desktop_project_workflow');
    const instructionsIndex = result.fragments.findIndex((fragment) => fragment.id === 'project_instruction_0');
    expect(workflowEnvironment).toBe(environment);
    expect(result.fragments[workflowIndex]).toMatchObject({
      role: 'user',
      source: 'project_workflow',
      trust: 'external',
      lifecycle: 'workspace',
      content: expect.stringContaining('<invocation>pnpm test</invocation>'),
    });
    expect(workflowIndex).toBeGreaterThan(-1);
    expect(instructionsIndex).toBeGreaterThan(workflowIndex);
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
