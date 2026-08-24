import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import {
  workspaceDependencySettingsCodec,
  workspaceDependencySettingsPatchCodec,
  type WorkspaceDependencySettingsPatch,
  type WorkspaceDependencySettingsState,
} from './settings.js';
import type {
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependencyToolStatus,
} from './types.js';

export type WorkspaceDependenciesSnapshot = Readonly<{
  settings: WorkspaceDependencySettingsState;
  status: RuntimeWorkspaceDependenciesStatus;
}>;

export type WorkspaceDependencySettingsUpdate = Readonly<{
  expectedRevision: number;
  patch: WorkspaceDependencySettingsPatch;
}>;

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined;
  throw new Error('Operation does not accept input.');
});

const settingsStateCodec = defineRuntimeCodec<WorkspaceDependencySettingsState>((value) => {
  const record = objectRecord(value, 'Workspace dependency settings state must be an object.');
  return Object.freeze({
    value: workspaceDependencySettingsCodec.parse(record.value),
    revision: nonNegativeInteger(record.revision, 'settings revision'),
  });
});

const settingsUpdateCodec = defineRuntimeCodec<WorkspaceDependencySettingsUpdate>((value) => {
  const record = objectRecord(value, 'Workspace dependency settings update must be an object.');
  return Object.freeze({
    expectedRevision: nonNegativeInteger(record.expectedRevision, 'expected revision'),
    patch: workspaceDependencySettingsPatchCodec.parse(record.patch ?? {}),
  });
});

const statusCodec = defineRuntimeCodec<RuntimeWorkspaceDependenciesStatus>((value) => {
  const record = objectRecord(value, 'Workspace dependency status must be an object.');
  if (!Array.isArray(record.checks)) throw new Error('Workspace dependency checks must be an array.');
  const state = record.state;
  if (state !== 'not-installed' && state !== 'installing' && state !== 'ready' && state !== 'error') {
    throw new Error('Workspace dependency state is invalid.');
  }
  return Object.freeze({
    bundleVersion: requiredText(record.bundleVersion, 'bundleVersion'),
    checks: Object.freeze(record.checks.map(check)),
    ...optionalText(record, 'error'),
    installPath: requiredText(record.installPath, 'installPath'),
    node: toolStatus(record.node),
    python: toolStatus(record.python),
    state,
    ...optionalText(record, 'updatedAt'),
    uv: toolStatus(record.uv),
  });
});

const snapshotCodec = defineRuntimeCodec<WorkspaceDependenciesSnapshot>((value) => {
  const record = objectRecord(value, 'Workspace dependencies snapshot must be an object.');
  return Object.freeze({
    settings: settingsStateCodec.parse(record.settings),
    status: statusCodec.parse(record.status),
  });
});

export const readWorkspaceDependencies = defineFeatureOperation({
  id: 'workspace-dependencies.read',
  method: 'GET',
  path: '/v1/features/workspace-dependencies',
  input: emptyInputCodec,
  output: snapshotCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'safe',
});

export const updateWorkspaceDependencySettings = defineFeatureOperation({
  id: 'workspace-dependencies.settings.update',
  method: 'PATCH',
  path: '/v1/features/workspace-dependencies/settings',
  input: settingsUpdateCodec,
  output: settingsStateCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'idempotent',
});

export const diagnoseWorkspaceDependencies = defineFeatureOperation({
  id: 'workspace-dependencies.diagnose',
  method: 'POST',
  path: '/v1/features/workspace-dependencies/diagnose',
  input: emptyInputCodec,
  output: statusCodec,
  errors: Object.freeze({ TOOLCHAIN_UNAVAILABLE: { status: 503 } }),
  idempotency: 'safe',
});

export const repairWorkspaceDependencies = defineFeatureOperation({
  id: 'workspace-dependencies.repair',
  method: 'POST',
  path: '/v1/features/workspace-dependencies/repair',
  input: emptyInputCodec,
  output: statusCodec,
  errors: Object.freeze({ TOOLCHAIN_UNAVAILABLE: { status: 503 } }),
  idempotency: 'idempotent',
});

function check(value: unknown) {
  const record = objectRecord(value, 'Workspace dependency check must be an object.');
  const id = record.id;
  const status = record.status;
  if (id !== 'node' && id !== 'python' && id !== 'uv' && id !== 'sandbox') {
    throw new Error('Workspace dependency check id is invalid.');
  }
  if (status !== 'ok' && status !== 'warning' && status !== 'error') {
    throw new Error('Workspace dependency check status is invalid.');
  }
  return Object.freeze({
    id,
    label: requiredText(record.label, 'check label'),
    message: requiredText(record.message, 'check message'),
    status,
  });
}

function toolStatus(value: unknown): RuntimeWorkspaceDependencyToolStatus {
  const record = objectRecord(value, 'Workspace dependency tool status must be an object.');
  if (typeof record.available !== 'boolean') throw new Error('Workspace dependency availability is invalid.');
  const source = record.source;
  if (source !== undefined && source !== 'system' && source !== 'managed' && source !== 'bundled') {
    throw new Error('Workspace dependency source is invalid.');
  }
  return Object.freeze({
    available: record.available,
    ...optionalText(record, 'path'),
    ...(source === undefined ? {} : { source }),
    ...optionalText(record, 'version'),
  });
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Workspace dependency ${label} is invalid.`);
  return value;
}

function optionalText(record: Record<string, unknown>, key: string): Record<string, string> {
  return typeof record[key] === 'string' ? { [key]: record[key] as string } : {};
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Workspace dependency ${label} is invalid.`);
  }
  return value as number;
}
