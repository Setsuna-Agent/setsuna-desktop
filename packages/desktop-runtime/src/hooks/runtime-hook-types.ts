import type {
  RuntimeConfigState,
  RuntimeHookEventName,
  RuntimeHookMetadata,
  RuntimeHookProtocolEventName,
  RuntimeHookRun,
  RuntimeToolCall
} from '@setsuna-desktop/contracts';
import type {
  ToolExecutionContext,
  ToolExecutionEnvironment,
  ToolExecutionResult,
} from '../ports/tool-host.js';

export type RuntimeHookDiscoveryEvent = {
  configName: RuntimeHookEventName;
  protocolName: RuntimeHookProtocolEventName;
  keyLabel: string;
  matcherEnabled: boolean;
};

export type RuntimeDiscoveredHook = RuntimeHookMetadata & {
  configEventName: RuntimeHookEventName;
  matcherEnabled: boolean;
};

export type RuntimeHookDiscovery = {
  hooks: RuntimeDiscoveredHook[];
  warnings: string[];
};

export type RuntimePreToolUseHookOutcome =
  | { action: 'continue'; updatedInput?: unknown; additionalContexts: string[] }
  | { action: 'block'; reason: string; additionalContexts: string[] };

export type RuntimePostToolUseHookOutcome = {
  additionalContexts: string[];
  feedbackMessage?: string;
  shouldBlock: boolean;
};

export type RuntimePermissionRequestHookOutcome =
  | { decision: 'allow' }
  | { decision: 'deny'; message: string }
  | { decision: 'none' };

export type RuntimeUserPromptSubmitHookOutcome = {
  additionalContexts: string[];
  shouldStop: boolean;
  stopReason?: string;
};

export type RuntimeSessionStartSource = 'startup' | 'resume' | 'clear' | 'compact';

export type RuntimeSessionStartHookOutcome = {
  additionalContexts: string[];
  shouldStop: boolean;
  stopReason?: string;
};

export type RuntimeSubagentStartHookOutcome = {
  additionalContexts: string[];
};

export type RuntimeCompactHookTrigger = 'manual' | 'auto';

export type RuntimeCompactHookOutcome = {
  shouldStop: boolean;
  stopReason?: string;
};

export type RuntimeStopHookOutcome = {
  blockReason?: string;
  shouldBlock: boolean;
  shouldStop: boolean;
  stopReason?: string;
};

export type RuntimeToolHookRunner = {
  runPreToolUse(input: RuntimeToolHookInput): Promise<RuntimePreToolUseHookOutcome>;
  runPermissionRequest(input: RuntimeToolHookInput): Promise<RuntimePermissionRequestHookOutcome>;
  runPostToolUse(input: RuntimeToolPostHookInput): Promise<RuntimePostToolUseHookOutcome>;
  runPreCompact(input: RuntimeCompactHookInput): Promise<RuntimeCompactHookOutcome>;
  runPostCompact(input: RuntimeCompactHookInput): Promise<RuntimeCompactHookOutcome>;
  runSessionStart(input: RuntimeSessionStartHookInput): Promise<RuntimeSessionStartHookOutcome>;
  runSubagentStart(input: RuntimeSubagentStartHookInput): Promise<RuntimeSubagentStartHookOutcome>;
  runUserPromptSubmit(input: RuntimeUserPromptSubmitHookInput): Promise<RuntimeUserPromptSubmitHookOutcome>;
  runSubagentStop(input: RuntimeSubagentStopHookInput): Promise<RuntimeStopHookOutcome>;
  runStop(input: RuntimeStopHookInput): Promise<RuntimeStopHookOutcome>;
};

export type RuntimeToolHookEvents = {
  publishHookStarted(run: RuntimeHookRun): Promise<void>;
  publishHookCompleted(run: RuntimeHookRun): Promise<void>;
};

export type RuntimeToolHookInput = {
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  context: ToolExecutionContext & { turnId: string };
  environment: ToolExecutionEnvironment;
  events?: RuntimeToolHookEvents;
  parsedArguments: unknown;
  toolCall: RuntimeToolCall;
};

export type RuntimeToolPostHookInput = RuntimeToolHookInput & {
  result: ToolExecutionResult;
};

export type RuntimeUserPromptSubmitHookInput = {
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  context: ToolExecutionContext & { turnId: string };
  environment: ToolExecutionEnvironment;
  events?: RuntimeToolHookEvents;
  prompt: string;
};

export type RuntimeSessionStartHookInput = {
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  context: ToolExecutionContext & { turnId: string };
  environment: ToolExecutionEnvironment;
  events?: RuntimeToolHookEvents;
  source: RuntimeSessionStartSource;
};

export type RuntimeSubagentStartHookInput = {
  agentId: string;
  agentType: string;
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  context: ToolExecutionContext & { turnId: string };
  environment: ToolExecutionEnvironment;
  events?: RuntimeToolHookEvents;
};

export type RuntimeCompactHookInput = {
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  context: ToolExecutionContext & { turnId: string };
  environment: ToolExecutionEnvironment;
  events?: RuntimeToolHookEvents;
  trigger: RuntimeCompactHookTrigger;
};

export type RuntimeStopHookInput = {
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  context: ToolExecutionContext & { turnId: string };
  environment: ToolExecutionEnvironment;
  events?: RuntimeToolHookEvents;
  lastAssistantMessage?: string;
  stopHookActive: boolean;
};

export type RuntimeSubagentStopHookInput = RuntimeStopHookInput & {
  agentId: string;
  agentTranscriptPath?: string | null;
  agentType: string;
};

export type CommandRunResult = {
  completionOrder: number;
  completedAt: string;
  durationMs: number;
  exitCode: number | null;
  hook: RuntimeDiscoveredHook;
  startedAt: string;
  stdout: string;
  stderr: string;
  error?: string;
};

export type CommandProcessRunResult = Pick<CommandRunResult, 'exitCode' | 'stdout' | 'stderr' | 'error'>;

export type ParsedPreToolUseOutput = {
  blockReason?: string;
  additionalContext?: string;
  updatedInput?: unknown;
  invalidReason?: string;
  systemMessage?: string;
};

export type ParsedPostToolUseOutput = {
  additionalContext?: string;
  feedbackMessage?: string;
  invalidReason?: string;
  shouldBlock: boolean;
  stopped?: boolean;
  systemMessage?: string;
};

export type ParsedPermissionRequestOutput =
  | { decision: 'allow'; systemMessage?: string }
  | { decision: 'deny'; message: string; systemMessage?: string }
  | { decision: 'none'; invalidReason?: string; systemMessage?: string };

export type ParsedUserPromptSubmitOutput = {
  additionalContext?: string;
  blockReason?: string;
  invalidReason?: string;
  shouldStop: boolean;
  stopReason?: string;
  systemMessage?: string;
};

export type ParsedSessionStartOutput = {
  additionalContext?: string;
  invalidReason?: string;
  shouldStop: boolean;
  stopReason?: string;
  systemMessage?: string;
};

export type ParsedSubagentStartOutput = {
  additionalContext?: string;
  invalidReason?: string;
  systemMessage?: string;
};

export type ParsedCompactOutput = {
  invalidReason?: string;
  shouldStop: boolean;
  stopReason?: string;
  systemMessage?: string;
};

export type ParsedStopOutput = {
  blockReason?: string;
  invalidReason?: string;
  shouldBlock: boolean;
  shouldStop: boolean;
  stopReason?: string;
  systemMessage?: string;
};
