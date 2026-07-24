import type {
  RuntimeHookEventName,
  RuntimeHookHandlerConfig,
  RuntimeHookState,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { desktopDataLayout } from './layout.js';

const HOOK_EVENT_LABELS: Array<{
  event: RuntimeHookEventName;
  keyLabel: string;
  matcherEnabled: boolean;
}> = [
  { event: 'PreToolUse', keyLabel: 'pre_tool_use', matcherEnabled: true },
  { event: 'PermissionRequest', keyLabel: 'permission_request', matcherEnabled: true },
  { event: 'PostToolUse', keyLabel: 'post_tool_use', matcherEnabled: true },
  { event: 'PreCompact', keyLabel: 'pre_compact', matcherEnabled: true },
  { event: 'PostCompact', keyLabel: 'post_compact', matcherEnabled: true },
  { event: 'SessionStart', keyLabel: 'session_start', matcherEnabled: true },
  { event: 'UserPromptSubmit', keyLabel: 'user_prompt_submit', matcherEnabled: false },
  { event: 'SubagentStart', keyLabel: 'subagent_start', matcherEnabled: true },
  { event: 'SubagentStop', keyLabel: 'subagent_stop', matcherEnabled: true },
  { event: 'Stop', keyLabel: 'stop', matcherEnabled: false },
];
const MAX_RELOCATABLE_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * Rewrites only runtime-owned derived paths. User project paths and arbitrary workspace
 * contents are intentionally left untouched.
 */
export async function relocateDataRootContents(
  stagingRoot: string,
  sourceRoot: string,
  targetRoot: string,
): Promise<void> {
  const layout = desktopDataLayout(stagingRoot);
  await relocateRuntimeConfig(layout.runtimeConfigPath, sourceRoot, targetRoot);
  await Promise.all([
    relocateJsonFile(path.join(layout.runtimeRoot, 'plugins.json'), sourceRoot, targetRoot),
    relocateJsonFile(path.join(layout.runtimeRoot, 'mcp.json'), sourceRoot, targetRoot),
    relocateJsonFile(
      path.join(layout.runtimeRoot, 'workspace-dependencies', 'manifest.json'),
      sourceRoot,
      targetRoot,
    ),
  ]);
  await relocateManagedDependencyText(
    path.join(layout.runtimeRoot, 'workspace-dependencies'),
    sourceRoot,
    targetRoot,
  );
  await relocateVirtualEnvironmentText(
    path.join(layout.runtimeRoot, 'temporary-workspace'),
    sourceRoot,
    targetRoot,
  );
}

async function relocateRuntimeConfig(
  configPath: string,
  sourceRoot: string,
  targetRoot: string,
): Promise<void> {
  const config = await readJsonRecord(configPath);
  if (!config) return;
  delete config.storagePath;
  config.schemaVersion = Math.max(3, numericValue(config.schemaVersion));
  const hooks = recordValue(config.hooks);
  if (hooks) relocateHooks(hooks, sourceRoot, targetRoot);
  await writeJson(configPath, config);
}

function relocateHooks(
  hooks: Record<string, unknown>,
  sourceRoot: string,
  targetRoot: string,
): void {
  const oldConfigPath = desktopDataLayout(sourceRoot).runtimeConfigPath;
  const newConfigPath = desktopDataLayout(targetRoot).runtimeConfigPath;
  const oldState = recordValue(hooks.state) ?? {};
  const nextState: Record<string, RuntimeHookState> = {};

  for (const { event, keyLabel, matcherEnabled } of HOOK_EVENT_LABELS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    groups.forEach((rawGroup, groupIndex) => {
      const group = recordValue(rawGroup);
      if (!group) return;
      const matcherValue = typeof group.matcher === 'string' ? group.matcher.trim() : '';
      const matcher = matcherEnabled ? matcherValue || null : null;
      const handlers = Array.isArray(group.hooks) ? group.hooks : [];
      handlers.forEach((rawHandler, handlerIndex) => {
        const handlerRecord = recordValue(rawHandler);
        if (!handlerRecord) return;
        const handler = handlerRecord as RuntimeHookHandlerConfig;
        const before = { ...handler };
        const oldSourcePath = before.sourcePath ? path.resolve(before.sourcePath) : oldConfigPath;
        const oldKey = `${oldSourcePath}:${keyLabel}:${groupIndex}:${handlerIndex}`;
        relocateHookHandler(handler, sourceRoot, targetRoot);
        const newSourcePath = handler.sourcePath ? path.resolve(handler.sourcePath) : newConfigPath;
        const newKey = `${newSourcePath}:${keyLabel}:${groupIndex}:${handlerIndex}`;
        const state = recordValue(oldState[oldKey]) as RuntimeHookState | null;
        if (!state) return;
        const oldHash = commandHookHash(keyLabel, matcher, before);
        const newHash = commandHookHash(keyLabel, matcher, handler);
        nextState[newKey] = {
          ...state,
          ...(state.trustedHash === oldHash ? { trustedHash: newHash } : {}),
        };
      });
    });
  }

  for (const [key, rawState] of Object.entries(oldState)) {
    const relocatedKey = replaceDataRoot(key, sourceRoot, targetRoot);
    if (!nextState[relocatedKey] && recordValue(rawState)) {
      nextState[relocatedKey] = rawState as RuntimeHookState;
    }
  }
  if (Object.keys(nextState).length) hooks.state = nextState;
  else delete hooks.state;
}

function relocateHookHandler(
  handler: RuntimeHookHandlerConfig,
  sourceRoot: string,
  targetRoot: string,
): void {
  if (handler.command) handler.command = replaceDataRoot(handler.command, sourceRoot, targetRoot);
  if (handler.commandWindows) {
    handler.commandWindows = replaceDataRoot(handler.commandWindows, sourceRoot, targetRoot);
  }
  if (handler.sourcePath) {
    handler.sourcePath = replaceDataRoot(handler.sourcePath, sourceRoot, targetRoot);
  }
}

function commandHookHash(
  eventName: string,
  matcher: string | null,
  handler: RuntimeHookHandlerConfig,
): string {
  const command = (process.platform === 'win32'
    ? handler.commandWindows || handler.command
    : handler.command)?.trim() ?? '';
  const timeoutSec = Math.max(1, Math.floor(handler.timeoutSec ?? 600));
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

async function relocateJsonFile(
  filePath: string,
  sourceRoot: string,
  targetRoot: string,
): Promise<void> {
  const value = await readJsonRecord(filePath);
  if (!value) return;
  await writeJson(filePath, relocateJsonValue(value, sourceRoot, targetRoot));
}

function relocateJsonValue(value: unknown, sourceRoot: string, targetRoot: string): unknown {
  if (typeof value === 'string') return replaceDataRoot(value, sourceRoot, targetRoot);
  if (Array.isArray(value)) {
    return value.map((item) => relocateJsonValue(item, sourceRoot, targetRoot));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    replaceDataRoot(key, sourceRoot, targetRoot),
    relocateJsonValue(item, sourceRoot, targetRoot),
  ]));
}

async function relocateManagedDependencyText(
  root: string,
  sourceRoot: string,
  targetRoot: string,
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === 'cache' || entry.isSymbolicLink()) continue;
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await relocateManagedDependencyText(candidate, sourceRoot, targetRoot);
      continue;
    }
    if (!entry.isFile()) continue;
    const buffer = await readFile(candidate);
    if (buffer.byteLength > MAX_RELOCATABLE_TEXT_BYTES || buffer.includes(0)) continue;
    const content = buffer.toString('utf8');
    const relocated = replaceDataRoot(content, sourceRoot, targetRoot);
    if (relocated !== content) await writeFile(candidate, relocated, 'utf8');
  }
}

async function relocateVirtualEnvironmentText(
  root: string,
  sourceRoot: string,
  targetRoot: string,
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = path.join(root, entry.name);
    if (entry.name.toLowerCase() === '.venv') {
      // venv metadata, activation scripts and console entry points embed absolute
      // interpreter paths. They are runtime-derived, so relocating these occurrences
      // is safe while arbitrary temporary-workspace project files stay untouched.
      await relocateManagedDependencyText(candidate, sourceRoot, targetRoot);
      continue;
    }
    await relocateVirtualEnvironmentText(candidate, sourceRoot, targetRoot);
  }
}

function replaceDataRoot(value: string, sourceRoot: string, targetRoot: string): string {
  let result = value;
  const replacements = new Map([
    [path.resolve(sourceRoot), path.resolve(targetRoot)],
    [path.resolve(sourceRoot).replaceAll('\\', '/'), path.resolve(targetRoot).replaceAll('\\', '/')],
    [path.resolve(sourceRoot).replaceAll('/', '\\'), path.resolve(targetRoot).replaceAll('/', '\\')],
  ]);
  for (const [source, target] of replacements) {
    if (!source || source === target) continue;
    result = replacePathPrefixOccurrences(result, source, target);
  }
  return result;
}

function replacePathPrefixOccurrences(value: string, source: string, target: string): string {
  let cursor = 0;
  let result = '';
  for (;;) {
    const index = value.indexOf(source, cursor);
    if (index === -1) return result + value.slice(cursor);
    const next = value[index + source.length];
    result += value.slice(cursor, index);
    if (next === undefined || next === '/' || next === '\\' || /\s|["'`]/u.test(next)) {
      result += target;
    } else {
      result += source;
    }
    cursor = index + source.length;
  }
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

async function readJsonRecord(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return recordValue(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numericValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
