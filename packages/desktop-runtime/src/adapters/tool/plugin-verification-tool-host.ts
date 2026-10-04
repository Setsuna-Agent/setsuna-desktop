import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import {
  PLUGIN_UI_CARD_RESULT_KIND,
  parseRuntimePluginUiData,
  parseRuntimeApiRequest,
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
import { appBuilderToolOwner, requireAppBuilderTool } from './app-builder-tool-owner.js';

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

function verifyPluginDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: VERIFY_PLUGIN_TOOL,
    description: [
      text('Verify the host handlers and runtime API requests of an installed Setsuna Plugin.', "验证已安装 Setsuna 插件的宿主处理函数和 runtime API 请求。"),
      text('Runs approved checks through the real host-managed network/state path. UI-action checks call worker handlers directly; they do not execute page JavaScript, click buttons or test dialogs.', "通过真实的宿主管理网络和状态通道执行已批准的检查。ui-action 检查直接调用 worker 处理函数，不执行页面 JavaScript，不点击按钮，也不测试弹窗。"),
      text('Use after configure_plugin for every user-visible executable path; this requires explicit approval.', "configure_plugin 后对每条用户可见的可执行路径使用此工具；需要明确审批。"),
    ].join(' '),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pluginId: { type: 'string', description: text('Installed Plugin id returned by configure_plugin.', "configure_plugin 返回的已安装插件 ID。") },
        checks: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_VERIFICATION_CHECKS,
          description: text('Complete set of read-only or explicitly approved checks for every declared tool and visible Renderer UI action path.', "覆盖每个声明工具和可见 Renderer UI 操作的完整只读或已明确批准的检查集。"),
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['tool', 'ui-action', 'runtime-api'] },
              name: { type: 'string', description: text('Local tool name, UI action id, or GET /v1/ path for a runtime-api check.', "本地工具名称、UI 操作 ID，或 runtime-api 检查的 GET /v1/ 路径。") },
              input: { type: 'object', description: text('Tool arguments when kind is tool.', "kind 为 tool 时的工具参数。") },
              expectUiCard: { type: 'boolean', description: text('Require a plugin.ui-card result. Automatically true for declared uiCards tools.', "要求返回 plugin.ui-card；对声明为 uiCards 的工具自动启用。") },
              contributionId: { type: 'string', description: text('Renderer UI contribution that exposes the action.', "公开该操作的 Renderer UI contribution。") },
              values: { type: 'object', description: text('String form values supplied to a Renderer UI action.', "提供给 Renderer UI 操作的字符串表单值。") },
              payload: { type: 'object', description: text('Bounded JSON payload supplied by a sandboxed document.', "沙箱文档提供的有大小限制的 JSON 数据。") },
              expectStatePaths: {
                type: 'array',
                maxItems: 16,
                items: { type: 'string' },
                description: text('Dot-separated state paths that must exist after a UI action.', "UI 操作后必须存在的状态路径，以点分隔。"),
              },
            },
            required: ['kind', 'name'],
          },
        },
      },
      required: ['pluginId', 'checks'],
    },
  };
}

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

type RuntimeApiVerificationCheck = Readonly<{ kind: 'runtime-api'; name: string; contributionId: string }>;
type PluginVerificationCheck = ToolVerificationCheck | UiActionVerificationCheck | RuntimeApiVerificationCheck;
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
    private readonly plugins: Pick<PluginBundleStore, 'listInstalledRecords' | 'listPlugins'>,
    private readonly extensions: Pick<
      ExtensionRuntime,
      'listTools' | 'readRendererUiData' | 'runRendererUiAction' | 'runTool' | 'requestRuntimeApi'
    >,
  ) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return await appBuilderToolOwner(this.plugins, VERIFY_PLUGIN_TOOL, context)
      ? [verifyPluginDefinition(context.interfaceLanguage)] : [];
  }

  systemPrompt(context: ToolExecutionContext): string {
    const text = runtimeText(context.interfaceLanguage);
    return [
      text('Installing and activating an executable Plugin does not prove its handlers work.', "安装并激活可执行插件不能证明其处理函数正常工作。"),
      text('After configure_plugin, call verify_plugin with representative checks for every user-visible extension tool and Renderer UI action.', "configure_plugin 后，使用 verify_plugin 为每个用户可见的扩展工具和 Renderer UI 操作执行有代表性的检查。"),
      text('Report only the handlers and API checks that passed. This tool does not test page JavaScript, button clicks, dialogs or rendering; their behavior remains unverified without separate interaction evidence. Repair failed checks and verify again.', "仅报告已通过的处理函数和 API 检查。本工具不测试页面 JavaScript、按钮点击、弹窗或渲染；没有独立交互证据时，这些行为仍未验证。失败时修复后重新检查。"),
    ].join(' ');
  }

  async toolRuntimeProfile(name: string, context: ToolExecutionContext) {
    if (name !== VERIFY_PLUGIN_TOOL) return null;
    const plugin = await appBuilderToolOwner(this.plugins, name, context);
    if (!plugin) return null;
    return {
      plugin,
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
    await requireAppBuilderTool(this.plugins, name, context);
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
          : check.kind === 'runtime-api'
            ? await this.verifyRuntimeApi(plugin, check, context)
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
        `Verified host execution checks for Plugin ${plugin.name} (${plugin.id}).`,
        ...results.map((result) => [
          `- ${result.kind} ${result.name}`,
          result.contributionId ? ` @ ${result.contributionId}` : '',
          `: passed${result.resultKind ? ` (${result.resultKind})` : ''}`,
        ].join('')),
        'Host checks passed: true.',
        'Page interactions: not tested. These checks do not execute page JavaScript, click buttons, open dialogs or verify rendering.',
      ].join('\n'),
      preview: `Plugin ${plugin.name} 的宿主检查通过`,
      containsExternalContext: true,
      data: { pluginId: plugin.id, checksPassed: true, pageInteractionsVerified: false, checks: results },
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

  private async verifyRuntimeApi(
    plugin: InstalledPluginRecord, check: RuntimeApiVerificationCheck, context: ToolExecutionContext,
  ): Promise<VerificationResult> {
    const response = await this.extensions.requestRuntimeApi({
      pluginId: plugin.id, contributionId: check.contributionId, request: { path: check.name },
    }, context.signal);
    if (!response.ok) throw new Error(`Runtime API returned HTTP ${response.status}: ${JSON.stringify(response.data)}`);
    return { kind: check.kind, name: check.name, contributionId: check.contributionId, status: 'passed' };
  }
}

function assertCompleteVerificationCoverage(
  plugin: InstalledPluginRecord,
  checks: readonly PluginVerificationCheck[],
): void {
  const required = requiredVerificationPaths(plugin);
  const supplied = new Set<string>();
  for (const check of checks) {
    const key = verificationPathKey(check.kind, check.name, check.kind !== 'tool' ? check.contributionId : undefined);
    if (supplied.has(key)) {
      throw incompleteVerification(plugin, `Duplicate verification path: ${verificationPathLabel(check)}.`);
    }
    if (check.kind !== 'runtime-api' && !required.has(key)) {
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
    : `${kind}\u0000${contributionId ?? ''}\u0000${name}`;
}

function verificationPathLabel(check: PluginVerificationCheck): string {
  return check.kind === 'tool'
    ? `tool ${check.name}`
    : `${check.kind} ${check.name} @ ${check.contributionId}`;
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
    if (check.kind === 'runtime-api') {
      assertExactKeys(check, ['kind', 'name', 'contributionId'], `checks[${index}]`);
      return {
        kind: 'runtime-api',
        name: parseRuntimeApiRequest({ path: check.name }).path,
        contributionId: requiredText(check.contributionId, `checks[${index}].contributionId`),
      };
    }
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
    throw new Error(`checks[${index}].kind must be tool, ui-action or runtime-api.`);
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
