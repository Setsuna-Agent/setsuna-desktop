import type {
  RuntimePluginReference,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeThread,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';

export type RuntimePluginUse = RuntimePluginReference;

const pluginResourceToolNames = new Set(['list_plugin_resources', 'read_plugin_resource']);

/**
 * Collects durable and live Plugin attribution for every turn.
 *
 * New turns persist Plugin-backed Skill attribution in sampling snapshots. The
 * installed Skill/Plugin lists remain as a compatibility fallback for older
 * snapshots and are also needed to attribute Plugin Hooks and MCP calls.
 */
export function runtimePluginUsesByTurn(
  thread: RuntimeThread | null,
  skills: RuntimeSkillSummary[],
  plugins: RuntimePluginSummary[],
): Map<string, RuntimePluginUse[]> {
  if (!thread) return new Map();

  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const pluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const collected = new Map<string, Map<string, RuntimePluginUse>>();
  const addPlugin = (
    turnId: string | undefined,
    pluginId: string | undefined,
    embedded?: RuntimePluginReference,
    fallbackName?: string,
  ) => {
    if (!turnId || !pluginId) return;
    const installed = pluginById.get(pluginId);
    const plugin: RuntimePluginUse = {
      id: pluginId,
      name: embedded?.name || installed?.name || fallbackName || pluginId,
      ...(embedded?.icon || installed?.icon ? { icon: embedded?.icon || installed?.icon } : {}),
    };
    const turnPlugins = collected.get(turnId) ?? new Map<string, RuntimePluginUse>();
    const current = turnPlugins.get(pluginId);
    // Prefer richer metadata if a later source resolves the display name/icon.
    turnPlugins.set(pluginId, current ? mergePluginReference(current, plugin) : plugin);
    collected.set(turnId, turnPlugins);
  };

  for (const turn of thread.turns ?? []) {
    for (const step of turn.stepSnapshots ?? []) {
      for (const selectedSkill of step.snapshot.selectedSkills) {
        const currentSkill = skillById.get(selectedSkill.id);
        const pluginId = selectedSkill.plugin?.id ?? currentSkill?.pluginId;
        addPlugin(turn.id, pluginId, selectedSkill.plugin, currentSkill?.name ?? selectedSkill.name);
      }
    }
  }

  const addHookPlugin = (turnId: string | undefined, pluginId: string | undefined) => {
    addPlugin(turnId, pluginId, undefined, pluginId);
  };
  for (const run of thread.pendingHookRuns ?? []) addHookPlugin(run.turnId, run.pluginId);

  for (const message of thread.messages) {
    for (const run of message.hookRuns ?? []) addHookPlugin(message.turnId ?? run.turnId, run.pluginId);
    for (const toolRun of message.toolRuns ?? []) {
      for (const run of toolRun.hookRuns ?? []) addHookPlugin(message.turnId ?? run.turnId, run.pluginId);
      for (const pluginId of pluginIdsForToolRun(toolRun, plugins)) {
        addPlugin(message.turnId, pluginId);
      }
    }
  }

  return new Map(
    [...collected].map(([turnId, turnPlugins]) => [turnId, [...turnPlugins.values()]]),
  );
}

function mergePluginReference(current: RuntimePluginUse, next: RuntimePluginUse): RuntimePluginUse {
  return {
    id: current.id,
    name: current.name === current.id && next.name !== next.id ? next.name : current.name,
    ...(current.icon || next.icon ? { icon: current.icon ?? next.icon } : {}),
  };
}

function pluginIdsForToolRun(run: RuntimeToolRun, plugins: RuntimePluginSummary[]): string[] {
  const pluginIds = new Set<string>();
  for (const plugin of plugins) {
    if (plugin.mcpServers.some((server) => run.name.startsWith(`mcp__${safeToolNamePart(server.key)}__`))) {
      pluginIds.add(plugin.id);
    }
  }

  if (!pluginResourceToolNames.has(run.name)) return [...pluginIds];
  const argumentsPluginId = stringField(parseJsonRecord(run.argumentsPreview), 'pluginId', 'plugin_id');
  const dataPluginId = stringField(recordValue(run.data), 'pluginId', 'plugin_id');
  const pluginId = argumentsPluginId ?? dataPluginId;
  if (pluginId) pluginIds.add(pluginId);
  return [...pluginIds];
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return null;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function safeToolNamePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
}
