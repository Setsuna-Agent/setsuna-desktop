import {
  PLUGIN_UI_CARD_RESULT_KIND,
  parseRuntimePluginUiData,
  type RuntimePluginUiData,
  type RuntimePluginUiManifest,
  type RuntimePluginUiNode,
  type RuntimePluginUiSlotId,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { ExtensionRegisteredTool, ExtensionRuntime } from '../../ports/extension-runtime.js';
import type { InstalledPluginRecord, PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import {
  ToolExecutionError,
  type ToolApprovalRequirement,
  type ToolExecutionContext,
  type ToolExecutionPreview,
  type ToolExecutionResult,
  type ToolHost,
} from '../../ports/tool-host.js';
import { normalizePluginId } from '../plugin/file-plugin-bundle-model.js';

export const VERIFY_PLUGIN_TOOL = 'verify_plugin';
const MAX_VERIFICATION_CHECKS = 512;
const MAX_RESULT_PREVIEW_CHARACTERS = 500;

type PluginVerificationSurface = Readonly<{
  tools?: readonly Readonly<{ name: string }>[];
  extension?: Readonly<{ rendererUi?: RuntimePluginUiManifest }>;
}>;

export function pluginRequiresFunctionalVerification(plugin: PluginVerificationSurface): boolean {
  return Boolean(plugin.extension) && requiredVerificationPaths(plugin).size > 0;
}

const verifyPluginTool: RuntimeToolDefinition = {
  name: VERIFY_PLUGIN_TOOL,
  description: [
    'Functionally verify an installed Setsuna Plugin before claiming it is usable.',
    'Runs one approved check for every declared tool and visible Renderer UI action path through the real host-managed network/state path.',
    'Use after configure_plugin for every user-visible executable path; this requires explicit approval.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pluginId: { type: 'string', description: 'Installed Plugin id returned by configure_plugin.' },
      checks: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_VERIFICATION_CHECKS,
        description: 'Complete set of read-only or explicitly approved checks for every declared tool and visible Renderer UI action path.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['tool', 'ui-action'] },
            name: { type: 'string', description: 'Local extension tool name or Renderer UI action id.' },
            input: { type: 'object', description: 'Tool arguments when kind is tool.' },
            expectUiCard: { type: 'boolean', description: 'Require a plugin.ui-card result. Automatically true for declared uiCards tools.' },
            contributionId: { type: 'string', description: 'Renderer UI contribution that exposes the action.' },
            values: { type: 'object', description: 'String form values supplied to a Renderer UI action.' },
            payload: { type: 'object', description: 'Bounded JSON payload supplied by a sandboxed document.' },
            expectStatePaths: {
              type: 'array',
              maxItems: 16,
              items: { type: 'string' },
              description: 'Dot-separated state paths that must exist after a UI action.',
            },
          },
          required: ['kind', 'name'],
        },
      },
    },
    required: ['pluginId', 'checks'],
  },
};

type ToolVerificationCheck = Readonly<{
  kind: 'tool';
  name: string;
  input: Record<string, unknown>;
  expectUiCard: boolean;
}>;

type UiActionVerificationCheck = Readonly<{
  kind: 'ui-action';
  name: string;
  contributionId: string;
  values: Record<string, string>;
  payload?: RuntimePluginUiData;
  expectStatePaths: string[];
}>;

type PluginVerificationCheck = ToolVerificationCheck | UiActionVerificationCheck;
type PluginVerificationInput = Readonly<{ pluginId: string; checks: PluginVerificationCheck[] }>;

type VerificationResult = Readonly<{
  kind: PluginVerificationCheck['kind'];
  name: string;
  status: 'passed';
  resultKind?: string;
  contentPreview?: string;
  contributionId?: string;
  statePaths?: string[];
}>;

export class PluginVerificationToolHost implements ToolHost {
  constructor(
    private readonly plugins: Pick<PluginBundleStore, 'listInstalledRecords'>,
    private readonly extensions: Pick<
      ExtensionRuntime,
      'listTools' | 'readRendererUiData' | 'runRendererUiAction' | 'runTool'
    >,
  ) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return context.features?.plugins === false ? [] : [verifyPluginTool];
  }

  systemPrompt(): string {
    return [
      'Installing and activating an executable Plugin does not prove its handlers work.',
      'After configure_plugin, call verify_plugin with representative checks for every user-visible extension tool and Renderer UI action.',
      'Do not report the Plugin as usable unless verify_plugin returns "Verified and usable: true"; repair the complete bundle and verify again on failure.',
    ].join(' ');
  }

  toolRuntimeProfile(name: string) {
    if (name !== VERIFY_PLUGIN_TOOL) return null;
    return {
      supportsParallel: false,
      waitsForRuntimeCancellation: true,
      approvalMode: 'orchestrated' as const,
      requiresSandboxBypassApproval: true,
    };
  }

  async approvalForTool(name: string, input: unknown): Promise<ToolApprovalRequirement | null> {
    if (name !== VERIFY_PLUGIN_TOOL) return null;
    const normalized = normalizeVerificationInput(input);
    const plugin = await this.installedPlugin(normalized.pluginId);
    assertCompleteVerificationCoverage(plugin, normalized.checks);
    return {
      reason: `验证 Plugin ${normalized.pluginId} 将实际执行 ${normalized.checks.length} 个扩展路径，可能使用其已批准的网络能力并更新 Plugin 状态。`,
      argumentsPreview: verificationPreview(normalized),
      rejectWhenApprovalDisabled: true,
    };
  }

  async previewToolCall(
    name: string,
    input: unknown,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionPreview | null> {
    if (name !== VERIFY_PLUGIN_TOOL) return null;
    const normalized = normalizeVerificationInput(input);
    return {
      argumentsPreview: verificationPreview(normalized),
      resultPreview: `执行 ${normalized.pluginId} 的 ${normalized.checks.length} 个功能检查`,
    };
  }

  async runTool(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (name !== VERIFY_PLUGIN_TOOL) throw new Error(`Unknown Plugin verification tool: ${name}`);
    const normalized = normalizeVerificationInput(input);
    const plugin = await this.installedPlugin(normalized.pluginId);
    assertCompleteVerificationCoverage(plugin, normalized.checks);

    const registeredTools = normalized.checks.some((check) => check.kind === 'tool')
      ? await this.extensions.listTools(context)
      : [];
    const results: VerificationResult[] = [];
    for (const [index, check] of normalized.checks.entries()) {
      try {
        results.push(check.kind === 'tool'
          ? await this.verifyTool(plugin, check, registeredTools, context)
          : await this.verifyUiAction(plugin, check, context));
      } catch (error) {
        if (context.signal?.aborted) throw context.signal.reason ?? error;
        throw new ToolExecutionError(
          `Plugin verification failed at checks[${index}] (${check.kind} ${check.name}): ${errorMessage(error)}`,
          {
            failureKind: 'plugin_verification_failed',
            failureStage: 'execution',
            data: { pluginId: plugin.id, check: { kind: check.kind, name: check.name } },
          },
        );
      }
    }

    return {
      content: [
        `Verified Plugin ${plugin.name} (${plugin.id}).`,
        ...results.map((result) => [
          `- ${result.kind} ${result.name}`,
          result.contributionId ? ` @ ${result.contributionId}` : '',
          `: passed${result.resultKind ? ` (${result.resultKind})` : ''}`,
        ].join('')),
        'Verified and usable: true.',
      ].join('\n'),
      preview: `已验证 Plugin ${plugin.name}`,
      containsExternalContext: true,
      data: { pluginId: plugin.id, verified: true, checks: results },
    };
  }

  private async installedPlugin(pluginId: string): Promise<InstalledPluginRecord> {
    const plugin = (await this.plugins.listInstalledRecords())
      .find((candidate) => candidate.id === pluginId);
    if (!plugin?.extension) throw new Error(`Executable Plugin is not installed: ${pluginId}`);
    return plugin;
  }

  private async verifyTool(
    plugin: InstalledPluginRecord,
    check: ToolVerificationCheck,
    registeredTools: ExtensionRegisteredTool[],
    context: ToolExecutionContext,
  ): Promise<VerificationResult> {
    const tool = registeredTools.find((candidate) => (
      candidate.plugin.id === plugin.id && candidate.localName === check.name
    ));
    if (!tool) throw new Error(`Plugin did not expose declared tool ${check.name}.`);
    const result = await this.extensions.runTool(tool.name, check.input, context);
    const resultKind = toolResultKind(result.data);
    const declaredCard = plugin.extension?.uiCards?.some((card) => card.toolName === check.name) === true;
    if ((declaredCard || check.expectUiCard) && resultKind !== PLUGIN_UI_CARD_RESULT_KIND) {
      throw new Error(`Expected ${PLUGIN_UI_CARD_RESULT_KIND}, received ${resultKind ?? 'no structured result'}.`);
    }
    return {
      kind: check.kind,
      name: check.name,
      status: 'passed',
      ...(resultKind ? { resultKind } : {}),
      ...(result.content.trim() ? {
        contentPreview: result.content.trim().slice(0, MAX_RESULT_PREVIEW_CHARACTERS),
      } : {}),
    };
  }

  private async verifyUiAction(
    plugin: InstalledPluginRecord,
    check: UiActionVerificationCheck,
    context: ToolExecutionContext,
  ): Promise<VerificationResult> {
    const contribution = plugin.extension?.rendererUi?.contributions
      .find((candidate) => candidate.id === check.contributionId);
    if (!contribution) throw new Error(`Unknown Renderer UI contribution ${check.contributionId}.`);
    await this.extensions.runRendererUiAction({
      pluginId: plugin.id,
      actionId: check.name,
      values: check.values,
      ...(check.payload ? { payload: check.payload } : {}),
      context: rendererUiContext(contribution.id, contribution.slot, context),
    }, context.signal);

    if (contribution.data && check.expectStatePaths.length) {
      const state = await this.extensions.readRendererUiData({
        pluginId: plugin.id,
        context: rendererUiContext(contribution.id, contribution.slot, context),
      });
      for (const statePath of check.expectStatePaths) {
        if (!hasPath(state.data, statePath)) throw new Error(`Expected state path was not written: ${statePath}.`);
      }
    } else if (check.expectStatePaths.length) {
      throw new Error(`Contribution ${contribution.id} does not declare a data state binding.`);
    }
    return {
      kind: check.kind,
      name: check.name,
      status: 'passed',
      contributionId: contribution.id,
      ...(check.expectStatePaths.length ? { statePaths: [...check.expectStatePaths] } : {}),
    };
  }
}

function assertCompleteVerificationCoverage(
  plugin: InstalledPluginRecord,
  checks: readonly PluginVerificationCheck[],
): void {
  const required = requiredVerificationPaths(plugin);
  const supplied = new Set<string>();
  for (const check of checks) {
    const key = verificationPathKey(check.kind, check.name, check.kind === 'ui-action' ? check.contributionId : undefined);
    if (supplied.has(key)) {
      throw incompleteVerification(plugin, `Duplicate verification path: ${verificationPathLabel(check)}.`);
    }
    if (!required.has(key)) {
      throw incompleteVerification(plugin, `Unexpected verification path: ${verificationPathLabel(check)}.`);
    }
    supplied.add(key);
  }
  const missing = [...required.entries()]
    .filter(([key]) => !supplied.has(key))
    .map(([, label]) => label);
  if (missing.length) {
    throw incompleteVerification(plugin, `Missing verification paths: ${missing.join(', ')}.`);
  }
}

function requiredVerificationPaths(plugin: PluginVerificationSurface): ReadonlyMap<string, string> {
  const paths = new Map<string, string>();
  for (const tool of plugin.tools ?? []) {
    paths.set(verificationPathKey('tool', tool.name), `tool ${tool.name}`);
  }
  for (const contribution of plugin.extension?.rendererUi?.contributions ?? []) {
    const actionIds = contribution.document
      ? contribution.document.actionIds
      : collectNodeActionIds(contribution.tree);
    for (const actionId of actionIds) {
      paths.set(
        verificationPathKey('ui-action', actionId, contribution.id),
        `ui-action ${actionId} @ ${contribution.id}`,
      );
    }
  }
  return paths;
}

function collectNodeActionIds(node: RuntimePluginUiNode): string[] {
  if (node.type === 'button') return [node.actionId];
  if (node.type !== 'stack') return [];
  return [...new Set(node.children.flatMap(collectNodeActionIds))];
}

function verificationPathKey(
  kind: PluginVerificationCheck['kind'],
  name: string,
  contributionId?: string,
): string {
  return kind === 'tool'
    ? `tool\u0000${name}`
    : `ui-action\u0000${contributionId ?? ''}\u0000${name}`;
}

function verificationPathLabel(check: PluginVerificationCheck): string {
  return check.kind === 'tool'
    ? `tool ${check.name}`
    : `ui-action ${check.name} @ ${check.contributionId}`;
}

function incompleteVerification(plugin: InstalledPluginRecord, detail: string): ToolExecutionError {
  return new ToolExecutionError(
    `Plugin verification coverage is incomplete for ${plugin.id}. ${detail}`,
    {
      failureKind: 'plugin_verification_incomplete',
      failureStage: 'validation',
      data: { pluginId: plugin.id },
    },
  );
}

function normalizeVerificationInput(input: unknown): PluginVerificationInput {
  const root = exactRecord(input, ['pluginId', 'checks'], 'verify_plugin input');
  const pluginId = normalizePluginId(requiredText(root.pluginId, 'pluginId'));
  if (!Array.isArray(root.checks) || !root.checks.length || root.checks.length > MAX_VERIFICATION_CHECKS) {
    throw new Error(`checks must contain between 1 and ${MAX_VERIFICATION_CHECKS} entries.`);
  }
  const checks = root.checks.map((value, index): PluginVerificationCheck => {
    const check = record(value, `checks[${index}] must be an object.`);
    if (check.kind === 'tool') {
      assertExactKeys(check, ['kind', 'name', 'input', 'expectUiCard'], `checks[${index}]`);
      return {
        kind: 'tool',
        name: requiredText(check.name, `checks[${index}].name`),
        input: check.input === undefined ? {} : record(check.input, `checks[${index}].input must be an object.`),
        expectUiCard: optionalBoolean(check.expectUiCard, `checks[${index}].expectUiCard`) ?? false,
      };
    }
    if (check.kind === 'ui-action') {
      assertExactKeys(
        check,
        ['kind', 'name', 'contributionId', 'values', 'payload', 'expectStatePaths'],
        `checks[${index}]`,
      );
      return {
        kind: 'ui-action',
        name: requiredText(check.name, `checks[${index}].name`),
        contributionId: requiredText(check.contributionId, `checks[${index}].contributionId`),
        values: stringRecord(check.values, `checks[${index}].values`),
        ...(check.payload === undefined ? {} : {
          payload: parseRuntimePluginUiData(check.payload),
        }),
        expectStatePaths: statePaths(check.expectStatePaths, `checks[${index}].expectStatePaths`),
      };
    }
    throw new Error(`checks[${index}].kind must be tool or ui-action.`);
  });
  return { pluginId, checks };
}

function rendererUiContext(
  contributionId: string,
  surface: RuntimePluginUiSlotId,
  context: ToolExecutionContext,
) {
  return {
    contributionId,
    surface,
    ...(context.environment?.cwd ? { cwd: context.environment.cwd } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.threadId ? { threadId: context.threadId } : {}),
  };
}

function verificationPreview(input: PluginVerificationInput): string {
  return JSON.stringify(input);
}

function toolResultKind(value: unknown): string | undefined {
  const envelope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return typeof envelope?.resultKind === 'string' ? envelope.resultKind : undefined;
}

function hasPath(value: unknown, statePath: string): boolean {
  let current: unknown = value;
  for (const segment of statePath.split('.')) {
    if (
      !current
      || typeof current !== 'object'
      || Array.isArray(current)
      || !Object.hasOwn(current, segment)
    ) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return current !== undefined;
}

function statePaths(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new Error(`${label} must be an array with at most 16 entries.`);
  return value.map((item, index) => {
    const path = requiredText(item, `${label}[${index}]`);
    if (!/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/u.test(path)) {
      throw new Error(`${label}[${index}] is not a valid state path.`);
    }
    return path;
  });
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  const input = record(value, `${label} must be an object.`);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== 'string') throw new Error(`${label}.${key} must be a string.`);
    output[key] = item;
  }
  return output;
}

function exactRecord(value: unknown, keys: string[], label: string): Record<string, unknown> {
  const input = record(value, `${label} must be an object.`);
  assertExactKeys(input, keys, label);
  return input;
}

function assertExactKeys(input: Record<string, unknown>, keys: string[], label: string): void {
  const allowed = new Set(keys);
  const unsupported = Object.keys(input).find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`${label} contains unsupported field: ${unsupported}.`);
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
