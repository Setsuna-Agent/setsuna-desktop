import type { RuntimeExecPolicyAmendment, RuntimeNetworkPolicyAmendment } from '@setsuna-desktop/contracts';
import type {
  RuntimeWorkspaceDependenciesStatus,
  WorkspaceDependenciesControl,
} from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect } from 'vitest';
import { PcLocalToolHost } from '../../../../src/adapters/tool/pc-local/pc-local-tool-host.js';
import { shellSandboxCapability, shellSandboxUnavailableReason } from '../../../../src/adapters/tool/pc-local/pc-local-tools.js';
import { FileWorkspaceProjectStore } from '../../../../src/adapters/workspace/file-workspace-project-store.js';
import { systemClock } from '../../../../src/ports/clock.js';
import type { PolicyAmendmentStore, RuntimePolicyAmendments } from '../../../../src/ports/policy-amendment-store.js';

export const execFileAsync = promisify(execFile);

export const restrictedShellExecutionUnavailable = Boolean(shellSandboxUnavailableReason({
  osSandbox: true,
  permissionProfile: 'workspace-write',
}));

export async function expectRestrictedShellUnavailable(execution: Promise<unknown>): Promise<void> {
  await expect(execution).rejects.toMatchObject({
    failureKind: 'sandbox_unavailable',
    failureStage: 'preflight',
  });
}

export async function createHost(options: {
  fixtureRootParent?: string;
  policyAmendmentStore?: PolicyAmendmentStore;
  projectDirName?: string;
  shellSandboxCapability?: () => ReturnType<typeof shellSandboxCapability>;
  workspaceDependencies?: WorkspaceDependenciesControl;
} = {}): Promise<{ fixtureRoot: string; host: PcLocalToolHost; projectDir: string; projectId: string }> {
  const fixtureRootParent = options.fixtureRootParent ?? tmpdir();
  const root = await mkdtemp(path.join(fixtureRootParent, 'setsuna-pc-toolhost-test-'));
  const temporaryWorkspaceRoot = path.join(root, options.projectDirName ?? 'project');
  const dataDir = path.join(root, 'data');
  await mkdir(temporaryWorkspaceRoot, { recursive: true });
  const store = new FileWorkspaceProjectStore(dataDir, systemClock, {
    temporaryWorkspacePath: temporaryWorkspaceRoot,
  });
  // Most cases intentionally omit projectId, so fixture files must live in the same
  // per-thread workspace that the runtime resolver selects for thread_1.
  const projectDir = (await store.ensureTemporaryWorkspace({ threadId: 'thread_1' })).path!;
  const project = await store.addProject({ path: projectDir });
  return {
    fixtureRoot: root,
    host: new PcLocalToolHost(
      store,
      options.policyAmendmentStore,
      options.workspaceDependencies,
      undefined,
      { shellSandboxCapability: options.shellSandboxCapability },
    ),
    projectDir,
    projectId: project.id,
  };
}

export function stubWorkspaceDependencyManager(
  overrides: Partial<WorkspaceDependenciesControl> = {},
): WorkspaceDependenciesControl {
  const status: RuntimeWorkspaceDependenciesStatus = {
    bundleVersion: 'test',
    checks: [],
    installPath: '/managed',
    node: { available: true },
    python: { available: true },
    state: 'ready',
    uv: { available: true },
  };
  return {
    diagnose: async () => status,
    getPromptContext: async () => ({ enabled: true }),
    getStatus: async () => status,
    prepareShellToolchain: async ({ environment }) => ({
      commands: {},
      environment: { PATH: process.env.PATH ?? '' },
      readableRoots: [environment.workspaceRoot],
      writableCacheRoots: [],
    }),
    repair: async () => status,
    ...overrides,
  };
}

export function commandAvailableOnPath(command: string): boolean {
  return String(process.env.PATH ?? '').split(path.delimiter)
    .filter(Boolean)
    .some((directory) => existsSync(path.join(directory, command)));
}

export class StaticPolicyAmendmentStore implements PolicyAmendmentStore {
  constructor(private readonly amendments: RuntimePolicyAmendments) {}

  async listPolicyAmendments(): Promise<RuntimePolicyAmendments> {
    return {
      execPolicyAmendments: this.amendments.execPolicyAmendments.map((item) => [...item]),
      networkPolicyAmendments: this.amendments.networkPolicyAmendments.map((item) => ({ ...item })),
    };
  }

  async appendExecPolicyAmendment(amendment: RuntimeExecPolicyAmendment): Promise<void> {
    this.amendments.execPolicyAmendments.push([...amendment]);
  }

  async appendNetworkPolicyAmendment(amendment: RuntimeNetworkPolicyAmendment): Promise<void> {
    this.amendments.networkPolicyAmendments.push({ ...amendment });
  }
}

export function nodeCommand(): string {
  return JSON.stringify(process.execPath);
}

export function shellApplyPatchCommand(filePath: string): string {
  return [
    "apply_patch <<'PATCH'",
    '*** Begin Patch',
    `*** Add File: ${filePath}`,
    '+generated',
    '*** End Patch',
    'PATCH',
  ].join('\n');
}
