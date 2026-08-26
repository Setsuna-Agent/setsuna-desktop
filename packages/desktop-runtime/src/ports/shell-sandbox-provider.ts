import type { SandboxExecutionPlan } from './sandbox-execution-plan.js';

export type ShellSandboxCapability = Readonly<{
  supported: boolean;
  provider: string;
  reason: string;
  executablePath?: string;
}>;

/** Optional OS-specific shell sandbox bound by a runtime Feature. */
export interface ShellSandboxProvider {
  capability(): ShellSandboxCapability;
  controlRoot(): string;
  networkEnvironment(): Promise<Record<string, string>>;
  prepareEnvironment(environment: Record<string, string>): Readonly<{
    environment: Record<string, string>;
    readableRoots: readonly string[];
  }>;
  writeRequest(input: Readonly<{
    command: string;
    controlRoot: string;
    executionId: string;
    plan: SandboxExecutionPlan;
  }>): Promise<string>;
}
