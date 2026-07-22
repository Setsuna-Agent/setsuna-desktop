import type { RuntimeHookMetadata } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { powershellCommand } from '../utils/windows-shell.js';
import type {
  CommandRunResult,
  ParsedCompactOutput,
  ParsedPermissionRequestOutput,
  ParsedPostToolUseOutput,
  ParsedPreToolUseOutput,
  ParsedSessionStartOutput,
  ParsedStopOutput,
  ParsedSubagentStartOutput,
  ParsedUserPromptSubmitOutput,
} from './runtime-hook-types.js';

const HOOK_OUTPUT_BYTES_CAP = 1024 * 1024;

export function parsePreToolUseRun(run: CommandRunResult): ParsedPreToolUseOutput {
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

export function parsePostToolUseRun(run: CommandRunResult): ParsedPostToolUseOutput {
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

export function parsePermissionRequestRun(run: CommandRunResult): ParsedPermissionRequestOutput {
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

export function parseCompactRun(eventName: 'PreCompact' | 'PostCompact', run: CommandRunResult): ParsedCompactOutput {
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

export function parseSessionStartRun(run: CommandRunResult): ParsedSessionStartOutput {
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

export function parseSubagentStartRun(run: CommandRunResult): ParsedSubagentStartOutput {
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

export function parseUserPromptSubmitRun(run: CommandRunResult): ParsedUserPromptSubmitOutput {
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

export function parseStopRun(run: CommandRunResult, eventName: 'Stop' | 'SubagentStop' = 'Stop'): ParsedStopOutput {
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

export function unsupportedPreToolUseUniversal(output: Record<string, unknown>): string | undefined {
  if (boolValue(output.continue) === false) return 'PreToolUse hook returned unsupported continue:false';
  if (hasOwn(output, 'stopReason') || hasOwn(output, 'stop_reason')) return 'PreToolUse hook returned unsupported stopReason';
  if (boolValue(output.suppressOutput) === true || boolValue(output.suppress_output) === true) return 'PreToolUse hook returned unsupported suppressOutput';
  return undefined;
}

export function unsupportedPermissionRequestUniversal(output: Record<string, unknown>): string | undefined {
  if (boolValue(output.continue) === false) return 'PermissionRequest hook returned unsupported continue:false';
  if (hasOwn(output, 'stopReason') || hasOwn(output, 'stop_reason')) return 'PermissionRequest hook returned unsupported stopReason';
  if (boolValue(output.suppressOutput) === true || boolValue(output.suppress_output) === true) return 'PermissionRequest hook returned unsupported suppressOutput';
  return undefined;
}

export function unsupportedPostToolUseUniversal(output: Record<string, unknown>): string | undefined {
  if (boolValue(output.suppressOutput) === true || boolValue(output.suppress_output) === true) return 'PostToolUse hook returned unsupported suppressOutput';
  return undefined;
}

export function compactUnsupportedOutput(eventName: 'PreCompact' | 'PostCompact', output: Record<string, unknown>, continueProcessing: boolean): string | undefined {
  if (!continueProcessing) return undefined;
  if (hasOwn(output, 'decision') || hasOwn(output, 'reason') || hasOwn(output, 'hookSpecificOutput') || hasOwn(output, 'hook_specific_output')) {
    return `hook returned invalid ${eventName} hook JSON output`;
  }
  return undefined;
}

export function unsupportedPreToolUseHookSpecific(
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

export function unsupportedPreToolUseLegacy(decision: string | undefined, reason: string | undefined): string | undefined {
  if (decision === 'approve') return 'PreToolUse hook returned unsupported decision:approve';
  if (decision === 'block' && !trimmedText(reason)) return 'PreToolUse hook returned decision:block without a non-empty reason';
  if (decision && decision !== 'approve' && decision !== 'block') return 'hook returned invalid pre-tool-use JSON output';
  if (!decision && reason !== undefined) return 'PreToolUse hook returned reason without decision';
  return undefined;
}

export function unsupportedPermissionRequestDecision(decision: Record<string, unknown> | null): string | undefined {
  if (!decision) return undefined;
  if (hasOwn(decision, 'updatedInput') || hasOwn(decision, 'updated_input')) return 'PermissionRequest hook returned unsupported updatedInput';
  if (hasOwn(decision, 'updatedPermissions') || hasOwn(decision, 'updated_permissions')) return 'PermissionRequest hook returned unsupported updatedPermissions';
  if (boolValue(decision.interrupt) === true) return 'PermissionRequest hook returned unsupported interrupt:true';
  const behavior = stringValue(decision.behavior);
  if (behavior && behavior !== 'allow' && behavior !== 'deny') return 'hook returned invalid permission-request JSON output';
  return undefined;
}

export function hookTrustStatus(currentHash: string, trustedHash: string | undefined): RuntimeHookMetadata['trustStatus'] {
  if (!trustedHash) return 'untrusted';
  return trustedHash === currentHash ? 'trusted' : 'modified';
}

export function sha256CanonicalJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex')}`;
}

export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])]),
  );
}

export function shellCommand(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      file: process.env.SETSUNA_WINDOWS_SHELL || process.env.SHELL || 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershellCommand(command)],
    };
  }
  return { file: '/bin/sh', args: ['-lc', command] };
}

export function appendCapped(current: string, chunk: Buffer): string {
  if (current.length >= HOOK_OUTPUT_BYTES_CAP) return current;
  const next = current + chunk.toString('utf8');
  return next.length > HOOK_OUTPUT_BYTES_CAP ? next.slice(0, HOOK_OUTPUT_BYTES_CAP) : next;
}

export function parseJsonRecord(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed || !looksLikeJson(trimmed)) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return recordValue(parsed);
  } catch {
    return null;
  }
}

export function looksLikeJson(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null && record[key] !== undefined;
}

export function boolValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function trimmedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function toHookJson(value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}

export function joinTextChunks(chunks: string[]): string | undefined {
  const text = chunks.map((chunk) => chunk.trim()).filter(Boolean).join('\n\n');
  return text || undefined;
}
