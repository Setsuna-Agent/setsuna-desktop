import type {
  RuntimeMcpServerInput,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillMcpDependency,
  RuntimeSkillMcpDependencyInput,
  RuntimeSkillMcpDependencyInstallResult,
  RuntimeSkillPatch,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import type { McpClientRuntime } from '../../ports/mcp-client-runtime.js';
import type { McpStore } from '../../ports/mcp-store.js';
import type { SkillActivationContext, SkillInjection, SkillMcpDependencyManager, SkillRegistry } from '../../ports/skill-registry.js';

type SkillMcpClient = Pick<McpClientRuntime, 'authStatus' | 'invalidateServer' | 'login'>;

/** 将声明式 Skill 元数据与实时 MCP 安装及认证状态结合。 */
export class SkillMcpDependencyCoordinator implements SkillRegistry, SkillMcpDependencyManager {
  constructor(
    private readonly skills: SkillRegistry,
    private readonly mcpStore: McpStore,
    private readonly mcpClient: SkillMcpClient,
  ) {}

  async listSkills(): Promise<RuntimeSkillList> {
    const [list, servers] = await Promise.all([this.skills.listSkills(), this.mcpStore.listServerInputs()]);
    return { skills: await Promise.all(list.skills.map((skill) => this.enrichSkill(skill, servers))) };
  }

  async createSkill(input: RuntimeSkillInput): Promise<RuntimeSkillDetail> {
    return this.enrichSkill(await this.skills.createSkill(input));
  }

  async getSkill(skillId: string): Promise<RuntimeSkillDetail | null> {
    const skill = await this.skills.getSkill(skillId);
    return skill ? this.enrichSkill(skill) : null;
  }

  async updateSkill(skillId: string, patch: RuntimeSkillPatch): Promise<RuntimeSkillDetail> {
    return this.enrichSkill(await this.skills.updateSkill(skillId, patch));
  }

  deleteSkill(skillId: string): Promise<void> {
    return this.skills.deleteSkill(skillId);
  }

  async selectedSkillInjections(skillIds?: string[], activation?: SkillActivationContext): Promise<SkillInjection[]> {
    const [injections, servers] = await Promise.all([
      this.skills.selectedSkillInjections(skillIds, activation),
      this.mcpStore.listServerInputs(),
    ]);
    return Promise.all(injections.map(async (skill) => ({
      ...skill,
      mcpDependencies: await this.resolveDependencies(skill.mcpDependencies ?? [], servers),
    })));
  }

  setExtraRoots(extraRoots: string[]): Promise<void> {
    return this.skills.setExtraRoots(extraRoots);
  }

  subscribeChanges(listener: () => void): () => void {
    return this.skills.subscribeChanges(listener);
  }

  async installMcpDependencies(skillId: string): Promise<RuntimeSkillMcpDependencyInstallResult> {
    const skill = await this.requiredSkill(skillId);
    if (skill.dependencyErrors?.length) {
      throw new Error(`Skill '${skill.id}' has invalid MCP dependencies: ${skill.dependencyErrors.join(' ')}`);
    }
    const dependencies = skill.mcpDependencies ?? [];
    if (!dependencies.length) throw new Error(`Skill '${skill.id}' does not declare MCP dependencies.`);
    const installed: string[] = [];
    const enabled: string[] = [];
    let servers = await this.mcpStore.listServerInputs();

    // 应用变更前先校验完整依赖集合，防止后续键冲突导致先前服务器只完成部分安装。
    for (const dependency of dependencies) {
      const existing = servers.find((server) => server.key === dependency.value);
      if (existing && !compatibleDependency(existing, dependency)) {
        throw new Error(`Skill '${skill.id}' requires MCP '${dependency.value}', but an incompatible server already uses that key.`);
      }
    }

    for (const dependency of dependencies) {
      const existing = servers.find((server) => server.key === dependency.value);
      if (!existing) {
        await this.mcpStore.upsertServer(serverInputFromDependency(dependency));
        installed.push(dependency.value);
      } else {
        const patch = dependencyPatch(existing, dependency);
        if (Object.keys(patch).length) {
          await this.mcpStore.updateServer(existing.key, patch);
          if (existing.enabled === false) enabled.push(existing.key);
        }
      }
      await this.mcpClient.invalidateServer(dependency.value);
      servers = await this.mcpStore.listServerInputs();
    }

    return {
      skill: await this.requiredSkill(skillId, true),
      installed,
      enabled,
    };
  }

  async authenticateMcpDependency(skillId: string, serverKey: string): Promise<RuntimeSkillDetail> {
    const skill = await this.requiredSkill(skillId);
    const dependency = skill.mcpDependencies?.find((item) => item.value === serverKey);
    if (!dependency) throw new Error(`Skill '${skill.id}' does not declare MCP dependency '${serverKey}'.`);
    const server = (await this.mcpStore.listServerInputs()).find((item) => item.key === serverKey);
    if (!server) throw new Error(`MCP dependency '${serverKey}' is not installed.`);
    if (!compatibleDependency(server, dependency)) throw new Error(`MCP dependency '${serverKey}' conflicts with the installed server.`);
    if (server.enabled === false) await this.mcpStore.updateServer(server.key, { enabled: true });
    const current = (await this.mcpStore.listServerInputs()).find((item) => item.key === serverKey) ?? server;
    await this.mcpClient.login(current);
    return this.requiredSkill(skillId, true);
  }

  private async requiredSkill(skillId: string, enriched = false): Promise<RuntimeSkillDetail> {
    const skill = await this.skills.getSkill(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    return enriched ? this.enrichSkill(skill) : skill;
  }

  private async enrichSkill<T extends RuntimeSkillSummary>(skill: T, servers?: RuntimeMcpServerInput[]): Promise<T> {
    const liveServers = servers ?? await this.mcpStore.listServerInputs();
    return {
      ...skill,
      mcpDependencies: await this.resolveDependencies(skill.mcpDependencies ?? [], liveServers),
      dependencyErrors: [...(skill.dependencyErrors ?? [])],
    };
  }

  private resolveDependencies(
    dependencies: RuntimeSkillMcpDependency[],
    servers: RuntimeMcpServerInput[],
  ): Promise<RuntimeSkillMcpDependency[]> {
    return Promise.all(dependencies.map(async (dependency) => {
      const server = servers.find((candidate) => candidate.key === dependency.value);
      if (!server) return { ...dependency, status: 'missing' };
      if (!compatibleDependency(server, dependency)) {
        return { ...dependency, status: 'conflict', error: 'An incompatible MCP server already uses this key.' };
      }
      if (server.enabled === false) return { ...dependency, status: 'disabled' };
      const auth = await this.mcpClient.authStatus(server).catch((error) => ({ status: 'oAuthError' as const, error: errorMessage(error) }));
      if (auth.status === 'notLoggedIn' || auth.status === 'oAuthExpired' || auth.status === 'oAuthLoggingIn') {
        return { ...dependency, status: 'authRequired', authStatus: auth.status, ...(auth.error ? { error: auth.error } : {}) };
      }
      if (auth.status === 'oAuthError') {
        return { ...dependency, status: 'error', authStatus: auth.status, error: auth.error ?? 'MCP OAuth failed.' };
      }
      return { ...dependency, status: 'ready', authStatus: auth.status };
    }));
  }
}

function serverInputFromDependency(dependency: RuntimeSkillMcpDependencyInput): RuntimeMcpServerInput {
  return {
    key: dependency.value,
    label: dependency.label ?? dependency.value,
    description: dependency.description,
    transport: dependency.transport,
    ...(dependency.transport === 'streamableHttp'
      ? { url: dependency.url }
      : { command: dependency.command, args: dependency.args ?? [] }),
    ...(dependency.oauthClientId ? { oauthClientId: dependency.oauthClientId } : {}),
    ...(dependency.oauthResource ? { oauthResource: dependency.oauthResource } : {}),
    enabled: true,
    required: false,
    requireApproval: 'always',
    trustLevel: 'untrusted',
  };
}

function dependencyPatch(
  existing: RuntimeMcpServerInput,
  dependency: RuntimeSkillMcpDependencyInput,
): Partial<Omit<RuntimeMcpServerInput, 'key'>> {
  return {
    ...(existing.enabled === false ? { enabled: true } : {}),
    ...(!existing.label && dependency.label ? { label: dependency.label } : {}),
    ...(!existing.description && dependency.description ? { description: dependency.description } : {}),
    ...(!existing.oauthClientId && dependency.oauthClientId ? { oauthClientId: dependency.oauthClientId } : {}),
    ...(!existing.oauthResource && dependency.oauthResource ? { oauthResource: dependency.oauthResource } : {}),
  };
}

function compatibleDependency(server: RuntimeMcpServerInput, dependency: RuntimeSkillMcpDependencyInput): boolean {
  if (normalizedTransport(server) !== dependency.transport) return false;
  if (dependency.transport === 'streamableHttp') {
    return comparableUrl(server.url) === comparableUrl(dependency.url);
  }
  return server.command?.trim() === dependency.command?.trim()
    && arraysEqual(server.args ?? [], dependency.args ?? []);
}

function normalizedTransport(server: RuntimeMcpServerInput): 'stdio' | 'streamableHttp' {
  if (server.transport) return server.transport;
  return server.command ? 'stdio' : 'streamableHttp';
}

function comparableUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return value.trim().replace(/\/$/u, '');
  }
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
