import type {
  RuntimeConfigState,
  RuntimeHookEventName,
  RuntimeHookHandlerConfig,
  RuntimeHookOutputEntry,
  RuntimeHookRun,
  RuntimeHookRunEventName,
  RuntimeHookRunStatus
} from '@setsuna-desktop/contracts';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ToolExecutionResult } from '../ports/tool-host.js';
import {
  appendCapped,
  hookTrustStatus,
  joinTextChunks,
  parseCompactRun,
  parsePermissionRequestRun,
  parsePostToolUseRun,
  parsePreToolUseRun,
  parseSessionStartRun,
  parseStopRun,
  parseSubagentStartRun,
  parseUserPromptSubmitRun,
  recordValue,
  sha256CanonicalJson,
  shellCommand,
  stringValue,
  toHookJson
} from './runtime-hook-output.js';
import type {
  CommandProcessRunResult,
  CommandRunResult,
  ParsedCompactOutput,
  ParsedPermissionRequestOutput,
  ParsedPostToolUseOutput,
  ParsedPreToolUseOutput,
  ParsedSessionStartOutput,
  ParsedStopOutput,
  ParsedSubagentStartOutput,
  ParsedUserPromptSubmitOutput,
  RuntimeCompactHookInput,
  RuntimeDiscoveredHook,
  RuntimeHookDiscovery,
  RuntimeHookDiscoveryEvent,
  RuntimeSessionStartHookInput,
  RuntimeStopHookInput,
  RuntimeSubagentStartHookInput,
  RuntimeSubagentStopHookInput,
  RuntimeToolHookInput,
  RuntimeToolHookRunner,
  RuntimeToolPostHookInput,
  RuntimeUserPromptSubmitHookInput
} from './runtime-hook-types.js';
export type * from './runtime-hook-types.js';

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
