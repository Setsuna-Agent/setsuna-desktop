import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import {
  PLUGIN_UI_CARD_DECLARATION_LIMITS,
  RUNTIME_PLUGIN_UI_LIBRARIES,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import type { PluginDraftInput } from '../../ports/plugin-draft-store.js';
import {
  PLUGIN_MANIFEST_RELATIVE_PATH,
  normalizePluginId,
  safeRelativePath,
} from '../plugin/file-plugin-bundle-model.js';
import { assertCompleteConfigurePluginSnapshot } from './configure-plugin-preflight.js';
import { objectInput, requiredStringArg } from './tool-input.js';

export const CONFIGURE_PLUGIN_TOOL = 'configure_plugin';
export const MAX_CONFIGURE_PLUGIN_FILES = 64;
export const MAX_CONFIGURE_PLUGIN_TEXT_BYTES = 512 * 1024;

export type ConfigurePluginAction = 'create' | 'update';

function rendererUiSchema(language?: RuntimeInterfaceLanguage): Record<string, unknown> {
  const text = runtimeText(language);
  const rendererUiTextSourceSchema = {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: text('Dot-separated path inside the declared contribution data.', "声明的 contribution 数据内以点分隔的路径。") },
          fallback: { type: 'string' },
        },
        required: ['path'],
      },
    ],
  };

  const rendererUiTreeSchema = {
    type: 'object',
    description: [
      text('Recursive host-rendered node. Allowed exact shapes are:', "递归的宿主渲染节点。允许的准确结构为："),
      'stack {type,direction?,gap?,children}; text/badge {type,text,tone?};',
      'notice {type,title?,text,tone?}; field {type,name,label,defaultValue?,placeholder?,required?,maxLength?};',
      'select {type,name,label,defaultValue?,options}; button {type,actionId,label,variant?}.',
      text('Text, badge, notice text/title, and field/select defaults may use a {path,fallback?} binding.', "text、badge、notice 的 text/title，以及 field/select 默认值可以使用 {path,fallback?} 绑定。"),
    ].join(' '),
  };

  /** Kept explicit because this schema is the model's primary source of truth. */
  const configurePluginRendererUiSchema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    description: [
      text('Renderer UI v2 supports two modes.', "Renderer UI v2 支持两种模式。"),
      text('tree is a bounded host-rendered UI.', "tree 是由宿主渲染的受限 UI。"),
      text('document is a full-page sandboxed app backed by HTML/CSS/JS resources, with an entry below Plugins in the left sidebar. Use it for editable tables, forms, charts and custom layouts.', "document 是占满主区域的 HTML/CSS/JS 沙箱应用，入口位于左侧栏插件下方。可用于可编辑表格、表单、图表和自定义布局。"),
      text('Trusted apps can call all backend APIs via window.setsunaUI.runtime.request({path,method,body}), returning {ok,status,data}. Worker handlers use context.runtime.request. No extra capability, origin allowlist or active project is required. Inspect /v1/runtime-api with read_runtime_api before using existing projects or conversations.', "已信任应用通过 window.setsunaUI.runtime.request({path,method,body}) 调用全部后端 API，返回 {ok,status,data}；worker handler 使用 context.runtime.request。无需额外 capability、origin 白名单或当前项目。复用已有项目/对话前先用 read_runtime_api 读取 /v1/runtime-api。"),
      text('A contribution must declare exactly one mode.', "每个 contribution 必须且只能声明一种模式。"),
    ].join(' '),
    properties: {
      schemaVersion: { type: 'integer', enum: [2] },
      actions: {
        type: 'array',
        maxItems: 32,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            approval: {
              type: 'object',
              description: text('Optional extra confirmation for this page action. Omit for ordinary saves, local app state updates and refreshes; include only when the interaction needs confirmation, such as destructive actions. Installation trust and host permissions are enforced separately.', '页面操作的可选二次确认。普通保存、应用本地数据更新和刷新应省略；仅在删除等确实需要确认的交互中声明。安装信任和宿主权限独立校验。'),
              additionalProperties: false,
              properties: { title: { type: 'string' }, message: { type: 'string' } },
              required: ['message'],
            },
          },
          required: ['id'],
        },
      },
      contributions: {
        type: 'array',
        maxItems: 16,
        items: {
          type: 'object',
          additionalProperties: false,
          description: [
            text('renderer.plugin.page requires navigation.', "renderer.plugin.page 需要 navigation。"),
            text('renderer.settings.page.extensions requires target general or about.', "renderer.settings.page.extensions 的 target 必须为 general 或 about。"),
            text('renderer.capabilities.plugin.details adds one contribution to the Plugin details page.', "renderer.capabilities.plugin.details 向插件详情页添加一个 contribution。"),
            text('Settings and Plugin details data must use global scope.', "设置及插件详情数据必须使用 global scope。"),
            text('Put stateKey and scope inside data, never at this contribution root.', "stateKey 和 scope 应放在 data 内，不要放在 contribution 根层级。"),
          ].join(' '),
          properties: {
            id: { type: 'string' },
            slot: {
              type: 'string',
              enum: [
                'renderer.plugin.page',
                'renderer.settings.page.extensions',
                'renderer.chat.composer.status',
                'renderer.capabilities.plugin.details',
              ],
            },
            target: { type: 'string', enum: ['general', 'about'] },
            order: { type: 'number' },
            navigation: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string' },
                badge: rendererUiTextSourceSchema,
              },
              required: ['label'],
            },
            data: {
              type: 'object',
              additionalProperties: false,
              description: text('Required for state bindings. Project scope requires an active project; thread scope requires a conversation.', "状态绑定必填。project scope 需要当前项目；thread scope 需要对话。"),
              properties: {
                stateKey: { type: 'string' },
                scope: { type: 'string', enum: ['global', 'project', 'thread'] },
              },
              required: ['stateKey', 'scope'],
            },
            tree: rendererUiTreeSchema,
            document: {
              type: 'object',
              additionalProperties: false,
              description: [
                text('Free-form standalone UI loaded in an opaque-origin iframe.', "在不透明来源的 iframe 中加载的自由形式独立 UI。"),
                text('Network, Node, Electron, host DOM, native form submission, popups, downloads, and top navigation remain unavailable. HTML form controls work; save with declared host actions.', "无法使用网络、Node、Electron、宿主 DOM、原生表单提交、弹窗、下载或顶层导航。可以使用 HTML 表单控件，通过已声明的宿主操作保存。"),
                text('JavaScript uses window.setsunaUI for state snapshots and declared host actions.', "JavaScript 通过 window.setsunaUI 读取状态快照和调用已声明的宿主操作。"),
              ].join(' '),
              properties: {
                htmlResourceId: { type: 'string' },
                cssResourceId: { type: 'string' },
                jsResourceId: { type: 'string' },
                libraries: {
                  type: 'array',
                  maxItems: RUNTIME_PLUGIN_UI_LIBRARIES.length,
                  uniqueItems: true,
                  items: { type: 'string', enum: [...RUNTIME_PLUGIN_UI_LIBRARIES] },
                  description: text('Optional offline host libraries. ["echarts"] exposes window.echarts before page scripts; do not include library source or load a CDN.', '可选的宿主离线库。["echarts"] 在页面脚本前提供 window.echarts；不要提交库源码或加载 CDN。'),
                },
                actionIds: { type: 'array', maxItems: 32, items: { type: 'string' } },
              },
              required: ['htmlResourceId', 'actionIds'],
            },
          },
          required: ['id', 'slot'],
          anyOf: [
            { required: ['tree'] },
            { required: ['document'] },
          ],
        },
      },
    },
    required: ['schemaVersion', 'actions', 'contributions'],
  };

  return configurePluginRendererUiSchema;
}

export const configurePluginRendererUiSchema = rendererUiSchema();

export function configurePluginDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: CONFIGURE_PLUGIN_TOOL,
    description: text('Create or update a managed local Setsuna Plugin Bundle from a complete manifest and UTF-8 text files. Prefer files[].sourcePath for files already written in the workspace; do not resend or XML/HTML-encode their contents. Requires user approval.', '用完整清单及 UTF-8 文本文件创建或更新受管理的本地 Setsuna 插件包。已写入工作区的文件优先通过 files[].sourcePath 引用，不要重复发送源码或做 XML/HTML 转义。需要用户审批。'),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        manifest: {
          type: 'object',
          additionalProperties: false,
          description: text('Complete Plugin Bundle v2 manifest. schemaVersion is normalized to 2; featured marketplace fields are ignored.', "完整的 Plugin Bundle v2 清单。schemaVersion 会规范化为 2；精选市场字段会被忽略。"),
          properties: {
            schemaVersion: { type: 'integer', enum: [2] },
            id: { type: 'string', description: text('Stable lowercase plugin id.', "稳定的小写插件 ID。") },
            name: { type: 'string', description: text('User-facing plugin name.', "面向用户的插件名称。") },
            icon: { type: 'string', description: text('Optional built-in renderer icon token.', "可选内置 renderer 图标标识。") },
            version: { type: 'string', description: text('Plugin version. Defaults to 1.0.0.', "插件版本。默认 1.0.0。") },
            description: { type: 'string' },
            publisher: { type: 'string', description: text('Publisher label. Defaults to Local.', "发布者标签。默认 Local。") },
            tags: { type: 'array', items: { type: 'string' } },
            connectors: {
              type: 'array', maxItems: 32,
              description: text('Portable connector setup declarations. CLI commands are user instructions, never auto-executed. MCP entries reference mcpServers by key.', '可移植的连接器配置声明。CLI 配置命令仅作用户指引，不自动执行；MCP 通过 key 引用 mcpServers。'),
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
                  kind: { type: 'string', enum: ['cli', 'mcp'] }, required: { type: 'boolean' },
                  command: { type: 'string', description: text('CLI executable name on PATH, never an absolute path.', 'PATH 中的 CLI 可执行文件名，不能是绝对路径。') },
                  installUrl: { type: 'string', description: text('HTTPS installation instructions; required for CLI connectors.', 'HTTPS 安装说明地址，CLI 连接器必填。') },
                  documentationUrl: { type: 'string' },
                  setupCommands: { type: 'array', maxItems: 8, items: { type: 'string' } },
                  serverKey: { type: 'string', description: text('Declared MCP server key; required for MCP connectors.', '已声明的 MCP 服务 key，MCP 连接器必填。') },
                },
                required: ['id', 'name', 'kind'],
              },
            },
            tools: {
              type: 'array',
              description: text('Optional display metadata for tools supplied by the plugin.', "可选插件工具的显示元数据。"),
              items: {
                type: 'object',
                additionalProperties: false,
                properties: { name: { type: 'string' }, description: { type: 'string' } },
                required: ['name'],
              },
            },
            skills: {
              type: 'array',
              description: text('Relative Skill directories. Each directory must have a SKILL.md in files.', "Skill 相对目录。每个目录都必须在 files 中提供 SKILL.md。"),
              items: { type: 'string' },
            },
            mcpServers: {
              type: 'array',
              description: text('MCP servers without embedded credentials or environment values.', "不内嵌凭据或环境变量值的 MCP 服务。"),
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  key: { type: 'string' },
                  label: { type: 'string' },
                  description: { type: 'string' },
                  transport: { type: 'string', enum: ['stdio', 'streamableHttp', 'streamable_http'] },
                  command: { type: 'string' },
                  args: { type: 'array', items: { type: 'string' } },
                  cwd: { type: 'string' },
                  url: { type: 'string' },
                  timeoutMs: { type: 'integer' },
                  startupTimeoutMs: { type: 'integer' },
                  toolTimeoutMs: { type: 'integer' },
                  allowedTools: { type: 'array', items: { type: 'string' } },
                  disabledTools: { type: 'array', items: { type: 'string' } },
                  oauthClientId: { type: 'string' },
                  oauthResource: { type: 'string' },
                },
                required: ['key'],
              },
            },
            hooks: {
              type: 'array',
              description: text('Command Hooks. Bundle files should be referenced with {{pluginRoot}}.', "命令 Hook。通过 {{pluginRoot}} 引用包内文件。"),
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  eventName: { type: 'string' },
                  matcher: { type: 'string' },
                  command: { type: 'string' },
                  commandWindows: { type: 'string' },
                  timeoutSec: { type: 'integer' },
                  statusMessage: { type: 'string' },
                },
                required: ['eventName', 'command'],
              },
            },
            resources: {
              type: 'array',
              description: text('Declared text resources present in files, including sandboxed Plugin page HTML/CSS/JS.', "声明且存在于 files 中的文本资源，包括沙箱插件页面的 HTML/CSS/JS。"),
              items: {
                type: 'object',
                additionalProperties: false,
                properties: { id: { type: 'string' }, label: { type: 'string' }, path: { type: 'string' } },
                required: ['id', 'path'],
              },
            },
            extension: {
              type: 'object',
              additionalProperties: false,
              description: [
                text('Optional executable Node worker extension.', "可选的可执行 Node worker 扩展。"),
                text('A Plugin tool may return a sandboxed chat card in data using resultKind plugin.ui-card,', "插件工具可以在 data 中返回沙箱聊天卡片，使用 resultKind plugin.ui-card，"),
                text('resultMajor 1, and payload {id,title?,html,css?,js?,data?,permissions:{network:false,hostActions:[]}}.', "resultMajor 为 1，payload 为 {id,title?,html,css?,js?,data?,permissions:{network:false,hostActions:[]}}。"),
                text('Declare each card in uiCards with a static sandbox preview so Plugin details can show it before execution.', "在 uiCards 中声明每个卡片及其静态沙箱预览，以便插件详情页在执行前展示。"),
                text('This requires the ui capability. The host injects pluginId and validates source limits before persistence.', "需要 ui 能力。宿主会注入 pluginId，并在持久化前验证源码限制。"),
              ].join(' '),
              properties: {
                apiVersion: { type: 'integer', enum: [1] },
                runtime: { type: 'string', enum: ['node-worker'] },
                entry: { type: 'string', description: text('Relative JavaScript entry file present in files.', "存在于 files 中的相对 JavaScript 入口文件。") },
                capabilities: {
                  type: 'array',
                  items: { type: 'string', enum: ['tools', 'events', 'ui', 'state', 'network'] },
                },
                network: {
                  type: 'object',
                  additionalProperties: false,
                  description: text('Required when network is declared. Requests use the runtime proxy and exact origin allowlist.', "声明 network 时必填。请求使用运行时代理及精确 origin 白名单。"),
                  properties: {
                    allowedOrigins: {
                      type: 'array',
                      items: { type: 'string', description: text('Exact HTTP(S) origin, without a path.', "准确的 HTTP(S) origin，不含路径。") },
                    },
                  },
                  required: ['allowedOrigins'],
                },
                uiCards: {
                  type: 'array',
                  maxItems: PLUGIN_UI_CARD_DECLARATION_LIMITS.entries,
                  description: text('Install-time catalog metadata and a static sandbox preview for cards returned dynamically by declared tools.', "安装时使用的目录元数据及静态沙箱预览，对应声明工具动态返回的卡片。"),
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string', description: text('Stable card template id.', "稳定的卡片模板 ID。") },
                      label: { type: 'string', description: text('User-facing card name.', "面向用户的卡片名称。") },
                      description: { type: 'string' },
                      toolName: { type: 'string', description: text('Name of the declared tool that returns this card.', "返回此卡片的已声明工具名称。") },
                      preview: {
                        type: 'object',
                        additionalProperties: false,
                        description: text('Static sample rendered without executing the tool, making network requests, or exposing host actions.', "静态渲染示例，不执行工具、不发网络请求、不暴露宿主操作。"),
                        properties: {
                          html: { type: 'string' },
                          css: { type: 'string' },
                          js: { type: 'string' },
                          data: { type: 'object', description: text('Bounded JSON sample data for window.setsunaUI.ready.', "提供给 window.setsunaUI.ready 的有大小限制的 JSON 示例数据。") },
                        },
                        anyOf: [{ required: ['html'] }, { required: ['js'] }],
                      },
                    },
                    required: ['id', 'label', 'toolName', 'preview'],
                  },
                },
                rendererUi: rendererUiSchema(language),
              },
              required: ['apiVersion', 'runtime', 'entry', 'capabilities'],
            },
          },
          required: ['id', 'name'],
        },
        files: {
          type: 'array',
          description: text(`Complete UTF-8 text-file snapshot. Omitted files are removed on update; maximum ${MAX_CONFIGURE_PLUGIN_FILES} files and ${MAX_CONFIGURE_PLUGIN_TEXT_BYTES} bytes.`, `完整的 UTF-8 文本文件快照。更新时省略的文件会被删除；最多 ${MAX_CONFIGURE_PLUGIN_FILES} 个文件、${MAX_CONFIGURE_PLUGIN_TEXT_BYTES} 字节。`),
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: text('Bundle-relative file path. The manifest file is generated automatically.', "相对于插件包的文件路径。清单文件会自动生成。") },
              content: { type: 'string', description: text('Complete raw UTF-8 text, as a JSON string. Preserve HTML entities and source characters; no extra XML/HTML or Base64 encoding. Use sourcePath for existing files.', '完整的原始 UTF-8 文本，以 JSON 字符串传入。保留 HTML 实体及源码字符，不要额外做 XML/HTML 或 Base64 编码。已有文件使用 sourcePath。') },
              sourcePath: { type: 'string', description: text('Read the exact UTF-8 contents of an existing workspace file. Relative to the current workspace, or an absolute path within approved readable roots. Provide exactly one of sourcePath or content.', '直接读取工作区现有文件的原始 UTF-8 内容。相对当前工作区的路径，或已批准可读范围内的绝对路径。sourcePath 与 content 必须且只能提供一个。') },
            },
            required: ['path'],
            oneOf: [{ required: ['content'] }, { required: ['sourcePath'] }],
          },
        },
      },
      required: ['manifest', 'files'],
    },
  };
}

export const configurePluginTool = configurePluginDefinition();

export function normalizeConfigurePluginInput(input: unknown): PluginDraftInput {
  const args = objectInput(input);
  const manifest = normalizeConfigurePluginManifestShorthand(jsonObject(args.manifest, 'manifest'));
  assertNoUnknownSchemaProperties(
    { ...args, manifest },
    configurePluginTool.inputSchema,
    'configure_plugin',
  );
  const pluginId = normalizePluginId(requiredStringArg(manifest.id, 'manifest.id'));
  const name = requiredStringArg(manifest.name, 'manifest.name');
  const normalizedManifest: Record<string, unknown> = {
    ...manifest,
    schemaVersion: 2,
    id: pluginId,
    name,
    version: optionalText(manifest.version) ?? '1.0.0',
    publisher: optionalText(manifest.publisher) ?? 'Local',
    tags: manifest.tags ?? [],
    featured: false,
  };
  delete normalizedManifest.schema_version;
  delete normalizedManifest.featuredOrder;
  delete normalizedManifest.featured_order;
  if (!Array.isArray(args.files)) throw new Error('files must be an array.');
  if (args.files.length > MAX_CONFIGURE_PLUGIN_FILES) {
    throw new Error(`configure_plugin supports at most ${MAX_CONFIGURE_PLUGIN_FILES} text files.`);
  }
  const seen = new Set<string>();
  const files = args.files.map((value, index) => {
    const file = objectInput(value);
    const relativePath = safeRelativePath(requiredStringArg(file.path, `files[${index}].path`), `files[${index}].path`)
      .replaceAll('\\', '/');
    const comparisonPath = relativePath.toLowerCase();
    if (comparisonPath === PLUGIN_MANIFEST_RELATIVE_PATH.replaceAll('\\', '/').toLowerCase()) {
      throw new Error('files cannot include .setsuna-plugin/plugin.json; it is generated from manifest.');
    }
    if (seen.has(comparisonPath)) throw new Error(`Duplicate configure_plugin file path: ${relativePath}`);
    seen.add(comparisonPath);
    if (typeof file.content !== 'string') throw new Error(`files[${index}].content must be text.`);
    return { path: relativePath, content: file.content };
  }).sort((left, right) => left.path.localeCompare(right.path));

  const bytes = Buffer.byteLength(JSON.stringify(normalizedManifest))
    + files.reduce((total, file) => total + Buffer.byteLength(file.content), 0);
  if (bytes > MAX_CONFIGURE_PLUGIN_TEXT_BYTES) {
    throw new Error(`configure_plugin text input exceeds ${MAX_CONFIGURE_PLUGIN_TEXT_BYTES} bytes.`);
  }
  const normalized = { pluginId, manifest: normalizedManifest, files };
  assertCompleteConfigurePluginSnapshot(normalized);
  return normalized;
}

/**
 * Repairs only unambiguous shapes emitted by older prompts. Everything else is
 * checked against the advertised tool schema below instead of being silently
 * copied into a bundle and discarded by the manifest reader.
 */
function normalizeConfigurePluginManifestShorthand(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const manifest = { ...value };
  for (const ignored of ['featured', 'featuredOrder', 'featured_order']) delete manifest[ignored];
  if (manifest.schemaVersion === undefined && manifest.schema_version !== undefined) {
    manifest.schemaVersion = manifest.schema_version;
  }
  delete manifest.schema_version;

  const extension = objectOrNull(manifest.extension);
  if (manifest.uiCards !== undefined) {
    if (!extension) {
      throw new Error('manifest.uiCards requires manifest.extension; move it to manifest.extension.uiCards.');
    }
    if (extension.uiCards !== undefined) {
      throw new Error('Declare UI cards only once at manifest.extension.uiCards.');
    }
    manifest.extension = { ...extension, uiCards: manifest.uiCards };
    delete manifest.uiCards;
  }
  if (manifest.extension !== undefined) {
    manifest.extension = normalizeRendererUiContributionShorthand(manifest.extension);
  }
  return manifest;
}

export function configurePluginArgumentsPreview(input: PluginDraftInput, action: ConfigurePluginAction): string {
  return JSON.stringify({ action, manifest: input.manifest, files: input.files });
}

export function configurePluginResultPreview(input: PluginDraftInput, action: ConfigurePluginAction): string {
  const extension = objectOrNull(input.manifest.extension);
  return JSON.stringify({
    action,
    id: input.pluginId,
    name: input.manifest.name,
    version: input.manifest.version,
    publisher: input.manifest.publisher,
    capabilities: {
      tools: arrayLength(input.manifest.tools),
      skills: arrayLength(input.manifest.skills),
      mcpServers: arrayLength(input.manifest.mcpServers),
      hooks: arrayLength(input.manifest.hooks),
      resources: arrayLength(input.manifest.resources),
      extension: extension ? stringArray(extension.capabilities) : [],
      uiCards: arrayLength(extension?.uiCards),
      rendererUi: arrayLength(objectOrNull(extension?.rendererUi)?.contributions),
    },
    files: input.files.map((file) => ({
      path: file.path,
      bytes: Buffer.byteLength(file.content),
      sha256: createHash('sha256').update(file.content).digest('hex'),
    })),
  });
}

export function configurePluginIntegrityToken(input: PluginDraftInput, action: ConfigurePluginAction): string {
  const canonical = JSON.stringify(canonicalJson({ action, input }));
  return `configure-plugin:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function configurePluginContainsExecutableCode(input: PluginDraftInput): boolean {
  return Boolean(input.manifest.extension) || arrayLength(input.manifest.hooks) > 0;
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  const normalized = jsonValue(value, label);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return normalized as Record<string, unknown>;
}

/** Enforces the `additionalProperties: false` boundary advertised to models. */
function assertNoUnknownSchemaProperties(
  value: unknown,
  schemaValue: unknown,
  path: string,
): void {
  const schema = objectOrNull(schemaValue);
  if (!schema) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoUnknownSchemaProperties(item, schema.items, `${path}[${index}]`);
    });
    return;
  }
  const record = objectOrNull(value);
  if (!record) return;

  const properties = objectOrNull(schema.properties) ?? {};
  if (schema.additionalProperties === false) {
    const unknown = Object.keys(record).filter((key) => !(key in properties));
    if (unknown.length) {
      throw new Error(`${path} contains unsupported ${unknown.length === 1 ? 'field' : 'fields'}: ${unknown.join(', ')}.`);
    }
  }
  for (const [key, item] of Object.entries(record)) {
    if (key in properties) assertNoUnknownSchemaProperties(item, properties[key], `${path}.${key}`);
  }
}

/**
 * Earlier prompts commonly placed these two fields beside `tree`. Repair only
 * that unambiguous AI-tool shorthand; bundle installation remains strict.
 */
function normalizeRendererUiContributionShorthand(value: unknown): unknown {
  const extension = objectOrNull(value);
  const rendererUi = objectOrNull(extension?.rendererUi);
  if (!extension || !rendererUi || rendererUi.schemaVersion !== 2 || !Array.isArray(rendererUi.contributions)) {
    return value;
  }
  let changed = false;
  const contributions = rendererUi.contributions.map((item) => {
    const contribution = objectOrNull(item);
    if (!contribution || contribution.data !== undefined || typeof contribution.stateKey !== 'string') return item;
    const declaredScopes = [contribution.scope, contribution.stateScope].filter((scope) => scope !== undefined);
    const scope = declaredScopes[0];
    if (
      declaredScopes.length !== 1
      || (scope !== 'global' && scope !== 'project' && scope !== 'thread')
    ) {
      return item;
    }
    const normalized = { ...contribution };
    delete normalized.stateKey;
    delete normalized.scope;
    delete normalized.stateScope;
    normalized.data = { stateKey: contribution.stateKey, scope };
    changed = true;
    return normalized;
  });
  return changed ? { ...extension, rendererUi: { ...rendererUi, contributions } } : value;
}

function jsonValue(value: unknown, label: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${label}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${label}.${key}`)]));
  }
  throw new Error(`${label} must contain only JSON values.`);
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
