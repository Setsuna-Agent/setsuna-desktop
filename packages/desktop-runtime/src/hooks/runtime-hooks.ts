import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  RuntimeConfigState,
  RuntimeHookOutputEntry,
  RuntimeHookRun,
  RuntimeHookRunEventName,
  RuntimeHookRunStatus,
  RuntimeHookEventName,
  RuntimeHookHandlerConfig,
  RuntimeHookMetadata,
  RuntimeHookProtocolEventName,
  RuntimeToolCall,
} from '@setsuna-desktop/contracts';
import type { ToolExecutionContext, ToolExecutionEnvironment, ToolExecutionResult } from '../ports/tool-host.js';
import { powershellCommand } from '../utils/windows-shell.js';

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

type CommandRunResult = {
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

type CommandProcessRunResult = Pick<CommandRunResult, 'exitCode' | 'stdout' | 'stderr' | 'error'>;

type ParsedPreToolUseOutput = {
  blockReason?: string;
  additionalContext?: string;
  updatedInput?: unknown;
  invalidReason?: string;
  systemMessage?: string;
};

type ParsedPostToolUseOutput = {
  additionalContext?: string;
  feedbackMessage?: string;
  invalidReason?: string;
  shouldBlock: boolean;
  stopped?: boolean;
  systemMessage?: string;
};

type ParsedPermissionRequestOutput =
  | { decision: 'allow'; systemMessage?: string }
  | { decision: 'deny'; message: string; systemMessage?: string }
  | { decision: 'none'; invalidReason?: string; systemMessage?: string };

type ParsedUserPromptSubmitOutput = {
  additionalContext?: string;
  blockReason?: string;
  invalidReason?: string;
  shouldStop: boolean;
  stopReason?: string;
  systemMessage?: string;
};

type ParsedSessionStartOutput = {
  additionalContext?: string;
  invalidReason?: string;
  shouldStop: boolean;
  stopReason?: string;
  systemMessage?: string;
};

type ParsedSubagentStartOutput = {
  additionalContext?: string;
  invalidReason?: string;
  systemMessage?: string;
};

type ParsedCompactOutput = {
  invalidReason?: string;
  shouldStop: boolean;
  stopReason?: string;
  systemMessage?: string;
};

type ParsedStopOutput = {
  blockReason?: string;
  invalidReason?: string;
  shouldBlock: boolean;
  shouldStop: boolean;
  stopReason?: string;
  systemMessage?: string;
};

const HOOK_OUTPUT_BYTES_CAP = 1024 * 1024;

export const RUNTIME_HOOK_EVENTS: RuntimeHookDiscoveryEvent[] = [
  { configName: 'PreToolUse', protocolName: 'preToolUse', keyLabel: 'pre_tool_use', matcherEnabled: true },
  { configName: 'PermissionRequest', protocolName: 'permissionRequest', keyLabel: 'permission_request', matcherEnabled: true },
  { configName: 'PostToolUse', protocolName: 'postToolUse', keyLabel: 'post_tool_use', matcherEnabled: true },
  { configName: 'PreCompact', protocolName: 'preCompact', keyLabel: 'pre_compact', matcherEnabled: true },
  { configName: 'PostCompact', protocolName: 'postCompact', keyLabel: 'post_compact', matcherEnabled: true },
  { configName: 'SessionStart', protocolName: 'sessionStart', keyLabel: 'session_start', matcherEnabled: true },
  { configName: 'UserPromptSubmit', protocolName: 'userPromptSubmit', keyLabel: 'user_prompt_submit', matcherEnabled: false },
  { configName: 'SubagentStart', protocolName: 'subagentStart', keyLabel: 'subagent_start', matcherEnabled: true },
  { configName: 'SubagentStop', protocolName: 'subagentStop', keyLabel: 'subagent_stop', matcherEnabled: true },
  { configName: 'Stop', protocolName: 'stop', keyLabel: 'stop', matcherEnabled: false },
];

export function discoverRuntimeHooks(config: RuntimeConfigState): RuntimeHookDiscovery {
  if (config.features?.hooks === false) return { hooks: [], warnings: [] };
  const configSourcePath = path.resolve(config.configPath);
  const hookState = config.hooks?.state ?? {};
  const hooks: RuntimeDiscoveredHook[] = [];
  const warnings: string[] = [];
  let displayOrder = 0;
  for (const event of RUNTIME_HOOK_EVENTS) {
    const groups = config.hooks?.[event.configName] ?? [];
    for (const [groupIndex, group] of groups.entries()) {
      const matcher = event.matcherEnabled ? group.matcher?.trim() || null : null;
      if (matcher) {
        try {
          validateHookMatcher(matcher);
        } catch (error) {
          warnings.push(`invalid matcher ${JSON.stringify(matcher)} in ${configSourcePath}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }
      for (const [handlerIndex, handler] of group.hooks.entries()) {
        if (handler.type !== 'command') {
          warnings.push(`skipping ${handler.type} hook in ${configSourcePath}: ${handler.type} hooks are not supported yet`);
          continue;
        }
        if (handler.async) {
          warnings.push(`skipping async hook in ${configSourcePath}: async hooks are not supported yet`);
          continue;
        }
        const command = hookCommandForPlatform(handler);
        if (!command) {
          warnings.push(`skipping empty hook command in ${configSourcePath}`);
          continue;
        }
        const sourcePath = handler.sourcePath ? path.resolve(handler.sourcePath) : configSourcePath;
        const timeoutSec = Math.max(1, Math.floor(handler.timeoutSec ?? 600));
        const currentHash = commandHookHash(event.keyLabel, matcher, handler, command, timeoutSec);
        const key = `${sourcePath}:${event.keyLabel}:${groupIndex}:${handlerIndex}`;
        const state = hookState[key];
        const trustedHash = state?.trustedHash;
        hooks.push({
          key,
          configEventName: event.configName,
          eventName: event.protocolName,
          handlerType: 'command',
          matcher,
          command,
          timeoutSec,
          statusMessage: handler.statusMessage?.trim() || null,
          sourcePath,
          source: handler.pluginId ? 'plugin' : 'user',
          pluginId: handler.pluginId ?? null,
          displayOrder,
          enabled: state?.enabled !== false,
          isManaged: false,
          matcherEnabled: event.matcherEnabled,
          currentHash,
          trustStatus: hookTrustStatus(currentHash, trustedHash),
        });
        displayOrder += 1;
      }
    }
  }
  return { hooks, warnings };
}

export function createRuntimeToolHookRunner(config: RuntimeConfigState | null | undefined): RuntimeToolHookRunner | null {
  if (!config || config.features?.hooks === false) return null;
  const discovery = discoverRuntimeHooks(config);
  const executableHooks = discovery.hooks.filter((hook) =>
    hook.enabled
    && hook.command
    && (config.bypassHookTrust === true || hook.trustStatus === 'trusted' || hook.trustStatus === 'managed')
  );
  if (!executableHooks.length) return null;

  return {
    async runPreToolUse(input) {
      const hooks = matchingToolHooks(executableHooks, 'PreToolUse', input.toolCall.name);
      if (!hooks.length) return { action: 'continue', additionalContexts: [] };
      const payload = hookToolPayload('PreToolUse', config, input);
      const runs = await runCommandHooks('PreToolUse', hooks, payload, input);
      const additionalContexts = runs.flatMap((run) => parsePreToolUseRun(run).additionalContext ?? []);
      const blocking = runs.map(parsePreToolUseRun).find((parsed) => parsed.blockReason);
      if (blocking?.blockReason) {
        return { action: 'block', reason: blocking.blockReason, additionalContexts };
      }
      const latestUpdate = runs
        .map((run) => ({ completionOrder: run.completionOrder, parsed: parsePreToolUseRun(run) }))
        .filter((run) => run.parsed.updatedInput !== undefined)
        .sort((left, right) => right.completionOrder - left.completionOrder)[0];
      return {
        action: 'continue',
        additionalContexts,
        ...(latestUpdate ? { updatedInput: latestUpdate.parsed.updatedInput } : {}),
      };
    },
    async runPermissionRequest(input) {
      const hooks = matchingToolHooks(executableHooks, 'PermissionRequest', input.toolCall.name);
      if (!hooks.length) return { decision: 'none' };
      const payload = hookToolPayload('PermissionRequest', config, input);
      const runs = await runCommandHooks('PermissionRequest', hooks, payload, input);
      let allowSeen = false;
      for (const run of runs) {
        const parsed = parsePermissionRequestRun(run);
        if (parsed.decision === 'deny') return parsed;
        if (parsed.decision === 'allow') allowSeen = true;
      }
      return allowSeen ? { decision: 'allow' } : { decision: 'none' };
    },
    async runPostToolUse(input) {
      const hooks = matchingToolHooks(executableHooks, 'PostToolUse', input.toolCall.name);
      if (!hooks.length) return { additionalContexts: [], shouldBlock: false };
      const payload = hookToolPayload('PostToolUse', config, input);
      const runs = await runCommandHooks('PostToolUse', hooks, payload, input);
      const parsedRuns = runs.map(parsePostToolUseRun);
      const additionalContexts = parsedRuns.flatMap((parsed) => parsed.additionalContext ?? []);
      const feedbackMessage = joinTextChunks(parsedRuns.map((parsed) => parsed.feedbackMessage).filter((item): item is string => Boolean(item)));
      return {
        additionalContexts,
        ...(feedbackMessage ? { feedbackMessage } : {}),
        shouldBlock: parsedRuns.some((parsed) => parsed.shouldBlock),
      };
    },
    async runPreCompact(input) {
      const hooks = matchingEventHooks(executableHooks, 'PreCompact', input.trigger);
      if (!hooks.length) return { shouldStop: false };
      const payload = hookCompactPayload('PreCompact', config, input);
      const runs = await runCommandHooks('PreCompact', hooks, payload, input);
      const parsedRuns = runs.map((run) => parseCompactRun('PreCompact', run));
      const stopReason = parsedRuns.find((parsed) => parsed.shouldStop && parsed.stopReason)?.stopReason;
      return {
        shouldStop: parsedRuns.some((parsed) => parsed.shouldStop),
        ...(stopReason ? { stopReason } : {}),
      };
    },
    async runPostCompact(input) {
      const hooks = matchingEventHooks(executableHooks, 'PostCompact', input.trigger);
      if (!hooks.length) return { shouldStop: false };
      const payload = hookCompactPayload('PostCompact', config, input);
      const runs = await runCommandHooks('PostCompact', hooks, payload, input);
      const parsedRuns = runs.map((run) => parseCompactRun('PostCompact', run));
      const stopReason = parsedRuns.find((parsed) => parsed.shouldStop && parsed.stopReason)?.stopReason;
      return {
        shouldStop: parsedRuns.some((parsed) => parsed.shouldStop),
        ...(stopReason ? { stopReason } : {}),
      };
    },
    async runSessionStart(input) {
      const hooks = matchingEventHooks(executableHooks, 'SessionStart', input.source);
      if (!hooks.length) return { additionalContexts: [], shouldStop: false };
      const payload = hookSessionStartPayload(config, input);
      const runs = await runCommandHooks('SessionStart', hooks, payload, input);
      const parsedRuns = runs.map(parseSessionStartRun);
      const additionalContexts = parsedRuns.flatMap((parsed) => parsed.additionalContext ?? []);
      const stopReason = parsedRuns.find((parsed) => parsed.shouldStop && parsed.stopReason)?.stopReason;
      return {
        additionalContexts,
        shouldStop: parsedRuns.some((parsed) => parsed.shouldStop),
        ...(stopReason ? { stopReason } : {}),
      };
    },
    async runSubagentStart(input) {
      const hooks = matchingEventHooks(executableHooks, 'SubagentStart', input.agentType);
      if (!hooks.length) return { additionalContexts: [] };
      const payload = hookSubagentStartPayload(config, input);
      const runs = await runCommandHooks('SubagentStart', hooks, payload, input);
      const parsedRuns = runs.map(parseSubagentStartRun);
      return {
        additionalContexts: parsedRuns.flatMap((parsed) => parsed.additionalContext ?? []),
      };
    },
    async runUserPromptSubmit(input) {
      const hooks = executableHooks.filter((hook) => hook.configEventName === 'UserPromptSubmit');
      if (!hooks.length) return { additionalContexts: [], shouldStop: false };
      const payload = hookUserPromptSubmitPayload(config, input);
      const runs = await runCommandHooks('UserPromptSubmit', hooks, payload, input);
      const parsedRuns = runs.map(parseUserPromptSubmitRun);
      const additionalContexts = parsedRuns.flatMap((parsed) => parsed.additionalContext ?? []);
      const stopReason = parsedRuns.find((parsed) => parsed.shouldStop && parsed.stopReason)?.stopReason;
      return {
        additionalContexts,
        shouldStop: parsedRuns.some((parsed) => parsed.shouldStop),
        ...(stopReason ? { stopReason } : {}),
      };
    },
    async runSubagentStop(input) {
      const hooks = matchingEventHooks(executableHooks, 'SubagentStop', input.agentType);
      if (!hooks.length) return { shouldBlock: false, shouldStop: false };
      const payload = hookSubagentStopPayload(config, input);
      const runs = await runCommandHooks('SubagentStop', hooks, payload, input);
      const parsedRuns = runs.map((run) => parseStopRun(run, 'SubagentStop'));
      const shouldStop = parsedRuns.some((parsed) => parsed.shouldStop);
      const blockReasons = shouldStop ? [] : parsedRuns.map((parsed) => parsed.blockReason).filter((item): item is string => Boolean(item));
      const stopReason = parsedRuns.find((parsed) => parsed.shouldStop && parsed.stopReason)?.stopReason;
      return {
        ...(blockReasons.length ? { blockReason: joinTextChunks(blockReasons) } : {}),
        shouldBlock: blockReasons.length > 0,
        shouldStop,
        ...(stopReason ? { stopReason } : {}),
      };
    },
    async runStop(input) {
      const hooks = executableHooks.filter((hook) => hook.configEventName === 'Stop');
      if (!hooks.length) return { shouldBlock: false, shouldStop: false };
      const payload = hookStopPayload(config, input);
      const runs = await runCommandHooks('Stop', hooks, payload, input);
      const parsedRuns = runs.map((run) => parseStopRun(run));
      const shouldStop = parsedRuns.some((parsed) => parsed.shouldStop);
      const blockReasons = shouldStop ? [] : parsedRuns.map((parsed) => parsed.blockReason).filter((item): item is string => Boolean(item));
      const stopReason = parsedRuns.find((parsed) => parsed.shouldStop && parsed.stopReason)?.stopReason;
      return {
        ...(blockReasons.length ? { blockReason: joinTextChunks(blockReasons) } : {}),
        shouldBlock: blockReasons.length > 0,
        shouldStop,
        ...(stopReason ? { stopReason } : {}),
      };
    },
  };
}

export function hookCommandForPlatform(handler: RuntimeHookHandlerConfig): string {
  const command = process.platform === 'win32' ? handler.commandWindows || handler.command : handler.command;
  return command?.trim() ?? '';
}

export function commandHookHash(
  eventName: string,
  matcher: string | null,
  handler: RuntimeHookHandlerConfig,
  command: string,
  timeoutSec: number,
): string {
  return sha256CanonicalJson({
    event_name: eventName,
    ...(matcher ? { matcher } : {}),
    hooks: [{
      type: 'command',
      command,
      timeout: timeoutSec,
      async: false,
      ...(handler.statusMessage?.trim() ? { statusMessage: handler.statusMessage.trim() } : {}),
    }],
  });
}

function matchingToolHooks(hooks: RuntimeDiscoveredHook[], eventName: RuntimeHookEventName, toolName: string): RuntimeDiscoveredHook[] {
  const matcherInputs = [toolName, ...toolMatcherAliases(toolName)];
  return hooks.filter((hook) => {
    if (hook.configEventName !== eventName) return false;
    return matcherInputs.some((input) => matchesHookMatcher(hook.matcher, input));
  });
}

function matchingEventHooks(hooks: RuntimeDiscoveredHook[], eventName: RuntimeHookEventName, matcherInput: string): RuntimeDiscoveredHook[] {
  return hooks.filter((hook) => hook.configEventName === eventName && matchesHookMatcher(hook.matcher, matcherInput));
}

function validateHookMatcher(matcher: string): void {
  if (isMatchAllHookMatcher(matcher) || isExactHookMatcher(matcher)) return;
  new RegExp(matcher);
}

function matchesHookMatcher(matcher: string | null | undefined, input: string | null | undefined): boolean {
  if (!matcher) return true;
  if (isMatchAllHookMatcher(matcher)) return true;
  if (!input) return false;
  if (isExactHookMatcher(matcher)) return matcher.split('|').some((candidate) => candidate === input);
  try {
    return new RegExp(matcher).test(input);
  } catch {
    return false;
  }
}

function isMatchAllHookMatcher(matcher: string): boolean {
  return matcher === '' || matcher === '*';
}

function isExactHookMatcher(matcher: string): boolean {
  return /^[A-Za-z0-9_|]+$/.test(matcher);
}

function toolMatcherAliases(toolName: string): string[] {
  if (toolName === 'run_shell_command' || toolName === 'shell' || toolName === 'command/exec') return ['Bash', 'Shell'];
  if (toolName === 'apply_patch') return ['Edit', 'Patch'];
  if (toolName.includes('read')) return ['Read'];
  if (toolName.includes('write') || toolName.includes('edit')) return ['Edit', 'Write'];
  return [];
}

function hookToolPayload(eventName: 'PreToolUse' | 'PermissionRequest' | 'PostToolUse', config: RuntimeConfigState, input: RuntimeToolPostHookInput | RuntimeToolHookInput): Record<string, unknown> {
  const toolUse = hookFacingToolUse(input);
  return {
    session_id: input.context.threadId,
    turn_id: input.context.turnId,
    cwd: input.environment.cwd,
    hook_event_name: eventName,
    model: config.activeProviderId ?? '',
    permission_mode: input.approvalPolicy,
    tool_name: toolUse.toolName,
    tool_input: toHookJson(toolUse.toolInput),
    tool_use_id: toolUse.toolUseId,
    ...('result' in input
      ? {
          tool_response: toHookJson(toolUse.toolResponse),
        }
      : {}),
  };
}

type HookFacingToolUse = {
  toolInput: unknown;
  toolName: string;
  toolResponse?: unknown;
  toolUseId: string;
};

function hookFacingToolUse(input: RuntimeToolPostHookInput | RuntimeToolHookInput): HookFacingToolUse {
  const toolName = hookFacingToolName(input.toolCall.name);
  const toolInput = hookFacingToolInput(input.toolCall.name, input.parsedArguments);
  const toolResponse = 'result' in input ? hookFacingToolResponse(input.toolCall.name, input.result) : undefined;
  return {
    toolInput,
    toolName,
    toolUseId: input.toolCall.id,
    ...(toolResponse !== undefined ? { toolResponse } : {}),
  };
}

function hookFacingToolName(toolName: string): string {
  if (toolName === 'run_shell_command' || toolName === 'exec_command') return 'Bash';
  return toolName;
}

function hookFacingToolInput(toolName: string, parsedArguments: unknown): unknown {
  const record = recordValue(parsedArguments);
  if (toolName === 'run_shell_command' || toolName === 'exec_command') {
    return { command: stringValue(record?.command) ?? stringValue(record?.cmd) ?? '' };
  }
  if (toolName === 'apply_patch') {
    return { command: stringValue(record?.patch) ?? stringValue(record?.command) ?? '' };
  }
  return parsedArguments;
}

function hookFacingToolResponse(toolName: string, result: ToolExecutionResult): unknown {
  if (toolName === 'run_shell_command' || toolName === 'exec_command' || toolName === 'apply_patch') {
    return result.content;
  }
  return {
    content: result.content,
    ...(result.preview ? { preview: result.preview } : {}),
    ...(result.data !== undefined ? { data: result.data } : {}),
  };
}

function hookUserPromptSubmitPayload(config: RuntimeConfigState, input: RuntimeUserPromptSubmitHookInput): Record<string, unknown> {
  return {
    session_id: input.context.threadId,
    turn_id: input.context.turnId,
    transcript_path: null,
    cwd: input.environment.cwd,
    hook_event_name: 'UserPromptSubmit',
    model: config.activeProviderId ?? '',
    permission_mode: input.approvalPolicy,
    prompt: input.prompt,
  };
}

function hookSessionStartPayload(config: RuntimeConfigState, input: RuntimeSessionStartHookInput): Record<string, unknown> {
  return {
    session_id: input.context.threadId,
    turn_id: input.context.turnId,
    transcript_path: null,
    cwd: input.environment.cwd,
    hook_event_name: 'SessionStart',
    model: config.activeProviderId ?? '',
    permission_mode: input.approvalPolicy,
    source: input.source,
  };
}

function hookSubagentStartPayload(config: RuntimeConfigState, input: RuntimeSubagentStartHookInput): Record<string, unknown> {
  return {
    session_id: input.context.threadId,
    turn_id: input.context.turnId,
    transcript_path: null,
    cwd: input.environment.cwd,
    hook_event_name: 'SubagentStart',
    model: config.activeProviderId ?? '',
    permission_mode: input.approvalPolicy,
    agent_id: input.agentId,
    agent_type: input.agentType,
  };
}

function hookCompactPayload(eventName: 'PreCompact' | 'PostCompact', config: RuntimeConfigState, input: RuntimeCompactHookInput): Record<string, unknown> {
  return {
    session_id: input.context.threadId,
    turn_id: input.context.turnId,
    transcript_path: null,
    cwd: input.environment.cwd,
    hook_event_name: eventName,
    model: config.activeProviderId ?? '',
    trigger: input.trigger,
  };
}

function hookSubagentStopPayload(config: RuntimeConfigState, input: RuntimeSubagentStopHookInput): Record<string, unknown> {
  return {
    session_id: input.context.threadId,
    turn_id: input.context.turnId,
    transcript_path: null,
    agent_transcript_path: input.agentTranscriptPath ?? null,
    cwd: input.environment.cwd,
    hook_event_name: 'SubagentStop',
    model: config.activeProviderId ?? '',
    permission_mode: input.approvalPolicy,
    stop_hook_active: input.stopHookActive,
    agent_id: input.agentId,
    agent_type: input.agentType,
    last_assistant_message: input.lastAssistantMessage ?? null,
  };
}

function hookStopPayload(config: RuntimeConfigState, input: RuntimeStopHookInput): Record<string, unknown> {
  return {
    session_id: input.context.threadId,
    turn_id: input.context.turnId,
    transcript_path: null,
    cwd: input.environment.cwd,
    hook_event_name: 'Stop',
    model: config.activeProviderId ?? '',
    permission_mode: input.approvalPolicy,
    stop_hook_active: input.stopHookActive,
    last_assistant_message: input.lastAssistantMessage ?? null,
  };
}

type RuntimeCommandHookInput = RuntimeToolPostHookInput | RuntimeToolHookInput | RuntimeCompactHookInput | RuntimeSessionStartHookInput | RuntimeSubagentStartHookInput | RuntimeUserPromptSubmitHookInput | RuntimeSubagentStopHookInput | RuntimeStopHookInput;

async function runCommandHooks(eventName: RuntimeHookRunEventName, hooks: RuntimeDiscoveredHook[], payload: Record<string, unknown>, input: RuntimeCommandHookInput): Promise<CommandRunResult[]> {
  let completionOrder = 0;
  return Promise.all(hooks.map(async (hook) => {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    await input.events?.publishHookStarted(hookRunFromDiscoveredHook({
      eventName,
      hook,
      input,
      startedAt,
      status: 'running',
    }));
    const result = await runCommandHook(hook, JSON.stringify(payload), input.environment.cwd, input.context.signal);
    const completedAtDate = new Date();
    const completedAt = completedAtDate.toISOString();
    completionOrder += 1;
    const run: CommandRunResult = {
      ...result,
      completionOrder,
      completedAt,
      durationMs: Math.max(0, completedAtDate.getTime() - startedAtDate.getTime()),
      hook,
      startedAt,
    };
    await input.events?.publishHookCompleted(hookRunFromCommandResult(eventName, input, run));
    return run;
  }));
}

function hookRunFromDiscoveredHook({
  eventName,
  hook,
  input,
  message,
  entries,
  startedAt,
  status,
  stderrPreview,
  stdoutPreview,
}: {
  eventName: RuntimeHookRunEventName;
  hook: RuntimeDiscoveredHook;
  input: RuntimeCommandHookInput;
  message?: string;
  entries?: RuntimeHookOutputEntry[];
  startedAt: string;
  status: RuntimeHookRunStatus;
  stderrPreview?: string;
  stdoutPreview?: string;
}): RuntimeHookRun {
  const toolCall = 'toolCall' in input ? input.toolCall : null;
  return {
    id: hookRunId(eventName, hook, input, startedAt),
    turnId: input.context.turnId,
    ...(toolCall ? { toolCallId: toolCall.id, toolName: toolCall.name } : {}),
    eventName,
    handlerType: 'command',
    status,
    command: hook.command ?? undefined,
    matcher: hook.matcher,
    statusMessage: hook.statusMessage,
    sourcePath: hook.sourcePath,
    source: hook.source,
    ...(hook.pluginId ? { pluginId: hook.pluginId } : {}),
    ...('prompt' in input ? { promptPreview: previewHookPrompt(input.prompt) } : {}),
    ...('lastAssistantMessage' in input && input.lastAssistantMessage ? { lastAssistantMessagePreview: previewHookPrompt(input.lastAssistantMessage) } : {}),
    startedAt,
    ...(message ? { message } : {}),
    ...(entries?.length ? { entries } : {}),
    ...(stdoutPreview ? { stdoutPreview } : {}),
    ...(stderrPreview ? { stderrPreview } : {}),
  };
}

function hookRunFromCommandResult(eventName: RuntimeHookRunEventName, input: RuntimeCommandHookInput, run: CommandRunResult): RuntimeHookRun {
  const summary = hookCompletionSummary(eventName, run);
  return {
    ...hookRunFromDiscoveredHook({
      eventName,
      hook: run.hook,
      entries: summary.entries,
      input,
      message: summary.message,
      startedAt: run.startedAt,
      status: summary.status,
      stderrPreview: previewHookOutput(run.stderr),
      stdoutPreview: previewHookOutput(run.stdout),
    }),
    completedAt: run.completedAt,
    durationMs: run.durationMs,
  };
}

function hookCompletionSummary(eventName: RuntimeHookRunEventName, run: CommandRunResult): { status: RuntimeHookRunStatus; message?: string; entries: RuntimeHookOutputEntry[] } {
  if (run.error) return hookSummary('failed', run.error, [{ kind: 'error', text: run.error }]);
  if (run.exitCode !== 0 && run.exitCode !== 2) {
    const message = run.stderr.trim() || `hook exited with code ${run.exitCode ?? 'unknown'}`;
    return hookSummary('failed', message, [{ kind: 'error', text: message }]);
  }
  if (eventName === 'PreToolUse') {
    const parsed = parsePreToolUseRun(run);
    const entries = hookEntriesFromParsed(parsed);
    if (parsed.invalidReason) return hookSummary('failed', parsed.invalidReason, entries);
    if (parsed.blockReason) return hookSummary('blocked', parsed.blockReason, entries);
    if (parsed.updatedInput !== undefined) return hookSummary('completed', 'Updated tool input.', entries);
    if (parsed.additionalContext) return hookSummary('completed', 'Added context.', entries);
    return hookSummary('completed', undefined, entries);
  }
  if (eventName === 'PermissionRequest') {
    const parsed = parsePermissionRequestRun(run);
    const entries = hookEntriesFromParsed(parsed);
    if (parsed.decision === 'none' && parsed.invalidReason) return hookSummary('failed', parsed.invalidReason, entries);
    if (parsed.decision === 'deny') return hookSummary('blocked', parsed.message, entries);
    if (parsed.decision === 'allow') return hookSummary('completed', 'Approved by hook.', entries);
    return hookSummary('completed', undefined, entries);
  }
  if (eventName === 'PreCompact' || eventName === 'PostCompact') {
    const parsed = parseCompactRun(eventName, run);
    const entries = hookEntriesFromParsed(parsed);
    if (parsed.invalidReason) return hookSummary('failed', parsed.invalidReason, entries);
    if (parsed.shouldStop) return hookSummary('stopped', parsed.stopReason, entries);
    return hookSummary('completed', undefined, entries);
  }
  if (eventName === 'SessionStart') {
    const parsed = parseSessionStartRun(run);
    const entries = hookEntriesFromParsed(parsed);
    if (parsed.invalidReason) return hookSummary('failed', parsed.invalidReason, entries);
    if (parsed.shouldStop) return hookSummary('stopped', parsed.stopReason, entries);
    if (parsed.additionalContext) return hookSummary('completed', 'Added context.', entries);
    return hookSummary('completed', undefined, entries);
  }
  if (eventName === 'SubagentStart') {
    const parsed = parseSubagentStartRun(run);
    const entries = hookEntriesFromParsed(parsed);
    if (parsed.invalidReason) return hookSummary('failed', parsed.invalidReason, entries);
    if (parsed.additionalContext) return hookSummary('completed', 'Added context.', entries);
    return hookSummary('completed', undefined, entries);
  }
  if (eventName === 'UserPromptSubmit') {
    const parsed = parseUserPromptSubmitRun(run);
    const entries = hookEntriesFromParsed(parsed);
    if (parsed.invalidReason) return hookSummary('failed', parsed.invalidReason, entries);
    if (parsed.blockReason) return hookSummary('blocked', parsed.blockReason, entries);
    if (parsed.shouldStop) return hookSummary('stopped', parsed.stopReason, entries);
    if (parsed.additionalContext) return hookSummary('completed', 'Added context.', entries);
    return hookSummary('completed', undefined, entries);
  }
  if (eventName === 'Stop') {
    const parsed = parseStopRun(run);
    const entries = hookEntriesFromParsed(parsed);
    if (parsed.invalidReason) return hookSummary('failed', parsed.invalidReason, entries);
    if (parsed.shouldStop) return hookSummary('stopped', parsed.stopReason, entries);
    if (parsed.shouldBlock) return hookSummary('blocked', parsed.blockReason, entries);
    return hookSummary('completed', undefined, entries);
  }
  if (eventName === 'SubagentStop') {
    const parsed = parseStopRun(run, 'SubagentStop');
    const entries = hookEntriesFromParsed(parsed);
    if (parsed.invalidReason) return hookSummary('failed', parsed.invalidReason, entries);
    if (parsed.shouldStop) return hookSummary('stopped', parsed.stopReason, entries);
    if (parsed.shouldBlock) return hookSummary('blocked', parsed.blockReason, entries);
    return hookSummary('completed', undefined, entries);
  }
  const parsed = parsePostToolUseRun(run);
  const entries = hookEntriesFromParsed(parsed);
  if (parsed.stopped) return hookSummary('stopped', parsed.feedbackMessage, entries);
  if (parsed.invalidReason) return hookSummary('failed', parsed.invalidReason, entries);
  if (parsed.shouldBlock) return hookSummary('blocked', parsed.feedbackMessage, entries);
  if (parsed.feedbackMessage) return hookSummary('completed', parsed.feedbackMessage, entries);
  if (parsed.additionalContext) return hookSummary('completed', 'Added context.', entries);
  return hookSummary('completed', undefined, entries);
}

function hookSummary(status: RuntimeHookRunStatus, message: string | undefined, entries: RuntimeHookOutputEntry[]): { status: RuntimeHookRunStatus; message?: string; entries: RuntimeHookOutputEntry[] } {
  return {
    status,
    ...(message ? { message } : {}),
    entries,
  };
}

function hookEntriesFromParsed(parsed: ParsedPreToolUseOutput | ParsedPostToolUseOutput | ParsedPermissionRequestOutput | ParsedCompactOutput | ParsedSessionStartOutput | ParsedSubagentStartOutput | ParsedUserPromptSubmitOutput | ParsedStopOutput): RuntimeHookOutputEntry[] {
  const entries: RuntimeHookOutputEntry[] = [];
  if ('systemMessage' in parsed && parsed.systemMessage) entries.push({ kind: 'warning', text: parsed.systemMessage });
  if ('additionalContext' in parsed && parsed.additionalContext) entries.push({ kind: 'context', text: parsed.additionalContext });
  if ('stopped' in parsed && parsed.stopped && parsed.feedbackMessage) entries.push({ kind: 'stop', text: parsed.feedbackMessage });
  if ('invalidReason' in parsed && parsed.invalidReason) entries.push({ kind: 'error', text: parsed.invalidReason });
  if ('blockReason' in parsed && parsed.blockReason) entries.push({ kind: 'feedback', text: parsed.blockReason });
  if ('decision' in parsed && parsed.decision === 'deny') entries.push({ kind: 'feedback', text: parsed.message });
  if ('shouldStop' in parsed && parsed.shouldStop && parsed.stopReason && !('blockReason' in parsed && parsed.blockReason) && !('stopped' in parsed)) entries.push({ kind: 'stop', text: parsed.stopReason });
  const feedbackMessage = 'feedbackMessage' in parsed && typeof parsed.feedbackMessage === 'string' ? parsed.feedbackMessage : undefined;
  if ('shouldBlock' in parsed && parsed.shouldBlock && feedbackMessage) entries.push({ kind: 'feedback', text: feedbackMessage });
  return entries;
}

function hookRunId(eventName: RuntimeHookRunEventName, hook: RuntimeDiscoveredHook, input: RuntimeCommandHookInput, startedAt: string): string {
  if ('toolCall' in input) return `hook:${input.toolCall.id}:${eventName}:${hook.displayOrder}`;
  return `hook:${input.context.turnId}:${eventName}:${hook.displayOrder}:${startedAt}`;
}

function previewHookOutput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= 2000 ? trimmed : `${trimmed.slice(0, 2000)}...`;
}

function previewHookPrompt(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 2000 ? trimmed : `${trimmed.slice(0, 2000)}...`;
}

async function runCommandHook(hook: RuntimeDiscoveredHook, stdin: string, cwd: string, signal: AbortSignal | undefined): Promise<CommandProcessRunResult> {
  const command = hook.command ?? '';
  const shell = shellCommand(command);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(shell.file, shell.args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = (result: CommandProcessRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => {
      child.kill();
      finish({ exitCode: null, stdout, stderr, error: 'hook aborted' });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1, hook.timeoutSec) * 1000);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.on('error', (error) => finish({ exitCode: null, stdout, stderr, error: error.message }));
    child.on('close', (code) => {
      finish({
        exitCode: code,
        stdout,
        stderr,
        ...(timedOut ? { error: `hook timed out after ${hook.timeoutSec}s` } : {}),
      });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);
  });
}

function parsePreToolUseRun(run: CommandRunResult): ParsedPreToolUseOutput {
  if (run.error) return {};
  if (run.exitCode === 2) {
    const reason = run.stderr.trim();
    return reason ? { blockReason: reason } : { invalidReason: 'PreToolUse hook exited with code 2 but did not write a blocking reason to stderr' };
  }
  if (run.exitCode !== 0) return {};
  const output = parseJsonRecord(run.stdout);
  if (!output) return looksLikeJson(run.stdout) ? { invalidReason: 'hook returned invalid pre-tool-use JSON output' } : {};
  const specific = recordValue(output.hookSpecificOutput) ?? recordValue(output.hook_specific_output);
  const systemMessage = stringValue(output.systemMessage) ?? stringValue(output.system_message);
  const useHookSpecificDecision = Boolean(specific && (
    hasOwn(specific, 'permissionDecision')
    || hasOwn(specific, 'permission_decision')
    || hasOwn(specific, 'permissionDecisionReason')
    || hasOwn(specific, 'permission_decision_reason')
    || hasOwn(specific, 'updatedInput')
    || hasOwn(specific, 'updated_input')
  ));
  const permissionDecision = stringValue(specific?.permissionDecision) ?? stringValue(specific?.permission_decision);
  const legacyDecision = stringValue(output.decision);
  const legacyReason = stringValue(output.reason);
  const hookSpecificReason = stringValue(specific?.permissionDecisionReason) ?? stringValue(specific?.permission_decision_reason);
  const updatedInputCandidate = specific?.updatedInput ?? specific?.updated_input;
  const invalidReason = unsupportedPreToolUseUniversal(output)
    ?? (useHookSpecificDecision
      ? unsupportedPreToolUseHookSpecific(specific, permissionDecision, hookSpecificReason, updatedInputCandidate)
      : unsupportedPreToolUseLegacy(legacyDecision, legacyReason));
  if (invalidReason) return { invalidReason, ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}) };
  const blockReason = useHookSpecificDecision && permissionDecision === 'deny'
    ? trimmedText(hookSpecificReason)
    : !useHookSpecificDecision && legacyDecision === 'block'
      ? trimmedText(legacyReason)
      : undefined;
  const additionalContext = stringValue(specific?.additionalContext) ?? stringValue(specific?.additional_context);
  const updatedInput = useHookSpecificDecision && permissionDecision === 'allow'
    ? updatedInputCandidate
    : undefined;
  return {
    ...(blockReason ? { blockReason } : {}),
    ...(additionalContext?.trim() ? { additionalContext: additionalContext.trim() } : {}),
    ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    ...(updatedInput !== undefined ? { updatedInput } : {}),
  };
}

function parsePostToolUseRun(run: CommandRunResult): ParsedPostToolUseOutput {
  if (run.error) return { shouldBlock: false };
  if (run.exitCode === 2) {
    const reason = run.stderr.trim();
    return {
      shouldBlock: Boolean(reason),
      ...(reason ? { feedbackMessage: reason } : {}),
      ...(!reason ? { invalidReason: 'PostToolUse hook exited with code 2 but did not write feedback to stderr' } : {}),
    };
  }
  if (run.exitCode !== 0) return { shouldBlock: false };
  const output = parseJsonRecord(run.stdout);
  if (!output) return { shouldBlock: false, ...(looksLikeJson(run.stdout) ? { invalidReason: 'hook returned invalid post-tool-use JSON output' } : {}) };
  const specific = recordValue(output.hookSpecificOutput) ?? recordValue(output.hook_specific_output);
  const systemMessage = stringValue(output.systemMessage) ?? stringValue(output.system_message);
  const universalInvalidReason = unsupportedPostToolUseUniversal(output);
  const hookSpecificInvalidReason = specific && hasOwn(specific, 'updatedMCPToolOutput')
    ? 'PostToolUse hook returned unsupported updatedMCPToolOutput'
    : specific && hasOwn(specific, 'updated_mcp_tool_output')
      ? 'PostToolUse hook returned unsupported updatedMCPToolOutput'
      : undefined;
  const additionalContext = stringValue(specific?.additionalContext) ?? stringValue(specific?.additional_context);
  const continueProcessing = boolValue(output.continue) === false ? false : true;
  const stopReason = stringValue(output.stopReason) ?? stringValue(output.stop_reason);
  const decision = stringValue(output.decision);
  const shouldBlock = decision === 'block';
  const reason = stringValue(output.reason);
  const trimmedReason = trimmedText(reason);
  const invalidBlockReason = shouldBlock && !trimmedReason
    ? 'PostToolUse hook returned decision:block without a non-empty reason'
    : !shouldBlock && continueProcessing && reason !== undefined
      ? 'PostToolUse hook returned reason without decision'
      : undefined;
  const stopped = !continueProcessing;
  const stopMessage = trimmedReason ?? trimmedText(stopReason) ?? 'PostToolUse hook stopped execution';
  const invalidReason = stopped ? undefined : universalInvalidReason ?? hookSpecificInvalidReason ?? invalidBlockReason;
  return {
    shouldBlock: Boolean(shouldBlock && !invalidReason),
    ...(additionalContext?.trim() && !universalInvalidReason && !hookSpecificInvalidReason && !invalidBlockReason ? { additionalContext: additionalContext.trim() } : {}),
    ...(stopped ? { stopped: true, feedbackMessage: stopMessage } : shouldBlock && trimmedReason && !invalidReason ? { feedbackMessage: trimmedReason } : {}),
    ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    ...(invalidReason ? { invalidReason } : {}),
  };
}

function parsePermissionRequestRun(run: CommandRunResult): ParsedPermissionRequestOutput {
  if (run.error) return { decision: 'none' };
  if (run.exitCode === 2) {
    const message = run.stderr.trim();
    return message ? { decision: 'deny', message } : { decision: 'none', invalidReason: 'PermissionRequest hook exited with code 2 but did not write a denial reason to stderr' };
  }
  if (run.exitCode !== 0) return { decision: 'none' };
  const output = parseJsonRecord(run.stdout);
  if (!output) return { decision: 'none', ...(looksLikeJson(run.stdout) ? { invalidReason: 'hook returned invalid permission-request JSON output' } : {}) };
  const systemMessage = stringValue(output.systemMessage) ?? stringValue(output.system_message);
  const universalInvalidReason = unsupportedPermissionRequestUniversal(output);
  const specific = recordValue(output.hookSpecificOutput) ?? recordValue(output.hook_specific_output);
  const decision = recordValue(specific?.decision);
  const specificInvalidReason = unsupportedPermissionRequestDecision(decision);
  const invalidReason = universalInvalidReason ?? specificInvalidReason;
  if (invalidReason) return { decision: 'none', invalidReason, ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}) };
  const behavior = stringValue(decision?.behavior);
  if (behavior === 'allow') return { decision: 'allow', ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}) };
  if (behavior === 'deny') {
    const message = stringValue(decision?.message)?.trim() || stringValue(output.reason)?.trim() || 'PermissionRequest hook denied tool execution.';
    return { decision: 'deny', message, ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}) };
  }
  return { decision: 'none', ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}) };
}

function parseCompactRun(eventName: 'PreCompact' | 'PostCompact', run: CommandRunResult): ParsedCompactOutput {
  if (run.error) return { shouldStop: false };
  if (run.exitCode !== 0) {
    const message = run.stderr.trim() || `hook exited with code ${run.exitCode ?? 'unknown'}`;
    return { shouldStop: false, invalidReason: message };
  }
  const output = parseJsonRecord(run.stdout);
  if (!output) {
    if (looksLikeJson(run.stdout)) return { shouldStop: false, invalidReason: `hook returned invalid ${eventName} hook JSON output` };
    return { shouldStop: false };
  }
  const systemMessage = stringValue(output.systemMessage) ?? stringValue(output.system_message);
  const continueProcessing = boolValue(output.continue) === false ? false : true;
  const stopReason = trimmedText(stringValue(output.stopReason) ?? stringValue(output.stop_reason));
  const invalidReason = compactUnsupportedOutput(eventName, output, continueProcessing);
  if (!continueProcessing) {
    return {
      shouldStop: true,
      stopReason: stopReason ?? `${eventName} hook stopped execution`,
      ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    };
  }
  return {
    shouldStop: false,
    ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    ...(invalidReason ? { invalidReason } : {}),
  };
}

function parseSessionStartRun(run: CommandRunResult): ParsedSessionStartOutput {
  if (run.error) return { shouldStop: false };
  if (run.exitCode !== 0) {
    const message = run.stderr.trim() || `hook exited with code ${run.exitCode ?? 'unknown'}`;
    return { shouldStop: false, invalidReason: message };
  }
  const output = parseJsonRecord(run.stdout);
  if (!output) {
    const context = run.stdout.trim();
    if (looksLikeJson(run.stdout)) return { shouldStop: false, invalidReason: 'hook returned invalid session start JSON output' };
    return context ? { shouldStop: false, additionalContext: context } : { shouldStop: false };
  }
  const specific = recordValue(output.hookSpecificOutput) ?? recordValue(output.hook_specific_output);
  const systemMessage = stringValue(output.systemMessage) ?? stringValue(output.system_message);
  const additionalContext = stringValue(specific?.additionalContext) ?? stringValue(specific?.additional_context);
  const continueProcessing = boolValue(output.continue) === false ? false : true;
  const stopReason = trimmedText(stringValue(output.stopReason) ?? stringValue(output.stop_reason));
  if (!continueProcessing) {
    return {
      shouldStop: true,
      stopReason: stopReason ?? 'SessionStart hook stopped execution',
      ...(additionalContext?.trim() ? { additionalContext: additionalContext.trim() } : {}),
      ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    };
  }
  return {
    shouldStop: false,
    ...(additionalContext?.trim() ? { additionalContext: additionalContext.trim() } : {}),
    ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
  };
}

function parseSubagentStartRun(run: CommandRunResult): ParsedSubagentStartOutput {
  if (run.error) return {};
  if (run.exitCode !== 0) {
    const message = run.stderr.trim() || `hook exited with code ${run.exitCode ?? 'unknown'}`;
    return { invalidReason: message };
  }
  const output = parseJsonRecord(run.stdout);
  if (!output) {
    const context = run.stdout.trim();
    if (looksLikeJson(run.stdout)) return { invalidReason: 'hook returned invalid subagent start JSON output' };
    return context ? { additionalContext: context } : {};
  }
  const specific = recordValue(output.hookSpecificOutput) ?? recordValue(output.hook_specific_output);
  const systemMessage = stringValue(output.systemMessage) ?? stringValue(output.system_message);
  const additionalContext = stringValue(specific?.additionalContext) ?? stringValue(specific?.additional_context);
  return {
    ...(additionalContext?.trim() ? { additionalContext: additionalContext.trim() } : {}),
    ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
  };
}

function parseUserPromptSubmitRun(run: CommandRunResult): ParsedUserPromptSubmitOutput {
  if (run.error) return { shouldStop: false };
  if (run.exitCode === 2) {
    const reason = run.stderr.trim();
    return reason
      ? { shouldStop: true, blockReason: reason, stopReason: reason }
      : { shouldStop: false, invalidReason: 'UserPromptSubmit hook exited with code 2 but did not write a blocking reason to stderr' };
  }
  if (run.exitCode !== 0) return { shouldStop: false };
  const output = parseJsonRecord(run.stdout);
  if (!output) {
    const context = run.stdout.trim();
    if (looksLikeJson(run.stdout)) return { shouldStop: false, invalidReason: 'hook returned invalid user prompt submit JSON output' };
    return context ? { shouldStop: false, additionalContext: context } : { shouldStop: false };
  }
  const specific = recordValue(output.hookSpecificOutput) ?? recordValue(output.hook_specific_output);
  const systemMessage = stringValue(output.systemMessage) ?? stringValue(output.system_message);
  const additionalContext = stringValue(specific?.additionalContext) ?? stringValue(specific?.additional_context);
  const continueProcessing = boolValue(output.continue) === false ? false : true;
  const stopReason = trimmedText(stringValue(output.stopReason) ?? stringValue(output.stop_reason));
  const decision = stringValue(output.decision);
  const reason = trimmedText(stringValue(output.reason));
  const invalidReason = decision === 'block' && !reason
    ? 'UserPromptSubmit hook returned decision:block without a non-empty reason'
    : decision && decision !== 'block'
      ? 'hook returned invalid user prompt submit JSON output'
      : undefined;
  if (invalidReason) {
    return {
      shouldStop: false,
      invalidReason,
      ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    };
  }
  if (!continueProcessing) {
    return {
      shouldStop: true,
      stopReason: stopReason ?? 'UserPromptSubmit hook stopped execution',
      ...(additionalContext?.trim() ? { additionalContext: additionalContext.trim() } : {}),
      ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    };
  }
  if (decision === 'block' && reason) {
    return {
      shouldStop: true,
      blockReason: reason,
      stopReason: reason,
      ...(additionalContext?.trim() ? { additionalContext: additionalContext.trim() } : {}),
      ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    };
  }
  return {
    shouldStop: false,
    ...(additionalContext?.trim() ? { additionalContext: additionalContext.trim() } : {}),
    ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
  };
}

function parseStopRun(run: CommandRunResult, eventName: 'Stop' | 'SubagentStop' = 'Stop'): ParsedStopOutput {
  if (run.error) return { shouldBlock: false, shouldStop: false };
  if (run.exitCode === 2) {
    const reason = run.stderr.trim();
    return reason
      ? { shouldBlock: true, shouldStop: false, blockReason: reason }
      : { shouldBlock: false, shouldStop: false, invalidReason: `${eventName} hook exited with code 2 but did not write a continuation prompt to stderr` };
  }
  if (run.exitCode !== 0) return { shouldBlock: false, shouldStop: false };
  const output = parseJsonRecord(run.stdout);
  if (!output) {
    if (run.stdout.trim() || looksLikeJson(run.stdout)) {
      return {
        shouldBlock: false,
        shouldStop: false,
        invalidReason: eventName === 'SubagentStop'
          ? 'hook returned invalid subagent stop hook JSON output'
          : 'hook returned invalid stop hook JSON output',
      };
    }
    return { shouldBlock: false, shouldStop: false };
  }
  const systemMessage = stringValue(output.systemMessage) ?? stringValue(output.system_message);
  const continueProcessing = boolValue(output.continue) === false ? false : true;
  const stopReason = trimmedText(stringValue(output.stopReason) ?? stringValue(output.stop_reason));
  const decision = stringValue(output.decision);
  const reason = trimmedText(stringValue(output.reason));
  const invalidReason = decision === 'block' && !reason
    ? `${eventName} hook returned decision:block without a non-empty reason`
    : decision && decision !== 'block'
      ? eventName === 'SubagentStop'
        ? 'hook returned invalid subagent stop hook JSON output'
        : 'hook returned invalid stop hook JSON output'
      : undefined;
  if (invalidReason) {
    return {
      shouldBlock: false,
      shouldStop: false,
      invalidReason,
      ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    };
  }
  if (!continueProcessing) {
    return {
      shouldBlock: false,
      shouldStop: true,
      ...(stopReason ? { stopReason } : {}),
      ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    };
  }
  if (decision === 'block' && reason) {
    return {
      shouldBlock: true,
      shouldStop: false,
      blockReason: reason,
      ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
    };
  }
  return {
    shouldBlock: false,
    shouldStop: false,
    ...(systemMessage?.trim() ? { systemMessage: systemMessage.trim() } : {}),
  };
}

function unsupportedPreToolUseUniversal(output: Record<string, unknown>): string | undefined {
  if (boolValue(output.continue) === false) return 'PreToolUse hook returned unsupported continue:false';
  if (hasOwn(output, 'stopReason') || hasOwn(output, 'stop_reason')) return 'PreToolUse hook returned unsupported stopReason';
  if (boolValue(output.suppressOutput) === true || boolValue(output.suppress_output) === true) return 'PreToolUse hook returned unsupported suppressOutput';
  return undefined;
}

function unsupportedPermissionRequestUniversal(output: Record<string, unknown>): string | undefined {
  if (boolValue(output.continue) === false) return 'PermissionRequest hook returned unsupported continue:false';
  if (hasOwn(output, 'stopReason') || hasOwn(output, 'stop_reason')) return 'PermissionRequest hook returned unsupported stopReason';
  if (boolValue(output.suppressOutput) === true || boolValue(output.suppress_output) === true) return 'PermissionRequest hook returned unsupported suppressOutput';
  return undefined;
}

function unsupportedPostToolUseUniversal(output: Record<string, unknown>): string | undefined {
  if (boolValue(output.suppressOutput) === true || boolValue(output.suppress_output) === true) return 'PostToolUse hook returned unsupported suppressOutput';
  return undefined;
}

function compactUnsupportedOutput(eventName: 'PreCompact' | 'PostCompact', output: Record<string, unknown>, continueProcessing: boolean): string | undefined {
  if (!continueProcessing) return undefined;
  if (hasOwn(output, 'decision') || hasOwn(output, 'reason') || hasOwn(output, 'hookSpecificOutput') || hasOwn(output, 'hook_specific_output')) {
    return `hook returned invalid ${eventName} hook JSON output`;
  }
  return undefined;
}

function unsupportedPreToolUseHookSpecific(
  specific: Record<string, unknown> | null,
  permissionDecision: string | undefined,
  permissionDecisionReason: string | undefined,
  updatedInput: unknown,
): string | undefined {
  if (!specific) return undefined;
  if (updatedInput !== undefined && permissionDecision !== 'allow') {
    return 'PreToolUse hook returned updatedInput without permissionDecision:allow';
  }
  if (permissionDecision === 'allow' && updatedInput === undefined) {
    return 'PreToolUse hook returned unsupported permissionDecision:allow';
  }
  if (permissionDecision === 'ask') {
    return 'PreToolUse hook returned unsupported permissionDecision:ask';
  }
  if (permissionDecision && permissionDecision !== 'allow' && permissionDecision !== 'ask' && permissionDecision !== 'deny') {
    return 'hook returned invalid pre-tool-use JSON output';
  }
  if (permissionDecision === 'deny' && !trimmedText(permissionDecisionReason)) {
    return 'PreToolUse hook returned permissionDecision:deny without a non-empty permissionDecisionReason';
  }
  if (!permissionDecision && permissionDecisionReason !== undefined) {
    return 'PreToolUse hook returned permissionDecisionReason without permissionDecision';
  }
  return undefined;
}

function unsupportedPreToolUseLegacy(decision: string | undefined, reason: string | undefined): string | undefined {
  if (decision === 'approve') return 'PreToolUse hook returned unsupported decision:approve';
  if (decision === 'block' && !trimmedText(reason)) return 'PreToolUse hook returned decision:block without a non-empty reason';
  if (decision && decision !== 'approve' && decision !== 'block') return 'hook returned invalid pre-tool-use JSON output';
  if (!decision && reason !== undefined) return 'PreToolUse hook returned reason without decision';
  return undefined;
}

function unsupportedPermissionRequestDecision(decision: Record<string, unknown> | null): string | undefined {
  if (!decision) return undefined;
  if (hasOwn(decision, 'updatedInput') || hasOwn(decision, 'updated_input')) return 'PermissionRequest hook returned unsupported updatedInput';
  if (hasOwn(decision, 'updatedPermissions') || hasOwn(decision, 'updated_permissions')) return 'PermissionRequest hook returned unsupported updatedPermissions';
  if (boolValue(decision.interrupt) === true) return 'PermissionRequest hook returned unsupported interrupt:true';
  const behavior = stringValue(decision.behavior);
  if (behavior && behavior !== 'allow' && behavior !== 'deny') return 'hook returned invalid permission-request JSON output';
  return undefined;
}

function hookTrustStatus(currentHash: string, trustedHash: string | undefined): RuntimeHookMetadata['trustStatus'] {
  if (!trustedHash) return 'untrusted';
  return trustedHash === currentHash ? 'trusted' : 'modified';
}

function sha256CanonicalJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex')}`;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])]),
  );
}

function shellCommand(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      file: process.env.SETSUNA_WINDOWS_SHELL || process.env.SHELL || 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershellCommand(command)],
    };
  }
  return { file: '/bin/sh', args: ['-lc', command] };
}

function appendCapped(current: string, chunk: Buffer): string {
  if (current.length >= HOOK_OUTPUT_BYTES_CAP) return current;
  const next = current + chunk.toString('utf8');
  return next.length > HOOK_OUTPUT_BYTES_CAP ? next.slice(0, HOOK_OUTPUT_BYTES_CAP) : next;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed || !looksLikeJson(trimmed)) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return recordValue(parsed);
  } catch {
    return null;
  }
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null && record[key] !== undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function trimmedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toHookJson(value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}

function joinTextChunks(chunks: string[]): string | undefined {
  const text = chunks.map((chunk) => chunk.trim()).filter(Boolean).join('\n\n');
  return text || undefined;
}
