import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeSkillDetail, RuntimeSkillInput, RuntimeSkillKind, RuntimeSkillList, RuntimeSkillPatch, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import type { SkillInjection, SkillRegistry } from '../../ports/skill-registry.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';

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
};

export class FileSkillRegistry implements SkillRegistry {
  private readonly statePath: string;
  private readonly userSkillsDir: string;

  constructor(
    private readonly builtinSkillsDir: string,
    dataDir: string,
  ) {
    this.statePath = path.join(dataDir, 'skills.json');
    this.userSkillsDir = path.join(dataDir, 'user-skills');
  }

  async listSkills(): Promise<RuntimeSkillList> {
    const [skills, state] = await Promise.all([this.readSkills(), this.readState()]);
    return {
      skills: skills.map((skill) => toSummary(skill, state)),
    };
  }

  async createSkill(input: RuntimeSkillInput): Promise<RuntimeSkillDetail> {
    const id = skillId(input.id || input.name);
    if (!id) throw new Error('Skill id is required');
    const existing = await this.readSkills();
    if (existing.some((skill) => skill.id === id)) throw new Error(`Skill already exists: ${id}`);
    const skillPath = await this.writeUserSkill(id, input);
    const state = await this.readState();
    state.states[id] = {
      enabled: input.enabled ?? true,
      selected: input.selected ?? false,
    };
    await this.writeState(state);
    const content = await readFile(skillPath, 'utf8');
    return toDetail(parseSkill(id, 'user', skillPath, content), state);
  }

  async getSkill(skillId: string): Promise<RuntimeSkillDetail | null> {
    const [skills, state] = await Promise.all([this.readSkills(), this.readState()]);
    const skill = skills.find((item) => item.id === skillId);
    return skill ? toDetail(skill, state) : null;
  }

  async updateSkill(skillId: string, patch: RuntimeSkillPatch): Promise<RuntimeSkillDetail> {
    const skills = await this.readSkills();
    const skill = skills.find((item) => item.id === skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    const contentPatch = patch.name !== undefined || patch.description !== undefined || patch.content !== undefined;
    if (contentPatch && skill.kind !== 'user') throw new Error(`Built-in skill is read-only: ${skillId}`);

    const state = await this.readState();
    state.states[skillId] = {
      ...state.states[skillId],
      enabled: patch.enabled ?? state.states[skillId]?.enabled,
      selected: patch.selected ?? state.states[skillId]?.selected,
    };
    await this.writeState(state);
    if (!contentPatch) return toDetail(skill, state);

    const nextInput: RuntimeSkillInput = {
      name: patch.name ?? skill.name,
      description: patch.description ?? skill.description,
      content: patch.content ?? skill.content,
      enabled: state.states[skillId]?.enabled,
      selected: state.states[skillId]?.selected,
    };
    const skillPath = await this.writeUserSkill(skillId, nextInput);
    const content = await readFile(skillPath, 'utf8');
    return toDetail(parseSkill(skillId, 'user', skillPath, content), state);
  }

  async deleteSkill(skillId: string): Promise<void> {
    const skills = await this.readSkills();
    const skill = skills.find((item) => item.id === skillId);
    if (!skill) return;
    if (skill.kind !== 'user') throw new Error(`Built-in skill is read-only: ${skillId}`);
    await rm(path.join(this.userSkillsDir, skillId), { recursive: true, force: true });
    const state = await this.readState();
    delete state.states[skillId];
    await this.writeState(state);
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
      }));
  }

  private async readSkills(): Promise<ParsedSkill[]> {
    const [builtinSkills, userSkills] = await Promise.all([
      this.readSkillDirectory(this.builtinSkillsDir, 'builtin'),
      this.readSkillDirectory(this.userSkillsDir, 'user'),
    ]);
    return [...builtinSkills, ...userSkills].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async readSkillDirectory(directory: string, kind: RuntimeSkillKind): Promise<ParsedSkill[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const skillPath = path.join(directory, entry.name, 'SKILL.md');
          const content = await readFile(skillPath, 'utf8').catch(() => '');
          return content ? parseSkill(entry.name, kind, skillPath, content) : null;
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

  private async writeUserSkill(id: string, input: RuntimeSkillInput): Promise<string> {
    const skillPath = path.join(this.userSkillsDir, id, 'SKILL.md');
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, formatSkillMarkdown(input), 'utf8');
    return skillPath;
  }
}

function parseSkill(id: string, kind: RuntimeSkillKind, skillPath: string, rawContent: string): ParsedSkill {
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
  };
}

function toDetail(skill: ParsedSkill, state: SkillStateFile): RuntimeSkillDetail {
  return {
    ...toSummary(skill, state),
    content: skill.content,
    references: skill.references,
  };
}
