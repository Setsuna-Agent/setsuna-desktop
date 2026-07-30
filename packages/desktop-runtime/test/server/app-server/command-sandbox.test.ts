import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appServerCommandSandboxProfile,
  appServerCommandSpawnSpec,
  type AppServerCommandSandboxCapability,
} from '../../../src/server/app-server/command-sandbox.js';

const seatbeltCapability: AppServerCommandSandboxCapability = {
  supported: true,
  provider: 'macos-seatbelt',
  reason: '',
};

const unavailableCapability: AppServerCommandSandboxCapability = {
  supported: false,
  provider: 'none',
  reason: 'unsupported platform: test',
};

describe('app-server command sandbox', () => {
  it('builds a workspace-write Seatbelt profile from resolved, deduplicated roots', () => {
    const cwd = path.join(tmpdir(), 'setsuna app-server command sandbox');
    const writableRoot = path.join('generated', 'assets');
    const profile = appServerCommandSandboxProfile({
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [writableRoot, writableRoot],
        networkAccess: false,
      },
    }, cwd, seatbeltCapability);

    const resolvedRootFilter = `(require-not (subpath ${JSON.stringify(path.resolve(cwd, writableRoot))}))`;
    expect(profile).toContain('(deny network*)');
    expect(profile).toContain('(deny file-write*');
    expect(profile.match(new RegExp(escapeRegExp(resolvedRootFilter), 'gu'))).toHaveLength(1);
  });

  it('normalizes upstream permission profile ids without requiring a local sandbox for full access', () => {
    const cwd = path.join(tmpdir(), 'setsuna app-server command profile');
    const profile = appServerCommandSandboxProfile({
      permissionProfile: ':workspace',
    }, cwd, seatbeltCapability);

    expect(profile).toContain('(deny network*)');
    expect(profile).toContain(`(require-not (subpath ${JSON.stringify(path.resolve(cwd))}))`);
    expect(appServerCommandSandboxProfile({
      permissionProfile: ':danger-full-access',
    }, cwd, unavailableCapability)).toBe('');
  });

  it('leaves danger-full-access and externalSandbox commands to the caller environment', () => {
    expect(appServerCommandSandboxProfile({}, process.cwd(), unavailableCapability)).toBe('');
    expect(appServerCommandSandboxProfile({
      sandboxPolicy: { type: 'externalSandbox', networkAccess: 'enabled' },
    }, process.cwd(), unavailableCapability)).toBe('');
  });

  it('fails closed when a requested restriction cannot be enforced', () => {
    expect(() => appServerCommandSandboxProfile({
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    }, process.cwd(), unavailableCapability)).toThrow('OS sandbox is unavailable');
  });

  it('wraps only locally enforced commands with sandbox-exec', () => {
    const cwd = process.cwd();
    const sandboxed = appServerCommandSpawnSpec(
      '/usr/bin/env',
      ['node', '--version'],
      { permissionProfile: ':read-only' },
      cwd,
      seatbeltCapability,
    );
    expect(sandboxed).toMatchObject({
      command: '/usr/bin/sandbox-exec',
      sandboxed: true,
    });
    expect(sandboxed.args[0]).toBe('-p');
    expect(sandboxed.args.slice(-3)).toEqual(['/usr/bin/env', 'node', '--version']);

    expect(appServerCommandSpawnSpec(
      '/usr/bin/env',
      ['node', '--version'],
      { permissionProfile: ':danger-full-access' },
      cwd,
      unavailableCapability,
    )).toEqual({
      command: '/usr/bin/env',
      args: ['node', '--version'],
      sandboxed: false,
    });
  });

  it('rejects malformed policy roots at the protocol boundary', () => {
    expect(() => appServerCommandSandboxProfile({
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [''],
      },
    }, process.cwd(), seatbeltCapability)).toThrow(
      'sandboxPolicy.writableRoots[0] must be a non-empty string',
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
