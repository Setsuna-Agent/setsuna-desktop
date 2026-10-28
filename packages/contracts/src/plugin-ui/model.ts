export const RUNTIME_PLUGIN_UI_SCHEMA_VERSION = 2 as const;
export const RUNTIME_PLUGIN_UI_LEGACY_SCHEMA_VERSION = 1 as const;

export const RUNTIME_PLUGIN_UI_LIMITS = Object.freeze({
  actions: 32,
  contributions: 16,
  dataBytes: 64 * 1024,
  dataDepth: 8,
  dataEntries: 512,
  depth: 8,
  fields: 24,
  nodes: 128,
  optionsPerSelect: 20,
  textCharacters: 16_384,
  valueCharacters: 4_000,
});

export type RuntimePluginUiSlotId =
  | 'renderer.chat.composer.status'
  | 'renderer.capabilities.plugin.details'
  | 'renderer.settings.page.extensions'
  | 'renderer.plugin.page';

export type RuntimePluginUiTone = 'default' | 'muted' | 'success' | 'warning' | 'danger';

export type RuntimePluginUiBinding = Readonly<{
  /** Dot-separated path resolved against the contribution's bounded state snapshot. */
  path: string;
  fallback?: string;
}>;

export type RuntimePluginUiTextSource = string | RuntimePluginUiBinding;
export type RuntimePluginUiDataScope = 'global' | 'project' | 'thread';
export type RuntimePluginUiSettingsTarget = 'about' | 'general';

export type RuntimePluginUiStackNode = Readonly<{
  type: 'stack';
  direction?: 'column' | 'row';
  gap?: 'compact' | 'normal';
  children: readonly RuntimePluginUiNode[];
}>;

export type RuntimePluginUiTextNode = Readonly<{
  type: 'text';
  text: RuntimePluginUiTextSource;
  tone?: RuntimePluginUiTone;
}>;

export type RuntimePluginUiBadgeNode = Readonly<{
  type: 'badge';
  text: RuntimePluginUiTextSource;
  tone?: RuntimePluginUiTone;
}>;

export type RuntimePluginUiNoticeNode = Readonly<{
  type: 'notice';
  text: RuntimePluginUiTextSource;
  title?: RuntimePluginUiTextSource;
  tone?: Exclude<RuntimePluginUiTone, 'muted'>;
}>;

export type RuntimePluginUiButtonNode = Readonly<{
  type: 'button';
  actionId: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
}>;

export type RuntimePluginUiFieldNode = Readonly<{
  type: 'field';
  name: string;
  label: string;
  /** Host-managed credential: never hydrated from or persisted into Plugin state. */
  secret?: boolean;
  defaultValue?: RuntimePluginUiTextSource;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
}>;

export type RuntimePluginUiSelectNode = Readonly<{
  type: 'select';
  name: string;
  label: string;
  defaultValue?: RuntimePluginUiTextSource;
  options: readonly Readonly<{ label: string; value: string }>[];
}>;

export type RuntimePluginUiNumberNode = Readonly<{
  type: 'number'; name: string; label: string;
  defaultValue?: number; min?: number; max?: number; step?: number; required?: boolean;
}>;
export type RuntimePluginUiBooleanNode = Readonly<{
  type: 'boolean'; name: string; label: string; defaultValue?: boolean;
}>;

export type RuntimePluginUiNode =
  | RuntimePluginUiStackNode
  | RuntimePluginUiTextNode
  | RuntimePluginUiBadgeNode
  | RuntimePluginUiNoticeNode
  | RuntimePluginUiButtonNode
  | RuntimePluginUiFieldNode
  | RuntimePluginUiSelectNode
  | RuntimePluginUiNumberNode
  | RuntimePluginUiBooleanNode;

export type RuntimePluginUiAction = Readonly<{
  id: string;
  /** Optional interaction confirmation, independent of bundle trust and tool approval. */
  approval?: Readonly<{
    message: string;
    title?: string;
  }>;
}>;

export const RUNTIME_PLUGIN_UI_LIBRARIES = ['echarts'] as const;
export type RuntimePluginUiLibrary = typeof RUNTIME_PLUGIN_UI_LIBRARIES[number];

export type RuntimePluginUiDocument = Readonly<{
  htmlResourceId: string;
  cssResourceId?: string;
  jsResourceId?: string;
  /** Host-bundled libraries loaded inside the sandbox before Plugin source. */
  libraries?: readonly RuntimePluginUiLibrary[];
  /** Exact manifest actions that the isolated document may request from its host page. */
  actionIds: readonly string[];
}>;

export type RuntimePluginUiReactApp = Readonly<{
  /** Bundle-relative independent project directory, excluding dependencies and build output. */
  root: string;
  /** Project-relative default React component. Additional routes export default components too. */
  entry: string;
  routes?: readonly Readonly<{ path: string; entry: string }>[];
  actionIds: readonly string[];
}>;

export type RuntimePluginUiManifest = Readonly<{
  schemaVersion: typeof RUNTIME_PLUGIN_UI_LEGACY_SCHEMA_VERSION | typeof RUNTIME_PLUGIN_UI_SCHEMA_VERSION;
  actions: readonly RuntimePluginUiAction[];
  contributions: readonly RuntimePluginUiContribution[];
}>;

export type RuntimePluginUiActionInput = Readonly<{
  pluginId: string;
  actionId: string;
  values: Readonly<Record<string, string>>;
  /** Host-only edits: omitted/empty retains the credential; null explicitly clears it. */
  secretChanges?: Readonly<Record<string, string | null>>;
  /** Bounded JSON supplied by an isolated Plugin document. */
  payload?: RuntimePluginUiData;
  context: Readonly<{
    contributionId: string;
    cwd?: string;
    surface: RuntimePluginUiSlotId;
    projectId?: string;
    threadId?: string;
  }>;
}>;

export type RuntimePluginUiActionResult = Readonly<{ status: 'completed' }>;

export type RuntimePluginUiStateInput = Readonly<{
  pluginId: string;
  contributionId: string;
}>;

export type RuntimePluginUiStateResult = Readonly<{
  values: Readonly<Record<string, string>>;
}>;

export type RuntimePluginUiDataValue =
  | boolean
  | null
  | number
  | string
  | readonly RuntimePluginUiDataValue[]
  | Readonly<{ [key: string]: RuntimePluginUiDataValue }>;

export type RuntimePluginUiData = Readonly<Record<string, RuntimePluginUiDataValue>>;

export type RuntimePluginUiDataInput = Readonly<{
  pluginId: string;
  context: Readonly<{
    contributionId: string;
    surface: RuntimePluginUiSlotId;
    projectId?: string;
    threadId?: string;
  }>;
}>;

export type RuntimePluginUiDataResult = Readonly<{
  data: RuntimePluginUiData;
  /** Presence only; plaintext credentials never cross the read boundary. */
  configuredSecrets?: readonly string[];
}>;

export type RuntimePluginUiDocumentReadInput = Readonly<{
  pluginId: string;
  contributionId: string;
}>;

/**
 * Document bytes from a verified Bundle snapshot, or hash-bound compiled
 * application output published with the user's trusted Plugin revision.
 */
export type RuntimePluginUiDocumentReadResult = Readonly<{
  revision: string;
  html: string;
  css: string;
  js: string;
}>;

type RuntimePluginUiContributionBase = Readonly<{
  id: string;
  slot: RuntimePluginUiSlotId;
  /** Legacy global state record used to hydrate declared fields. */
  stateKey?: string;
  /** Host-owned settings page target for schema v2 settings contributions. */
  target?: RuntimePluginUiSettingsTarget;
  order?: number;
  /** Required for a standalone Plugin page; rendered by the host in the sidebar. */
  navigation?: Readonly<{ label: string; badge?: RuntimePluginUiTextSource }>;
  /** State projection used by bindings and as the default action state scope. */
  data?: Readonly<{ stateKey: string; scope: RuntimePluginUiDataScope }>;
}>;

export type RuntimePluginUiTreeContribution = Readonly<RuntimePluginUiContributionBase & {
  tree: RuntimePluginUiNode;
  document?: never;
  webpage?: never;
  reactApp?: never;
}>;

export type RuntimePluginUiDocumentContribution = Readonly<RuntimePluginUiContributionBase & {
  document: RuntimePluginUiDocument;
  tree?: never;
  webpage?: never;
  reactApp?: never;
}>;

export type RuntimePluginUiReactAppContribution = Readonly<RuntimePluginUiContributionBase & {
  slot: 'renderer.plugin.page';
  reactApp: RuntimePluginUiReactApp;
  tree?: never;
  document?: never;
  webpage?: never;
}>;

export type RuntimePluginUiWebpageContribution = Readonly<RuntimePluginUiContributionBase & {
  slot: 'renderer.plugin.page';
  /** Remote browser content receives no Plugin action/runtime bridge. */
  webpage: Readonly<{ url: string }>;
  tree?: never;
  document?: never;
  reactApp?: never;
}>;

export type RuntimePluginUiContribution =
  | RuntimePluginUiTreeContribution
  | RuntimePluginUiDocumentContribution
  | RuntimePluginUiReactAppContribution
  | RuntimePluginUiWebpageContribution;

export function runtimePluginUiSecretFields(node?: RuntimePluginUiNode): readonly RuntimePluginUiFieldNode[] {
  if (!node) return [];
  if (node.type === 'field') return node.secret ? [node] : [];
  return node.type === 'stack' ? node.children.flatMap(runtimePluginUiSecretFields) : [];
}

export function parsePluginUiWebpage(value: unknown): Readonly<{ url: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'url')) {
    throw new Error('Invalid Plugin rendererUi webpage.');
  }
  const { url: input } = value as Record<string, unknown>;
  if (typeof input !== 'string' || input.length > 8_192) throw new Error('Invalid Plugin webpage URL.');
  const url = new URL(input);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('Plugin webpage URL must use HTTP(S) without embedded credentials.');
  }
  return Object.freeze({ url: url.href });
}
