import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillKind,
  RuntimeSkillList,
  RuntimeSkillMcpDependency,
  RuntimeSkillMcpDependencyInput,
  RuntimeSkillPatch,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import type { SkillInjection, SkillRegistry } from '../../ports/skill-registry.js';
import type { InstalledPluginRecord } from '../../ports/plugin-bundle-store.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { readJsonFile, writeJsonFile, writeTextFile } from '../store/json-file.js';

type SkillStateFile = {
  version: 1;
  states: Record<string, { enabled?: boolean; selected?: boolean }>;
};

type ParsedSkill = {
  id: string;
  name: string;
  kind: RuntimeSkillKind;
  description?: string;
  content: string;
  path: string;
  references: string[];
  mcpDependencies: RuntimeSkillMcpDependency[];
  dependencyErrors: string[];
  pluginId?: string;
};

type PluginIndexFile = { version: 1; plugins: InstalledPluginRecord[] };

const SKILL_CHANGE_DEBOUNCE_MS = 200;
const MAX_SKILL_AGENT_MANIFEST_BYTES = 128 * 1024;

export class FileSkillRegistry implements SkillRegistry {
  private changeTimer: NodeJS.Timeout | undefined;
  private readonly changeSubscribers = new Set<() => void>();
  private extraSkillRoots: string[] = [];
  private readonly statePath: string;
  private readonly pluginIndexPath: string;
  private readonly userSkillsDir: string;
  private readonly watchers = new Map<string, FSWatcher>();

  constructor(
    private readonly builtinSkillsDir: string,
    dataDir: string,
  ) {
    this.statePath = path.join(dataDir, 'skills.json');
    this.pluginIndexPath = path.join(dataDir, 'plugins.json');
    this.userSkillsDir = path.join(dataDir, 'user-skills');
  }

  async listSkills(): Promise<RuntimeSkillList> {
    const [skills, state] = await Promise.all([this.readSkills(), this.readState()]);
    return {
      skills: skills.map((skill) => toSummary(skill, state)),
    };
  }

  async createSkill(input: RuntimeSkillInput): Promise<RuntimeSkillDetail> {
    return withFileStateUpdate(this.statePath, async () => {
      const id = skillId(input.id || input.name);
      if (!id) throw new Error('Skill id is required');
      const existing = await this.readSkills();
      if (existing.some((skill) => skill.id === id)) throw new Error(`Skill already exists: ${id}`);
      const preparedFiles = prepareUserSkillFiles(input);
      const state = await this.readState();
      state.states[id] = {
        enabled: input.enabled ?? true,
        selected: input.selected ?? false,
      };
      await this.writeState(state);
      const skillPath = await this.writeUserSkill(id, preparedFiles);
      const content = await readFile(skillPath, 'utf8');
      const dependencyManifest = await readSkillDependencyManifest(skillPath);
      this.queueChangeNotification();
      return toDetail(parseSkill(id, 'user', skillPath, content, dependencyManifest), state);
    });
  }

  async getSkill(skillId: string): Promise<RuntimeSkillDetail | null> {
    const [skills, state] = await Promise.all([this.readSkills(), this.readState()]);
    const skill = skills.find((item) => item.id === skillId);
    return skill ? toDetail(skill, state) : null;
  }

  async updateSkill(skillId: string, patch: RuntimeSkillPatch): Promise<RuntimeSkillDetail> {
    return withFileStateUpdate(this.statePath, async () => {
      const skills = await this.readSkills();
      const skill = skills.find((item) => item.id === skillId);
      if (!skill) throw new Error(`Skill not found: ${skillId}`);
      const contentPatch = patch.name !== undefined
        || patch.description !== undefined
        || patch.content !== undefined
        || patch.mcpDependencies !== undefined;
      if (contentPatch && skill.kind !== 'user') throw readOnlySkillError(skill.kind, skillId);

      const state = await this.readState();
      state.states[skillId] = {
        ...state.states[skillId],
        enabled: patch.enabled ?? state.states[skillId]?.enabled,
        selected: patch.selected ?? state.states[skillId]?.selected,
      };
      if (!contentPatch) {
        await this.writeState(state);
        this.queueChangeNotification();
        return toDetail(skill, state);
      }

      const nextInput: RuntimeSkillInput = {
        name: patch.name ?? skill.name,
        description: patch.description ?? skill.description,
        content: patch.content ?? skill.content,
        mcpDependencies: patch.mcpDependencies ?? skill.mcpDependencies.map(dependencyInput),
        enabled: state.states[skillId]?.enabled,
        selected: state.states[skillId]?.selected,
      };
      // Normalize and validate both files before changing either persisted file.
      const preparedFiles = prepareUserSkillFiles(nextInput);
      await this.writeState(state);
      const skillPath = await this.writeUserSkill(skillId, preparedFiles);
      const content = await readFile(skillPath, 'utf8');
      const dependencyManifest = await readSkillDependencyManifest(skillPath);
      this.queueChangeNotification();
      return toDetail(parseSkill(skillId, 'user', skillPath, content, dependencyManifest), state);
    });
  }

  async deleteSkill(skillId: string): Promise<void> {
    await withFileStateUpdate(this.statePath, async () => {
      const skills = await this.readSkills();
      const skill = skills.find((item) => item.id === skillId);
      if (!skill) return;
      if (skill.kind !== 'user') throw readOnlySkillError(skill.kind, skillId);
      await rm(path.join(this.userSkillsDir, skillId), { recursive: true, force: true });
      const state = await this.readState();
      delete state.states[skillId];
      await this.writeState(state);
      this.queueChangeNotification();
    });
  }

  async selectedSkillInjections(skillIds: string[] = []): Promise<SkillInjection[]> {
    const [skills, state] = await Promise.all([this.readSkills(), this.readState()]);
    const explicitSkillIds = new Set(skillIds.filter(Boolean));
    return skills
      .map((skill) => toDetail(skill, state))
      .filter((skill) => skill.enabled && (skill.selected || explicitSkillIds.has(skill.id)))
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        content: skill.content,
        path: skill.path,
        mcpDependencies: skill.mcpDependencies,
        dependencyErrors: skill.dependencyErrors,
      }));
  }

  async setExtraRoots(extraRoots: string[]): Promise<void> {
    this.extraSkillRoots = [...extraRoots];
    await this.refreshChangeWatchers();
    this.queueChangeNotification();
  }

  subscribeChanges(listener: () => void): () => void {
    this.changeSubscribers.add(listener);
    void this.refreshChangeWatchers();
    return () => {
      this.changeSubscribers.delete(listener);
      if (this.changeSubscribers.size === 0) this.closeChangeWatchers();
    };
  }

  private async readSkills(): Promise<ParsedSkill[]> {
    const [builtinSkills, userSkills, extraSkills, pluginSkills] = await Promise.all([
      this.readSkillDirectory(this.builtinSkillsDir, 'builtin'),
      this.readSkillDirectory(this.userSkillsDir, 'user'),
      Promise.all(this.extraSkillRoots.map((root) => this.readSkillDirectory(root, 'user'))).then((groups) => groups.flat()),
      this.readPluginSkills(),
    ]);
    return [...builtinSkills, ...userSkills, ...extraSkills, ...pluginSkills].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async readPluginSkills(): Promise<ParsedSkill[]> {
    const index = await readJsonFile<PluginIndexFile>(this.pluginIndexPath, { version: 1, plugins: [] });
    const skills = await Promise.all(index.plugins.flatMap((plugin) => plugin.skillEntries.map(async (entry) => {
      const pluginRoot = path.resolve(plugin.installPath);
      const skillPath = path.resolve(pluginRoot, entry.relativePath, 'SKILL.md');
      if (!pathIsInside(pluginRoot, skillPath)) return null;
      const content = await readFile(skillPath, 'utf8').catch(() => '');
      if (!content) return null;
      const dependencyManifest = await readSkillDependencyManifest(skillPath);
      return parseSkill(entry.id, 'plugin', skillPath, content, dependencyManifest, plugin.id);
    })));
    return skills.filter((skill): skill is ParsedSkill => Boolean(skill));
  }

  private async readSkillDirectory(directory: string, kind: RuntimeSkillKind): Promise<ParsedSkill[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const skillPath = path.join(directory, entry.name, 'SKILL.md');
          const content = await readFile(skillPath, 'utf8').catch(() => '');
          const dependencyManifest = content ? await readSkillDependencyManifest(skillPath) : emptyDependencyManifest();
          return content ? parseSkill(entry.name, kind, skillPath, content, dependencyManifest) : null;
        }),
    );
    return skills.filter((skill): skill is ParsedSkill => Boolean(skill));
  }

  private async readState(): Promise<SkillStateFile> {
    return readJsonFile<SkillStateFile>(this.statePath, { version: 1, states: {} });
  }

  private async writeState(state: SkillStateFile): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeJsonFile(this.statePath, state);
  }

  private async writeUserSkill(id: string, files: PreparedUserSkillFiles): Promise<string> {
    const skillPath = path.join(this.userSkillsDir, id, 'SKILL.md');
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeTextFile(skillPath, files.markdown);
    if (files.dependencyManifest !== undefined) {
      await writeSkillDependencyManifest(skillPath, files.dependencyManifest);
    }
    return skillPath;
  }

  private queueChangeNotification(): void {
    if (!this.changeSubscribers.size || this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      void this.refreshChangeWatchers();
      for (const subscriber of this.changeSubscribers) subscriber();
    }, SKILL_CHANGE_DEBOUNCE_MS);
    this.changeTimer.unref();
  }

  private async refreshChangeWatchers(): Promise<void> {
    if (!this.changeSubscribers.size) return;
    await mkdir(this.userSkillsDir, { recursive: true }).catch(() => undefined);
    const directories = new Set(await this.watchDirectories());
    for (const [directory, watcher] of this.watchers.entries()) {
      if (directories.has(directory)) continue;
      watcher.close();
      this.watchers.delete(directory);
    }
    for (const directory of directories) {
      if (this.watchers.has(directory)) continue;
      try {
        const watcher = watch(directory, { persistent: false }, () => this.queueChangeNotification());
        watcher.on('error', () => {
          watcher.close();
          this.watchers.delete(directory);
        });
        this.watchers.set(directory, watcher);
      } catch {
        // Missing or transiently inaccessible skill roots are accepted; the next explicit refresh can pick them up.
      }
    }
  }

  private async watchDirectories(): Promise<string[]> {
    const pluginIndex = await readJsonFile<PluginIndexFile>(this.pluginIndexPath, { version: 1, plugins: [] });
    const pluginRoots = pluginIndex.plugins.flatMap((plugin) => [
      plugin.installPath,
      ...plugin.skillEntries.map((entry) => path.join(plugin.installPath, entry.relativePath)),
    ]);
    const roots = [this.builtinSkillsDir, this.userSkillsDir, ...this.extraSkillRoots, ...pluginRoots].map((root) => path.resolve(root));
    const directories = new Set<string>();
    await Promise.all(roots.map(async (root) => {
      if (!await isDirectory(root)) return;
      directories.add(root);
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) directories.add(path.join(root, entry.name));
      }
    }));
    return [...directories];
  }

  private closeChangeWatchers(): void {
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
      this.changeTimer = undefined;
    }
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}

async function isDirectory(directory: string): Promise<boolean> {
  return stat(directory).then((stats) => stats.isDirectory(), () => false);
}

function parseSkill(
  id: string,
  kind: RuntimeSkillKind,
  skillPath: string,
  rawContent: string,
  dependencyManifest: SkillDependencyManifest,
  pluginId?: string,
): ParsedSkill {
  const frontmatter = parseFrontmatter(rawContent);
  const content = frontmatter.body.trim();
  return {
    id,
    name: frontmatter.fields.name ?? id,
    kind,
    description: frontmatter.fields.description,
    content,
    path: skillPath,
    references: referencePaths(content),
    mcpDependencies: dependencyManifest.mcpDependencies,
    dependencyErrors: dependencyManifest.errors,
    ...(pluginId ? { pluginId } : {}),
  };
}

function parseFrontmatter(rawContent: string): { fields: Record<string, string>; body: string } {
  if (!rawContent.startsWith('---\n')) return { fields: {}, body: rawContent };
  const endIndex = rawContent.indexOf('\n---', 4);
  if (endIndex === -1) return { fields: {}, body: rawContent };
  const block = rawContent.slice(4, endIndex);
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return {
    fields,
    body: rawContent.slice(endIndex + 4),
  };
}

function referencePaths(content: string): string[] {
  const matches = content.matchAll(/(?:file|path):\s*`([^`]+)`/gi);
  return [...matches].map((match) => match[1]);
}

function skillId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatSkillMarkdown(input: RuntimeSkillInput): string {
  const name = input.name.trim();
  const description = input.description?.trim();
  const frontmatter = ['---', `name: ${quoteYamlValue(name || 'Untitled Skill')}`];
  if (description) frontmatter.push(`description: ${quoteYamlValue(description)}`);
  frontmatter.push('---', '');
  return `${frontmatter.join('\n')}${input.content.trim()}\n`;
}

function quoteYamlValue(value: string): string {
  return JSON.stringify(value);
}

function toSummary(skill: ParsedSkill, state: SkillStateFile): RuntimeSkillSummary {
  const skillState = state.states[skill.id];
  return {
    id: skill.id,
    name: skill.name,
    kind: skill.kind,
    enabled: skillState?.enabled ?? true,
    selected: skillState?.selected ?? false,
    description: skill.description,
    path: skill.path,
    mcpDependencies: skill.mcpDependencies,
    dependencyErrors: skill.dependencyErrors,
    ...(skill.pluginId ? { pluginId: skill.pluginId } : {}),
  };
}

type SkillDependencyManifest = {
  mcpDependencies: RuntimeSkillMcpDependency[];
  errors: string[];
};

async function readSkillDependencyManifest(skillPath: string): Promise<SkillDependencyManifest> {
  const manifestPath = path.join(path.dirname(skillPath), 'agents', 'openai.yaml');
  const raw = await readFile(manifestPath, 'utf8').catch(() => '');
  if (!raw) return emptyDependencyManifest();
  if (Buffer.byteLength(raw, 'utf8') > MAX_SKILL_AGENT_MANIFEST_BYTES) {
    return { mcpDependencies: [], errors: [`${manifestPath}: manifest exceeds ${MAX_SKILL_AGENT_MANIFEST_BYTES} bytes.`] };
  }
  try {
    const parsed = parseYaml(raw, { maxAliasCount: 0, uniqueKeys: true });
    const root = recordValue(parsed);
    const dependencies = recordValue(root.dependencies);
    const tools = dependencies.tools;
    if (tools === undefined) return emptyDependencyManifest();
    if (!Array.isArray(tools)) return { mcpDependencies: [], errors: [`${manifestPath}: dependencies.tools must be an array.`] };
    const mcpDependencies: RuntimeSkillMcpDependency[] = [];
    const errors: string[] = [];
    tools.forEach((value, index) => {
      const input = recordValue(value);
      if (input.type !== 'mcp') return;
      try {
        mcpDependencies.push({ ...normalizeMcpDependency(input), status: 'unchecked' });
      } catch (error) {
        errors.push(`${manifestPath}: dependencies.tools[${index}] ${errorMessage(error)}`);
      }
    });
    return { mcpDependencies, errors };
  } catch (error) {
    return { mcpDependencies: [], errors: [`${manifestPath}: ${errorMessage(error)}`] };
  }
}

type PreparedUserSkillFiles = {
  markdown: string;
  /** Undefined preserves an existing manifest; null removes it. */
  dependencyManifest?: string | null;
};

function prepareUserSkillFiles(input: RuntimeSkillInput): PreparedUserSkillFiles {
  return {
    markdown: formatSkillMarkdown(input),
    ...(input.mcpDependencies !== undefined
      ? { dependencyManifest: serializeSkillDependencyManifest(input.mcpDependencies) }
      : {}),
  };
}

function serializeSkillDependencyManifest(dependencies: RuntimeSkillMcpDependencyInput[]): string | null {
  if (!dependencies.length) return null;
  const normalized = dependencies.map((dependency) => normalizeMcpDependency(dependency));
  const keys = new Set<string>();
  for (const dependency of normalized) {
    if (keys.has(dependency.value)) throw new Error(`Duplicate MCP dependency key: ${dependency.value}`);
    keys.add(dependency.value);
  }
  const tools = normalized.map(dependencyManifestValue);
  return stringifyYaml({ dependencies: { tools } }, { lineWidth: 0 });
}

async function writeSkillDependencyManifest(skillPath: string, content: string | null): Promise<void> {
  const agentsDir = path.join(path.dirname(skillPath), 'agents');
  const manifestPath = path.join(agentsDir, 'openai.yaml');
  if (content === null) {
    await rm(manifestPath, { force: true });
    return;
  }
  await mkdir(agentsDir, { recursive: true });
  await writeTextFile(manifestPath, content);
}

function normalizeMcpDependency(value: Record<string, unknown> | RuntimeSkillMcpDependencyInput): RuntimeSkillMcpDependencyInput {
  const input = value as Record<string, unknown>;
  const serverKey = normalizeMcpKey(stringValue(input.value));
  const transport = normalizeMcpDependencyTransport(input.transport, input.command, input.url);
  const dependency: RuntimeSkillMcpDependencyInput = {
    type: 'mcp',
    value: serverKey,
    transport,
    ...(optionalString(input.label) ? { label: optionalString(input.label) } : {}),
    ...(optionalString(input.description) ? { description: optionalString(input.description) } : {}),
    ...(optionalString(input.oauthClientId ?? input.oauth_client_id) ? { oauthClientId: optionalString(input.oauthClientId ?? input.oauth_client_id) } : {}),
    ...(optionalString(input.oauthResource ?? input.oauth_resource) ? { oauthResource: optionalString(input.oauthResource ?? input.oauth_resource) } : {}),
  };
  if (transport === 'streamableHttp') {
    const rawUrl = optionalString(input.url);
    if (!rawUrl) throw new Error('requires url for streamable_http transport.');
    dependency.url = safeSkillMcpUrl(rawUrl).toString();
  } else {
    const command = optionalString(input.command);
    if (!command) throw new Error('requires command for stdio transport.');
    dependency.command = command;
    dependency.args = stringArray(input.args, 'args');
  }
  return dependency;
}

function dependencyManifestValue(dependency: RuntimeSkillMcpDependencyInput): Record<string, unknown> {
  return {
    type: 'mcp',
    value: dependency.value,
    transport: dependency.transport === 'streamableHttp' ? 'streamable_http' : 'stdio',
    ...(dependency.label ? { label: dependency.label } : {}),
    ...(dependency.description ? { description: dependency.description } : {}),
    ...(dependency.url ? { url: dependency.url } : {}),
    ...(dependency.command ? { command: dependency.command } : {}),
    ...(dependency.args?.length ? { args: dependency.args } : {}),
    ...(dependency.oauthClientId ? { oauth_client_id: dependency.oauthClientId } : {}),
    ...(dependency.oauthResource ? { oauth_resource: dependency.oauthResource } : {}),
  };
}

function dependencyInput(dependency: RuntimeSkillMcpDependency): RuntimeSkillMcpDependencyInput {
  const { status: _status, authStatus: _authStatus, error: _error, ...input } = dependency;
  return input;
}

function normalizeMcpKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!key) throw new Error('requires a non-empty value.');
  return key;
}

function normalizeMcpDependencyTransport(transport: unknown, command: unknown, url: unknown): 'stdio' | 'streamableHttp' {
  if (transport === 'stdio') return 'stdio';
  if (transport === 'streamableHttp' || transport === 'streamable_http' || transport === 'streamable-http' || transport === 'http') {
    return 'streamableHttp';
  }
  if (typeof command === 'string' && command.trim()) return 'stdio';
  if (typeof url === 'string' && url.trim()) return 'streamableHttp';
  throw new Error('requires transport stdio or streamable_http.');
}

function safeSkillMcpUrl(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('URL must use HTTPS or loopback HTTP.');
  }
  if (url.username || url.password) throw new Error('URL cannot contain embedded credentials.');
  return url;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  return text || undefined;
}

function stringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${name} must be a string array.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyDependencyManifest(): SkillDependencyManifest {
  return { mcpDependencies: [], errors: [] };
}

function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readOnlySkillError(kind: RuntimeSkillKind, skillId: string): Error {
  return new Error(kind === 'builtin'
    ? `Built-in skill is read-only: ${skillId}`
    : `Plugin skill is read-only: ${skillId}`);
}

function toDetail(skill: ParsedSkill, state: SkillStateFile): RuntimeSkillDetail {
  return {
    ...toSummary(skill, state),
    content: skill.content,
    references: skill.references,
  };
}
