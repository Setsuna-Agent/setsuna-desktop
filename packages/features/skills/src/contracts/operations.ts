import type {
  RuntimeMcpAuthStatus,
  RuntimeMcpTransport,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillKind,
  RuntimeSkillList,
  RuntimeSkillMcpDependency,
  RuntimeSkillMcpDependencyInput,
  RuntimeSkillMcpDependencyInstallResult,
  RuntimeSkillMcpDependencyStatus,
  RuntimeSkillPatch,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';

export type SkillTarget = Readonly<{ skillId: string }>;
export type SkillUpdateInput = Readonly<{ skillId: string; patch: RuntimeSkillPatch }>;
export type SkillDependencyTarget = Readonly<{ skillId: string; serverKey: string }>;
export type SkillExtraRootsInput = Readonly<{ extraRoots: string[] }>;

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (isRecord(value) && !Object.keys(value).length) return undefined;
  throw new Error('Skill catalog does not accept input.');
});

const skillTargetCodec = defineRuntimeCodec<SkillTarget>((value) => {
  const record = objectRecord(value, 'Skill target must be an object.');
  return Object.freeze({ skillId: stableId(record.skillId, 'skillId') });
});

const skillDependencyTargetCodec = defineRuntimeCodec<SkillDependencyTarget>((value) => {
  const record = objectRecord(value, 'Skill dependency target must be an object.');
  return Object.freeze({
    serverKey: stableId(record.serverKey, 'serverKey'),
    skillId: stableId(record.skillId, 'skillId'),
  });
});

const skillInputCodec = defineRuntimeCodec<RuntimeSkillInput>((value) => (
  skillInput(objectRecord(value, 'Skill input must be an object.'))
));

const skillUpdateCodec = defineRuntimeCodec<SkillUpdateInput>((value) => {
  const record = objectRecord(value, 'Skill update must be an object.');
  return Object.freeze({
    patch: skillPatch(objectRecord(record.patch, 'Skill patch must be an object.')),
    skillId: stableId(record.skillId, 'skillId'),
  });
});

const skillExtraRootsCodec = defineRuntimeCodec<SkillExtraRootsInput>((value) => {
  const record = objectRecord(value, 'Skill extra roots input must be an object.');
  return Object.freeze({
    extraRoots: uniqueTextArray(record.extraRoots, 'extraRoots'),
  });
});

const skillListCodec = defineRuntimeCodec<RuntimeSkillList>((value) => {
  const record = objectRecord(value, 'Skill list must be an object.');
  return Object.freeze({
    skills: arrayValue(record.skills, 'skills').map(skillSummary),
  });
});

const skillDetailCodec = defineRuntimeCodec<RuntimeSkillDetail>((value) => {
  const record = objectRecord(value, 'Skill detail must be an object.');
  return Object.freeze({
    ...skillSummary(record),
    content: text(record.content, 'content'),
    references: stringArray(record.references, 'references'),
  });
});

const dependencyInstallResultCodec = defineRuntimeCodec<RuntimeSkillMcpDependencyInstallResult>((value) => {
  const record = objectRecord(value, 'Skill dependency install result must be an object.');
  return Object.freeze({
    enabled: stringArray(record.enabled, 'enabled'),
    installed: stringArray(record.installed, 'installed'),
    skill: skillDetailCodec.parse(record.skill),
  });
});

const mutationResultCodec = defineRuntimeCodec<Readonly<{ ok: true }>>((value) => {
  const record = objectRecord(value, 'Skill mutation result must be an object.');
  if (record.ok !== true) throw new Error('Skill mutation result is invalid.');
  return Object.freeze({ ok: true });
});

const skillOperationErrors = Object.freeze({
  SKILL_NOT_FOUND: Object.freeze({ status: 404 }),
  SKILL_OPERATION_FAILED: Object.freeze({ status: 500 }),
});

export const readSkills = defineFeatureOperation({
  id: 'skills.catalog.read',
  method: 'GET',
  path: '/v1/features/skills',
  input: emptyInputCodec,
  output: skillListCodec,
  errors: skillOperationErrors,
  idempotency: 'safe',
});

export const createSkill = defineFeatureOperation({
  id: 'skills.item.create',
  method: 'POST',
  path: '/v1/features/skills',
  input: skillInputCodec,
  output: skillDetailCodec,
  errors: skillOperationErrors,
  idempotency: 'non-idempotent',
});

export const readSkill = defineFeatureOperation({
  id: 'skills.item.read',
  method: 'GET',
  path: '/v1/features/skills/:skillId',
  input: skillTargetCodec,
  output: skillDetailCodec,
  errors: skillOperationErrors,
  idempotency: 'safe',
});

export const updateSkill = defineFeatureOperation({
  id: 'skills.item.update',
  method: 'PATCH',
  path: '/v1/features/skills/:skillId',
  input: skillUpdateCodec,
  output: skillDetailCodec,
  errors: skillOperationErrors,
  idempotency: 'idempotent',
});

export const deleteSkill = defineFeatureOperation({
  id: 'skills.item.delete',
  method: 'DELETE',
  path: '/v1/features/skills/:skillId',
  input: skillTargetCodec,
  output: mutationResultCodec,
  errors: skillOperationErrors,
  idempotency: 'idempotent',
});

export const installSkillMcpDependencies = defineFeatureOperation({
  id: 'skills.mcp-dependencies.install',
  method: 'POST',
  path: '/v1/features/skills/:skillId/mcp-dependencies/install',
  input: skillTargetCodec,
  output: dependencyInstallResultCodec,
  errors: skillOperationErrors,
  idempotency: 'idempotent',
});

export const authenticateSkillMcpDependency = defineFeatureOperation({
  id: 'skills.mcp-dependency.authenticate',
  method: 'POST',
  path: '/v1/features/skills/:skillId/mcp-dependencies/:serverKey/authenticate',
  input: skillDependencyTargetCodec,
  output: skillDetailCodec,
  errors: skillOperationErrors,
  idempotency: 'non-idempotent',
});

export const setSkillExtraRoots = defineFeatureOperation({
  id: 'skills.extra-roots.update',
  method: 'PUT',
  path: '/v1/features/skills/extra-roots',
  input: skillExtraRootsCodec,
  output: skillListCodec,
  errors: skillOperationErrors,
  idempotency: 'idempotent',
});

function skillInput(record: Record<string, unknown>): RuntimeSkillInput {
  return Object.freeze({
    ...(record.id === undefined ? {} : { id: stableId(record.id, 'id') }),
    name: nonEmptyText(record.name, 'name'),
    ...(record.description === undefined ? {} : { description: text(record.description, 'description') }),
    content: text(record.content, 'content'),
    ...(record.enabled === undefined ? {} : { enabled: booleanValue(record.enabled, 'enabled') }),
    ...(record.mcpDependencies === undefined
      ? {}
      : { mcpDependencies: arrayValue(record.mcpDependencies, 'mcpDependencies').map(skillDependencyInput) }),
  });
}

function skillPatch(record: Record<string, unknown>): RuntimeSkillPatch {
  const patch: RuntimeSkillPatch = {};
  assignOptional(patch, record, 'enabled', (value) => booleanValue(value, 'enabled'));
  assignOptional(patch, record, 'name', (value) => nonEmptyText(value, 'name'));
  assignOptional(patch, record, 'description', (value) => text(value, 'description'));
  assignOptional(patch, record, 'content', (value) => text(value, 'content'));
  assignOptional(patch, record, 'mcpDependencies', (value) => (
    arrayValue(value, 'mcpDependencies').map(skillDependencyInput)
  ));
  return Object.freeze(patch);
}

function skillSummary(value: unknown): RuntimeSkillSummary {
  const record = objectRecord(value, 'Skill summary must be an object.');
  return Object.freeze({
    id: stableId(record.id, 'id'),
    name: nonEmptyText(record.name, 'name'),
    kind: skillKind(record.kind),
    enabled: booleanValue(record.enabled, 'enabled'),
    ...optionalText(record, 'icon'),
    ...optionalText(record, 'contentVersion'),
    ...optionalText(record, 'description'),
    ...optionalText(record, 'path'),
    ...optionalText(record, 'pluginId'),
    ...(record.mcpDependencies === undefined
      ? {}
      : { mcpDependencies: arrayValue(record.mcpDependencies, 'mcpDependencies').map(skillDependency) }),
    ...(record.dependencyErrors === undefined
      ? {}
      : { dependencyErrors: stringArray(record.dependencyErrors, 'dependencyErrors') }),
  });
}

function skillDependencyInput(value: unknown): RuntimeSkillMcpDependencyInput {
  const record = objectRecord(value, 'Skill MCP dependency must be an object.');
  const transport = mcpTransport(record.transport);
  return Object.freeze({
    type: mcpDependencyType(record.type),
    value: stableId(record.value, 'dependency value'),
    transport,
    ...optionalText(record, 'label'),
    ...optionalText(record, 'description'),
    ...optionalText(record, 'url'),
    ...optionalText(record, 'command'),
    ...(record.args === undefined ? {} : { args: stringArray(record.args, 'args') }),
    ...optionalText(record, 'oauthClientId'),
    ...optionalText(record, 'oauthResource'),
  });
}

function skillDependency(value: unknown): RuntimeSkillMcpDependency {
  const record = objectRecord(value, 'Skill MCP dependency state must be an object.');
  return Object.freeze({
    ...skillDependencyInput(record),
    status: dependencyStatus(record.status),
    ...(record.authStatus === undefined ? {} : { authStatus: mcpAuthStatus(record.authStatus) }),
    ...optionalText(record, 'error'),
  });
}

function skillKind(value: unknown): RuntimeSkillKind {
  if (value === 'builtin' || value === 'plugin' || value === 'user') return value;
  throw new Error('Skill kind is invalid.');
}

function mcpDependencyType(value: unknown): 'mcp' {
  if (value === 'mcp') return value;
  throw new Error('Skill dependency type is invalid.');
}

function mcpTransport(value: unknown): RuntimeMcpTransport {
  if (value === 'stdio' || value === 'streamableHttp') return value;
  throw new Error('Skill dependency transport is invalid.');
}

function dependencyStatus(value: unknown): RuntimeSkillMcpDependencyStatus {
  if (
    value === 'unchecked'
    || value === 'missing'
    || value === 'disabled'
    || value === 'ready'
    || value === 'authRequired'
    || value === 'conflict'
    || value === 'error'
  ) return value;
  throw new Error('Skill dependency status is invalid.');
}

function mcpAuthStatus(value: unknown): RuntimeMcpAuthStatus {
  if (
    value === 'unsupported'
    || value === 'notLoggedIn'
    || value === 'bearerToken'
    || value === 'oAuth'
    || value === 'oAuthLoggingIn'
    || value === 'oAuthExpired'
    || value === 'oAuthError'
  ) return value;
  throw new Error('Skill dependency auth status is invalid.');
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Skill ${label} must be an array.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Skill ${label} must be text.`);
  return value;
}

function nonEmptyText(value: unknown, label: string): string {
  const result = text(value, label).trim();
  if (!result) throw new Error(`Skill ${label} is required.`);
  return result;
}

function stableId(value: unknown, label: string): string {
  const result = nonEmptyText(value, label);
  if (result.length > 512 || /[\\/\0]/u.test(result)) throw new Error(`Skill ${label} is invalid.`);
  return result;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Skill ${label} must be boolean.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return arrayValue(value, label).map((item) => text(item, label));
}

function uniqueTextArray(value: unknown, label: string): string[] {
  return [...new Set(stringArray(value, label).map((item) => item.trim()).filter(Boolean))];
}

function optionalText(record: Record<string, unknown>, key: string): Record<string, string> {
  return record[key] === undefined ? {} : { [key]: text(record[key], key) };
}

function assignOptional<T extends object, K extends keyof T>(
  target: T,
  source: Record<string, unknown>,
  key: K,
  parse: (value: unknown) => T[K],
): void {
  if (source[key as string] !== undefined) target[key] = parse(source[key as string]);
}
