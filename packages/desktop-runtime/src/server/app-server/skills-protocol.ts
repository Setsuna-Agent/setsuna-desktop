import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import path from 'node:path';
import type { RuntimeFactory } from '../types.js';
import { AppServerRpcError } from './errors.js';
import { recordInput, requiredString } from './input.js';

type AppServerSkillMetadata = {
  name: string;
  description: string;
  shortDescription?: string;
  interface?: {
    displayName?: string;
    shortDescription?: string;
  };
  path: string;
  scope: 'user' | 'repo' | 'system' | 'admin';
  enabled: boolean;
};

type AppServerSkillsListEntry = {
  cwd: string;
  skills: AppServerSkillMetadata[];
  errors: Array<{ path: string; message: string }>;
};

export async function appServerSkillsListResponse(
  runtime: RuntimeFactory,
  params: unknown,
): Promise<{ data: AppServerSkillsListEntry[] }> {
  const input = recordInput(params);
  const cwds = appServerSkillCwds(input.cwds);
  const skills = (await runtime.skillRegistry.listSkills()).skills.map(appServerSkillMetadata);
  return {
    data: cwds.map((cwd) => ({
      cwd,
      skills,
      errors: [],
    })),
  };
}

export async function appServerSkillsExtraRootsSetResponse(
  runtime: RuntimeFactory,
  params: unknown,
): Promise<Record<string, never>> {
  const input = recordInput(params);
  const roots = appServerSkillExtraRoots(input.extraRoots ?? input.extra_roots);
  await runtime.skillRegistry.setExtraRoots(roots);
  return {};
}

export async function appServerSkillsConfigWriteResponse(
  runtime: RuntimeFactory,
  params: unknown,
): Promise<{ effectiveEnabled: boolean }> {
  const input = recordInput(params);
  if (typeof input.enabled !== 'boolean') throw new AppServerRpcError(-32602, 'enabled must be a boolean');
  const selector = appServerSkillConfigSelector(input);
  const skills = (await runtime.skillRegistry.listSkills()).skills;
  const skill = await appServerSelectedSkill(skills, selector);
  if (!skill) throw new AppServerRpcError(-32600, 'No matching skill found');
  const updated = await runtime.skillRegistry.updateSkill(skill.id, { enabled: input.enabled });
  return { effectiveEnabled: updated.enabled };
}

function appServerSkillMetadata(skill: RuntimeSkillSummary): AppServerSkillMetadata {
  const description = skill.description ?? '';
  const metadata: AppServerSkillMetadata = {
    name: skill.name,
    description,
    path: skill.path ?? '',
    scope: skill.kind === 'user' ? 'user' : 'system',
    enabled: skill.enabled,
  };
  if (description) {
    metadata.shortDescription = description;
    metadata.interface = {
      displayName: skill.name,
      shortDescription: description,
    };
  }
  return metadata;
}

function appServerSkillCwds(value: unknown): string[] {
  if (value === undefined || value === null) return [process.cwd()];
  if (!Array.isArray(value)) throw new AppServerRpcError(-32602, 'cwds must be an array');
  const cwds = value.map((item, index) => {
    if (typeof item !== 'string') throw new AppServerRpcError(-32602, `cwds[${index}] must be a string`);
    return item || process.cwd();
  });
  return cwds.length ? cwds : [process.cwd()];
}

function appServerSkillExtraRoots(value: unknown): string[] {
  if (!Array.isArray(value)) throw new AppServerRpcError(-32602, 'extraRoots must be an array');
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new AppServerRpcError(-32602, `extraRoots[${index}] must be a string`);
    if (!path.isAbsolute(item)) throw new AppServerRpcError(-32602, `extraRoots[${index}] must be an absolute path`);
    return path.resolve(item);
  });
}

function appServerSkillConfigSelector(input: Record<string, unknown>): { name?: string; path?: string } {
  const rawPath = input.path;
  const rawName = input.name;
  const hasPath = rawPath !== undefined && rawPath !== null;
  const hasName = rawName !== undefined && rawName !== null;
  if (hasPath === hasName) throw new AppServerRpcError(-32602, 'skills/config/write requires exactly one of path or name');
  if (hasPath) {
    const skillPath = requiredString(rawPath, 'path');
    if (!path.isAbsolute(skillPath)) throw new AppServerRpcError(-32602, 'path must be an absolute path');
    return { path: path.resolve(skillPath) };
  }
  return { name: requiredString(rawName, 'name') };
}

async function appServerSelectedSkill(
  skills: RuntimeSkillSummary[],
  selector: { name?: string; path?: string },
): Promise<RuntimeSkillSummary | undefined> {
  if (selector.name) return skills.find((skill) => skill.name === selector.name || skill.id === selector.name);
  if (!selector.path) return undefined;
  const target = comparableSkillPath(selector.path);
  for (const skill of skills) {
    if (!skill.path) continue;
    if (comparableSkillPath(skill.path) === target) return skill;
  }
  return undefined;
}

function comparableSkillPath(value: string): string {
  return path.resolve(value);
}
