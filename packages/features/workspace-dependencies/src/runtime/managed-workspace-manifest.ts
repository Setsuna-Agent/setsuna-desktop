import type {
  RuntimeWorkspaceDependencySource,
  RuntimeWorkspaceDependencyToolStatus,
} from '../contracts/index.js';
import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  runManagedWorkspaceCommand as runCommand,
  type ManagedWorkspaceCommandResult as CommandResult,
} from './managed-workspace-command.js';

export type ManagedToolManifest = {
  path: string;
  source: RuntimeWorkspaceDependencySource;
  version: string;
};

export type WorkspaceDependencyManifest = {
  bundleVersion: string;
  node: ManagedToolManifest;
  python: ManagedToolManifest;
  updatedAt: string;
  uv: ManagedToolManifest;
};

export type WorkspaceDependencyVersionRequirements = Partial<
  Record<'node' | 'python' | 'uv', (version: string) => boolean>
>;

export function unavailableTool(): RuntimeWorkspaceDependencyToolStatus {
  return { available: false };
}

export function manifestToolStatus(tool: ManagedToolManifest): RuntimeWorkspaceDependencyToolStatus {
  return { available: true, path: tool.path, source: tool.source, version: tool.version };
}

export async function checkedToolStatus(
  tool: ManagedToolManifest,
  args: string[],
  versionSupported: (version: string) => boolean = () => true,
): Promise<RuntimeWorkspaceDependencyToolStatus> {
  const result = await runCommand(tool.path, args, tool.source === 'bundled' ? {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  } : undefined).catch(() => null);
  const version = result ? versionText(result) || tool.version : tool.version;
  return {
    available: result?.exitCode === 0 && versionSupported(version),
    path: tool.path,
    source: tool.source,
    version,
  };
}

export function toolCheck(
  id: 'node' | 'python' | 'uv',
  label: string,
  tool: RuntimeWorkspaceDependencyToolStatus,
  unavailableMessage: string,
) {
  return {
    id,
    label,
    message: tool.available
      ? `${tool.version ?? '版本未知'} · ${sourceLabel(tool.source)} · ${tool.path ?? '路径未知'}`
      : unavailableMessage,
    status: tool.available ? 'ok' as const : 'error' as const,
  };
}

export async function manifestIsUsable(
  manifest: WorkspaceDependencyManifest,
  requirements: WorkspaceDependencyVersionRequirements = {},
): Promise<boolean> {
  const results = await Promise.all([
    checkedToolStatus(manifest.node, ['--version'], requirements.node),
    checkedToolStatus(manifest.python, ['--version'], requirements.python),
    checkedToolStatus(manifest.uv, ['--version'], requirements.uv),
  ]);
  return results.every((tool) => tool.available);
}

export function relocateManagedTool(
  tool: ManagedToolManifest,
  fromRoot: string,
  toRoot: string,
): ManagedToolManifest {
  return {
    ...tool,
    path: tool.source === 'managed' ? relocatePath(tool.path, fromRoot, toRoot) : tool.path,
  };
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function versionText(result: CommandResult): string {
  return (result.stdout || result.stderr).trim().split(/\r?\n/u)[0] ?? '';
}

export function versionAtLeast(version: string, minimum: readonly [number, number]): boolean {
  const match = version.match(/(\d+)\.(\d+)/u);
  if (!match) return false;
  const current = [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)] as const;
  return current[0] > minimum[0] || (current[0] === minimum[0] && current[1] >= minimum[1]);
}

export function versionMajor(value: string): number {
  return semanticVersionParts(value)?.[0] ?? 0;
}

export function commandFailure(result: CommandResult): string {
  return (result.stderr || result.stdout || `exit code ${String(result.exitCode)}`).trim().slice(0, 1200);
}

function sourceLabel(source: RuntimeWorkspaceDependencySource | undefined): string {
  if (source === 'system') return '复用本机';
  if (source === 'bundled') return '应用内置';
  return '应用托管';
}

function relocatePath(value: string, fromRoot: string, toRoot: string): string {
  const relative = path.relative(fromRoot, value);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? path.join(toRoot, relative)
    : value;
}

function semanticVersionParts(value: string): readonly [number, number, number] | null {
  const match = String(value || '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/u);
  return match
    ? [Number.parseInt(match[1], 10), Number.parseInt(match[2] ?? '0', 10), Number.parseInt(match[3] ?? '0', 10)]
    : null;
}
