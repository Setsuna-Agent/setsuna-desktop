import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppServerRpcError } from './errors.js';
import { recordInput, requiredRawString } from './input.js';

export type AppServerCommandSandboxInput = {
  permissionProfile?: unknown;
  sandboxPolicy?: unknown;
};

export type AppServerCommandSandboxCapability = {
  supported: boolean;
  provider: 'macos-seatbelt' | 'none';
  reason: string;
};

export type AppServerCommandSpawnSpec = {
  args: string[];
  command: string;
  sandboxed: boolean;
};

type AppServerCommandSandboxRuntimePolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'externalSandbox' }
  | { type: 'readOnly'; networkAccess: boolean }
  | { type: 'workspaceWrite'; networkAccess: boolean; writableRoots: string[] };

export function appServerCommandSpawnSpec(
  program: string,
  args: string[],
  params: AppServerCommandSandboxInput,
  cwd: string,
  capability = appServerCommandSandboxCapability(),
): AppServerCommandSpawnSpec {
  const profile = appServerCommandSandboxProfile(params, cwd, capability);
  if (!profile) return { command: program, args, sandboxed: false };
  return {
    command: '/usr/bin/sandbox-exec',
    args: ['-p', profile, program, ...args],
    sandboxed: true,
  };
}

export function appServerCommandSandboxProfile(
  params: AppServerCommandSandboxInput,
  cwd: string,
  capability = appServerCommandSandboxCapability(),
): string {
  const policy = appServerCommandSandboxRuntimePolicy(params, cwd);
  if (policy.type === 'dangerFullAccess' || policy.type === 'externalSandbox') return '';
  // A requested restriction must never silently degrade to an unsandboxed process.
  if (!capability.supported || capability.provider !== 'macos-seatbelt') {
    throw new AppServerRpcError(-32603, `OS sandbox is unavailable for command/exec: ${capability.reason || 'unsupported platform'}`);
  }

  const lines = ['(version 1)', '(allow default)'];
  if (!policy.networkAccess) lines.push('(deny network*)');
  if (policy.type === 'readOnly') {
    lines.push('(deny file-write*)');
    return lines.join('\n');
  }

  const writableRoots = [...new Set(policy.writableRoots.map((root) => path.resolve(cwd, root)))];
  lines.push(seatbeltDenyWritesOutsideRoots(writableRoots));
  return lines.join('\n');
}

function appServerCommandSandboxRuntimePolicy(
  params: AppServerCommandSandboxInput,
  cwd: string,
): AppServerCommandSandboxRuntimePolicy {
  if (params.permissionProfile !== undefined && params.permissionProfile !== null) {
    const profile = requiredRawString(params.permissionProfile, 'permissionProfile');
    if (profile === 'danger-full-access' || profile === ':danger-full-access') return { type: 'dangerFullAccess' };
    if (profile === 'read-only' || profile === ':read-only') return { type: 'readOnly', networkAccess: false };
    if (profile === 'workspace-write' || profile === ':workspace') {
      return { type: 'workspaceWrite', networkAccess: false, writableRoots: [cwd] };
    }
    throw new AppServerRpcError(-32602, 'permissionProfile must be :danger-full-access, :read-only, :workspace, danger-full-access, read-only, or workspace-write');
  }

  if (params.sandboxPolicy === undefined || params.sandboxPolicy === null) return { type: 'dangerFullAccess' };
  const policy = recordInput(params.sandboxPolicy);
  const type = requiredRawString(policy.type, 'sandboxPolicy.type');
  if (type === 'dangerFullAccess') return { type: 'dangerFullAccess' };
  if (type === 'externalSandbox') return { type: 'externalSandbox' };
  if (type === 'readOnly') return { type: 'readOnly', networkAccess: policy.networkAccess === true };
  if (type === 'workspaceWrite') {
    const writableRoots = Array.isArray(policy.writableRoots)
      ? policy.writableRoots.map((root, index) => {
          if (typeof root !== 'string' || !root.trim()) {
            throw new AppServerRpcError(-32602, `sandboxPolicy.writableRoots[${index}] must be a non-empty string`);
          }
          return root;
        })
      : [cwd];
    return { type: 'workspaceWrite', networkAccess: policy.networkAccess === true, writableRoots };
  }
  throw new AppServerRpcError(-32602, 'sandboxPolicy.type must be dangerFullAccess, externalSandbox, readOnly, or workspaceWrite');
}

function appServerCommandSandboxCapability(): AppServerCommandSandboxCapability {
  if (process.platform !== 'darwin') {
    return { supported: false, provider: 'none', reason: `unsupported platform: ${process.platform}` };
  }
  if (!existsSync('/usr/bin/sandbox-exec')) {
    return { supported: false, provider: 'macos-seatbelt', reason: '/usr/bin/sandbox-exec is not available' };
  }
  return { supported: true, provider: 'macos-seatbelt', reason: '' };
}

function seatbeltDenyWritesOutsideRoots(roots: string[]): string {
  const filters = roots.map((root) => `(require-not (subpath ${seatbeltString(path.resolve(root))}))`);
  if (!filters.length) return '(deny file-write*)';
  if (filters.length === 1) return `(deny file-write* ${filters[0]})`;
  return `(deny file-write* (require-all ${filters.join(' ')}))`;
}

function seatbeltString(value: string): string {
  return JSON.stringify(value);
}
