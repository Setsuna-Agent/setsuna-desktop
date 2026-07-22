import type {
  RuntimeMcpAuthStatus,
  RuntimeMcpServerInput,
  RuntimeSkillDetail,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { SkillMcpDependencyCoordinator } from '../../../src/adapters/skill/skill-mcp-dependency-coordinator.js';
import type { McpStore } from '../../../src/ports/mcp-store.js';
import type { SkillRegistry } from '../../../src/ports/skill-registry.js';

describe('SkillMcpDependencyCoordinator', () => {
  it('detects, installs, enables and authenticates declared MCP dependencies', async () => {
    const skill = dependencySkill();
    const skills = memorySkillRegistry(skill);
    const mcp = memoryMcpStore();
    let authStatus: RuntimeMcpAuthStatus = 'notLoggedIn';
    const login = vi.fn(async () => { authStatus = 'oAuth'; });
    const invalidateServer = vi.fn(async () => undefined);
    const client = {
      authStatus: async () => ({ status: authStatus }),
      invalidateServer,
      login,
    };
    const coordinator = new SkillMcpDependencyCoordinator(skills, mcp.store, client);

    await expect(coordinator.getSkill(skill.id)).resolves.toMatchObject({
      mcpDependencies: [{ value: 'sentry', status: 'missing' }],
    });
    const installed = await coordinator.installMcpDependencies(skill.id);
    expect(installed.installed).toEqual(['sentry']);
    expect(mcp.inputs[0]).toMatchObject({
      key: 'sentry',
      enabled: true,
      requireApproval: 'always',
      trustLevel: 'untrusted',
      url: 'https://mcp.sentry.dev/',
    });
    expect(installed.skill.mcpDependencies).toEqual([
      expect.objectContaining({ value: 'sentry', status: 'authRequired', authStatus: 'notLoggedIn' }),
    ]);
    expect(invalidateServer).toHaveBeenCalledWith('sentry');

    const authenticated = await coordinator.authenticateMcpDependency(skill.id, 'sentry');
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ key: 'sentry' }));
    expect(authenticated.mcpDependencies).toEqual([
      expect.objectContaining({ value: 'sentry', status: 'ready', authStatus: 'oAuth' }),
    ]);

    mcp.inputs[0] = { ...mcp.inputs[0], enabled: false };
    await expect(coordinator.getSkill(skill.id)).resolves.toMatchObject({
      mcpDependencies: [{ value: 'sentry', status: 'disabled' }],
    });
    const enabled = await coordinator.installMcpDependencies(skill.id);
    expect(enabled.enabled).toEqual(['sentry']);
    expect(mcp.inputs[0].enabled).toBe(true);
  });

  it('does not overwrite an incompatible server using the dependency key', async () => {
    const skill = dependencySkill();
    const mcp = memoryMcpStore([{
      key: 'sentry',
      transport: 'streamableHttp',
      url: 'https://different.example/mcp',
      enabled: true,
    }]);
    const coordinator = new SkillMcpDependencyCoordinator(
      memorySkillRegistry(skill),
      mcp.store,
      {
        authStatus: async () => ({ status: 'unsupported' }),
        invalidateServer: async () => undefined,
        login: async () => undefined,
      },
    );

    await expect(coordinator.getSkill(skill.id)).resolves.toMatchObject({
      mcpDependencies: [{ value: 'sentry', status: 'conflict' }],
    });
    await expect(coordinator.installMcpDependencies(skill.id)).rejects.toThrow('incompatible server already uses that key');
    expect(mcp.inputs[0].url).toBe('https://different.example/mcp');
  });

  it('preflights every dependency before installing any server', async () => {
    const skill = dependencySkill();
    skill.mcpDependencies = [
      {
        type: 'mcp',
        value: 'docs',
        transport: 'streamableHttp',
        url: 'https://docs.example/mcp',
        status: 'unchecked',
      },
      ...(skill.mcpDependencies ?? []),
    ];
    const mcp = memoryMcpStore([{
      key: 'sentry',
      transport: 'streamableHttp',
      url: 'https://different.example/mcp',
      enabled: true,
    }]);
    const coordinator = new SkillMcpDependencyCoordinator(
      memorySkillRegistry(skill),
      mcp.store,
      {
        authStatus: async () => ({ status: 'unsupported' }),
        invalidateServer: async () => undefined,
        login: async () => undefined,
      },
    );

    await expect(coordinator.installMcpDependencies(skill.id)).rejects.toThrow('incompatible server already uses that key');
    expect(mcp.inputs).toEqual([expect.objectContaining({ key: 'sentry' })]);
  });
});

function dependencySkill(): RuntimeSkillDetail {
  return {
    id: 'sentry-helper',
    name: 'Sentry Helper',
    kind: 'builtin',
    enabled: true,
    selected: false,
    content: '# Sentry Helper',
    references: [],
    mcpDependencies: [{
      type: 'mcp',
      value: 'sentry',
      transport: 'streamableHttp',
      url: 'https://mcp.sentry.dev/',
      oauthResource: 'https://mcp.sentry.dev/',
      status: 'unchecked',
    }],
    dependencyErrors: [],
  };
}

function memorySkillRegistry(skill: RuntimeSkillDetail): SkillRegistry {
  return {
    listSkills: async () => ({ skills: [{ ...skill }] }),
    createSkill: async () => ({ ...skill }),
    getSkill: async (skillId) => skillId === skill.id ? { ...skill } : null,
    updateSkill: async () => ({ ...skill }),
    deleteSkill: async () => undefined,
    selectedSkillInjections: async () => [{
      id: skill.id,
      name: skill.name,
      content: skill.content,
      mcpDependencies: skill.mcpDependencies,
      dependencyErrors: skill.dependencyErrors,
    }],
    setExtraRoots: async () => undefined,
    subscribeChanges: () => () => undefined,
  };
}

function memoryMcpStore(initial: RuntimeMcpServerInput[] = []): { inputs: RuntimeMcpServerInput[]; store: McpStore } {
  const inputs = initial.map((server) => ({ ...server }));
  const store = {
    listServers: async () => ({ configPath: '', workspaceConfigPaths: [], servers: [], errors: [] }),
    listServerInputs: async () => inputs.map((server) => ({ ...server })),
    upsertServer: async (input: RuntimeMcpServerInput) => {
      const index = inputs.findIndex((server) => server.key === input.key);
      if (index >= 0) inputs[index] = { ...input };
      else inputs.push({ ...input });
      return { configPath: '', workspaceConfigPaths: [], servers: [], errors: [] };
    },
    updateServer: async (key: string, patch: Partial<RuntimeMcpServerInput>) => {
      const index = inputs.findIndex((server) => server.key === key);
      if (index < 0) throw new Error(`Missing ${key}`);
      inputs[index] = { ...inputs[index], ...patch, key };
      return { configPath: '', workspaceConfigPaths: [], servers: [], errors: [] };
    },
    setToolApprovalMode: async () => ({ configPath: '', workspaceConfigPaths: [], servers: [], errors: [] }),
    deleteServer: async () => undefined,
  } satisfies McpStore;
  return { inputs, store };
}
