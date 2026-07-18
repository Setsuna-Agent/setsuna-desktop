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
  RuntimePluginReference,
} from '@setsuna-desktop/contracts';
import type {
  PluginSkillRegistry,
  SkillActivationContext,
  SkillInjection,
  SkillRegistry,
} from '../../ports/skill-registry.js';
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
  autoActivate: string[];
  plugin?: RuntimePluginReference;
};

type PluginSkillOrigin = {
  reference: RuntimePluginReference;
  description?: string;
  tags: string[];
};

type PluginIndexFile = { version: 1; plugins: InstalledPluginRecord[] };

const SKILL_CHANGE_DEBOUNCE_MS = 200;
const MAX_SKILL_AGENT_MANIFEST_BYTES = 128 * 1024;

export class FileSkillRegistry implements SkillRegistry, PluginSkillRegistry {
  private changeTimer: NodeJS.Timeout | undefined;
  private readonly changeSubscribers = new Set<() => void>();
  private extraSkillRoots: string[] = [];
  private readonly statePath: string;
  private readonly pluginIndexPath: string;
  private readonly userSkillsDir: string;
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly suspendedPluginRoots = new Map<string, number>();

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
      // 修改任一持久化文件前，先对两个文件完成规范化与校验。
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

  async selectedSkillInjections(skillIds: string[] = [], activation?: SkillActivationContext): Promise<SkillInjection[]> {
    const [skills, state] = await Promise.all([this.readSkills(), this.readState()]);
    const explicitSkillIds = new Set(skillIds.filter(Boolean));
    const allowAutomaticPluginActivation = explicitSkillIds.size === 0 && Boolean(activation?.text.trim());
    return skills
      .map((parsed) => ({ parsed, detail: toDetail(parsed, state) }))
      .filter(({ parsed, detail }) => detail.enabled && (
        detail.selected
        || explicitSkillIds.has(detail.id)
        || (allowAutomaticPluginActivation && pluginSkillMatchesActivation(parsed, activation?.text ?? ''))
      ))
      .map(({ parsed, detail }) => ({
        id: detail.id,
        name: detail.name,
        content: detail.content,
        path: detail.path,
        ...(parsed.plugin ? { plugin: { ...parsed.plugin } } : {}),
        mcpDependencies: detail.mcpDependencies,
        dependencyErrors: detail.dependencyErrors,
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

  beginPluginDirectoryMutation(pluginRoot: string): () => Promise<void> {
    const resolvedRoot = path.resolve(pluginRoot);
    this.suspendedPluginRoots.set(resolvedRoot, (this.suspendedPluginRoots.get(resolvedRoot) ?? 0) + 1);
    this.closeChangeWatchersWithin(resolvedRoot);
    let finished = false;
    return async () => {
      if (finished) return;
      finished = true;
      const remaining = (this.suspendedPluginRoots.get(resolvedRoot) ?? 1) - 1;
      if (remaining > 0) this.suspendedPluginRoots.set(resolvedRoot, remaining);
      else this.suspendedPluginRoots.delete(resolvedRoot);
      await this.refreshChangeWatchers().catch(() => undefined);
      this.queueChangeNotification();
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
      return parseSkill(entry.id, 'plugin', skillPath, content, dependencyManifest, {
        reference: {
          id: plugin.id,
          name: plugin.name,
          ...(plugin.icon ? { icon: plugin.icon } : {}),
        },
        description: plugin.description,
        tags: plugin.tags ?? [],
      });
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
      // The plugin transaction will queue a fresh notification after its index
      // and directory state agree again.
      if (this.suspendedPluginRoots.size) return;
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
      if (this.isWithinSuspendedPluginRoot(directory)) continue;
      if (this.watchers.has(directory)) continue;
      try {
        const watcher = watch(directory, { persistent: false }, () => this.queueChangeNotification());
        watcher.on('error', () => {
          watcher.close();
          this.watchers.delete(directory);
        });
        this.watchers.set(directory, watcher);
      } catch {
        // 接受缺失或暂时无法访问的 Skill 根目录；下次显式刷新时可重新发现它们。
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

  private closeChangeWatchersWithin(root: string): void {
    for (const [directory, watcher] of this.watchers.entries()) {
      if (!pathIsInside(root, directory)) continue;
      watcher.close();
      this.watchers.delete(directory);
    }
  }

  private isWithinSuspendedPluginRoot(directory: string): boolean {
    for (const root of this.suspendedPluginRoots.keys()) {
      if (pathIsInside(root, directory)) return true;
    }
    return false;
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
  pluginOrigin?: PluginSkillOrigin,
): ParsedSkill {
  const frontmatter = parseFrontmatter(rawContent);
  const content = frontmatter.body.trim();
  const name = frontmatter.name ?? id;
  const description = frontmatter.description;
  return {
    id,
    name,
    kind,
    description,
    content,
    path: skillPath,
    references: referencePaths(content),
    mcpDependencies: dependencyManifest.mcpDependencies,
    dependencyErrors: dependencyManifest.errors,
    autoActivate: pluginOrigin
      ? uniqueStrings([
          ...frontmatter.autoActivate,
          ...inferredPluginActivationKeywords(id, name, description, pluginOrigin),
        ])
      : [],
    ...(pluginOrigin ? { plugin: { ...pluginOrigin.reference } } : {}),
  };
}

function parseFrontmatter(rawContent: string): { name?: string; description?: string; autoActivate: string[]; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(rawContent);
  if (!match) return { autoActivate: [], body: rawContent };
  const block = match[1];
  const body = rawContent.slice(match[0].length);
  try {
    const fields = recordValue(parseYaml(block, { maxAliasCount: 0, uniqueKeys: true }));
    return {
      name: optionalString(fields.name),
      description: optionalString(fields.description),
      autoActivate: frontmatterStringArray(fields.autoActivate ?? fields.auto_activate ?? fields['auto-activate']),
      body,
    };
  } catch {
    // 可选的 frontmatter 块格式错误时，不能让其他内容仍可读取的 Skill 消失。
    return {
      autoActivate: [],
      body,
    };
  }
}

function frontmatterStringArray(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function inferredPluginActivationKeywords(
  skillId: string,
  skillName: string,
  description: string | undefined,
  pluginOrigin: PluginSkillOrigin,
): string[] {
  const plugin = pluginOrigin.reference;
  const metadataPhrases = [skillName, plugin.name, ...pluginOrigin.tags]
    .filter(meaningfulActivationPhrase);
  const identityPhrases = [skillId.split('.').at(-1), plugin.id];
  const highSignalNameTerms = latinTerms(`${skillName} ${plugin.name}`).filter((term) =>
    highSignalLatinTerm(term, 3),
  );
  const highSignalDescriptionTerms = latinTerms(
    [description, pluginOrigin.description].filter(Boolean).join(' '),
  ).filter((term) => highSignalLatinTerm(term, 4));
  return uniqueStrings([
    ...metadataPhrases,
    ...identityPhrases,
    ...highSignalNameTerms,
    ...highSignalDescriptionTerms,
  ]);
}

function highSignalLatinTerm(term: string, acronymMinLength: number): boolean {
  return /\d/u.test(term)
    || (term.length >= acronymMinLength && term === term.toUpperCase())
    || (term.length >= 4 && /[A-Z].*[A-Z]/u.test(term));
}

function meaningfulActivationPhrase(value: string | undefined): value is string {
  const normalized = value?.normalize('NFKC').trim();
  if (!normalized) return false;
  const cjkLength = [...normalized].filter((character) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)).length;
  return cjkLength === 0 ? normalized.replace(/\s+/gu, '').length >= 3 : cjkLength >= 3;
}

function latinTerms(value: string): string[] {
  return value.match(/[A-Za-z][A-Za-z0-9.+#_-]{1,}/g) ?? [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.normalize('NFKC').trim();
    const key = normalized?.toLocaleLowerCase('en-US');
    if (!normalized || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function pluginSkillMatchesActivation(skill: ParsedSkill, activationText: string): boolean {
  if (skill.kind !== 'plugin' || !skill.autoActivate.length) return false;
  const text = activationText.normalize('NFKC').toLocaleLowerCase('en-US');
  return skill.autoActivate.some((keyword) => activationKeywordMatches(text, keyword));
}

function activationKeywordMatches(normalizedText: string, keyword: string): boolean {
  const normalizedKeyword = keyword.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (!normalizedKeyword) return false;
  if (!/^[a-z0-9][a-z0-9.+#_-]*$/u.test(normalizedKeyword)) return normalizedText.includes(normalizedKeyword);
  let index = normalizedText.indexOf(normalizedKeyword);
  while (index !== -1) {
    const before = normalizedText[index - 1] ?? '';
    const after = normalizedText[index + normalizedKeyword.length] ?? '';
    if (!/[a-z0-9]/u.test(before) && !/[a-z0-9]/u.test(after)) return true;
    index = normalizedText.indexOf(normalizedKeyword, index + normalizedKeyword.length);
  }
  return false;
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
    ...(skill.plugin ? { pluginId: skill.plugin.id } : {}),
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
  /** undefined 保留现有清单，null 则将其移除。 */
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
