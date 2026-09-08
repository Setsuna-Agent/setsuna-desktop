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

export type RuntimePluginUiNode =
  | RuntimePluginUiStackNode
  | RuntimePluginUiTextNode
  | RuntimePluginUiBadgeNode
  | RuntimePluginUiNoticeNode
  | RuntimePluginUiButtonNode
  | RuntimePluginUiFieldNode
  | RuntimePluginUiSelectNode;

export type RuntimePluginUiAction = Readonly<{
  id: string;
  approval: Readonly<{
    message: string;
    title?: string;
  }>;
}>;

export type RuntimePluginUiDocument = Readonly<{
  htmlResourceId: string;
  cssResourceId?: string;
  jsResourceId?: string;
  /** Exact manifest actions that the isolated document may request from its host page. */
  actionIds: readonly string[];
}>;

type RuntimePluginUiContributionBase = Readonly<{
  id: string;
  slot: RuntimePluginUiSlotId;
  /**
   * Optional global extension-state record used to hydrate declared fields.
   * The host projects only valid string values for fields in this contribution.
  */
  stateKey?: string;
  /** Host-owned settings page target for schema v2 settings contributions. */
  target?: RuntimePluginUiSettingsTarget;
  order?: number;
  /** Required for a standalone Plugin page; rendered by the host in the sidebar. */
  navigation?: Readonly<{
    label: string;
    badge?: RuntimePluginUiTextSource;
  }>;
  /** State projection used by bindings and as the default action state scope. */
  data?: Readonly<{
    stateKey: string;
    scope: RuntimePluginUiDataScope;
  }>;
}>;

export type RuntimePluginUiTreeContribution = Readonly<RuntimePluginUiContributionBase & {
  tree: RuntimePluginUiNode;
  document?: never;
}>;

export type RuntimePluginUiDocumentContribution = Readonly<RuntimePluginUiContributionBase & {
  document: RuntimePluginUiDocument;
  tree?: never;
}>;

export type RuntimePluginUiContribution =
  | RuntimePluginUiTreeContribution
  | RuntimePluginUiDocumentContribution;

export type RuntimePluginUiManifest = Readonly<{
  schemaVersion: typeof RUNTIME_PLUGIN_UI_LEGACY_SCHEMA_VERSION | typeof RUNTIME_PLUGIN_UI_SCHEMA_VERSION;
  actions: readonly RuntimePluginUiAction[];
  contributions: readonly RuntimePluginUiContribution[];
}>;

export type RuntimePluginUiActionInput = Readonly<{
  pluginId: string;
  actionId: string;
  values: Readonly<Record<string, string>>;
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

export type RuntimePluginUiDataResult = Readonly<{ data: RuntimePluginUiData }>;

export type RuntimePluginUiDocumentReadInput = Readonly<{
  pluginId: string;
  contributionId: string;
}>;

/**
 * Source bytes read from the same bundle snapshot whose hash was checked
 * against the user's trusted Plugin revision.
 */
export type RuntimePluginUiDocumentReadResult = Readonly<{
  revision: string;
  html: string;
  css: string;
  js: string;
}>;

type ParseBudget = {
  fields: number;
  nodes: number;
  textCharacters: number;
};

const IDENTITY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const STATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const BINDING_PATH_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/u;

/**
 * Parses untrusted manifest data into a bounded, JSON-only projection. Unknown
 * properties are rejected so markup, styles, handlers, and URLs cannot hide in
 * otherwise valid nodes.
 */
export function parseRuntimePluginUiManifest(value: unknown): RuntimePluginUiManifest {
  const record = exactRecord(value, ['schemaVersion', 'actions', 'contributions'], 'Plugin rendererUi');
  if (
    record.schemaVersion !== RUNTIME_PLUGIN_UI_LEGACY_SCHEMA_VERSION
    && record.schemaVersion !== RUNTIME_PLUGIN_UI_SCHEMA_VERSION
  ) {
    throw new Error(
      `Plugin rendererUi schemaVersion must be ${RUNTIME_PLUGIN_UI_LEGACY_SCHEMA_VERSION} or ${RUNTIME_PLUGIN_UI_SCHEMA_VERSION}.`,
    );
  }
  const schemaVersion = record.schemaVersion;
  const rawActions = boundedArray(record.actions, 'Plugin rendererUi actions', RUNTIME_PLUGIN_UI_LIMITS.actions);
  const rawContributions = boundedArray(
    record.contributions,
    'Plugin rendererUi contributions',
    RUNTIME_PLUGIN_UI_LIMITS.contributions,
  );
  const budget: ParseBudget = { fields: 0, nodes: 0, textCharacters: 0 };
  const actionIds = new Set<string>();
  const actions = rawActions.map((item, index) => {
    const action = exactRecord(item, ['id', 'approval'], `Plugin rendererUi actions[${index}]`);
    const id = identity(action.id, `Plugin rendererUi actions[${index}].id`);
    if (actionIds.has(id)) throw new Error(`Duplicate Plugin rendererUi action: ${id}.`);
    actionIds.add(id);
    const approval = exactRecord(
      action.approval,
      ['message', 'title'],
      `Plugin rendererUi action ${id} approval`,
    );
    return Object.freeze({
      id,
      approval: Object.freeze({
        message: budgetText(approval.message, `Plugin rendererUi action ${id} approval message`, budget),
        ...(approval.title === undefined ? {} : {
          title: budgetText(approval.title, `Plugin rendererUi action ${id} approval title`, budget),
        }),
      }),
    });
  });
  const contributionIds = new Set<string>();
  let pluginDetailsContributionSeen = false;
  const contributions = rawContributions.map((item, index) => {
    const contribution = exactRecord(
      item,
      schemaVersion === RUNTIME_PLUGIN_UI_SCHEMA_VERSION
        ? ['id', 'slot', 'target', 'order', 'navigation', 'data', 'tree', 'document']
        : ['id', 'slot', 'target', 'stateKey', 'order', 'tree'],
      `Plugin rendererUi contributions[${index}]`,
    );
    const id = identity(contribution.id, `Plugin rendererUi contributions[${index}].id`);
    if (contributionIds.has(id)) throw new Error(`Duplicate Plugin rendererUi contribution: ${id}.`);
    contributionIds.add(id);
    const legacySettingsSlot = schemaVersion === RUNTIME_PLUGIN_UI_LEGACY_SCHEMA_VERSION
      && contribution.slot === 'renderer.settings.page.extensions';
    const slot = pluginUiSlot(contribution.slot, schemaVersion);
    const target = contribution.target === undefined
      ? undefined
      : identity(contribution.target, `Plugin rendererUi contribution ${id} target`);
    const settingsTarget = target === 'general' || target === 'about' ? target : undefined;
    if (legacySettingsSlot || slot === 'renderer.settings.page.extensions') {
      if (!settingsTarget) {
        throw new Error(`Plugin rendererUi contribution ${id} requires a known settings target.`);
      }
    } else if (target) {
      throw new Error(`Plugin rendererUi contribution ${id} cannot declare a settings target.`);
    }
    if (slot === 'renderer.capabilities.plugin.details') {
      if (pluginDetailsContributionSeen) {
        throw new Error('Plugin rendererUi allows only one Plugin details contribution.');
      }
      pluginDetailsContributionSeen = true;
    }
    const stateKey = contribution.stateKey === undefined
      ? undefined
      : extensionStateKey(contribution.stateKey, `Plugin rendererUi contribution ${id} stateKey`);
    if (stateKey && slot !== 'renderer.capabilities.plugin.details') {
      throw new Error(`Plugin rendererUi contribution ${id} cannot bind state outside Plugin details.`);
    }
    const navigation = contribution.navigation === undefined
      ? undefined
      : parseNavigation(contribution.navigation, id, budget, schemaVersion);
    if (slot === 'renderer.plugin.page' && !navigation) {
      throw new Error(`Plugin rendererUi contribution ${id} requires navigation metadata.`);
    }
    if (slot !== 'renderer.plugin.page' && navigation) {
      throw new Error(`Plugin rendererUi contribution ${id} cannot declare page navigation.`);
    }
    const data = contribution.data === undefined
      ? undefined
      : parseDataDeclaration(contribution.data, id);
    if (
      (slot === 'renderer.settings.page.extensions' || slot === 'renderer.capabilities.plugin.details')
      && data
      && data.scope !== 'global'
    ) {
      const surface = slot === 'renderer.settings.page.extensions' ? 'settings' : 'Plugin details';
      throw new Error(`Plugin rendererUi contribution ${id} ${surface} data must use global scope.`);
    }
    if (slot === 'renderer.chat.composer.status' && data?.scope === 'project') {
      throw new Error(`Plugin rendererUi contribution ${id} chat data cannot use project scope.`);
    }
    const hasTree = contribution.tree !== undefined;
    const hasDocument = contribution.document !== undefined;
    if (hasTree === hasDocument) {
      throw new Error(`Plugin rendererUi contribution ${id} must declare exactly one of tree or document.`);
    }
    if (hasDocument && slot !== 'renderer.plugin.page') {
      throw new Error(`Plugin rendererUi contribution ${id} documents require the standalone Plugin page Slot.`);
    }
    const fieldNames = new Set<string>();
    const tree = hasTree
      ? parseNode(contribution.tree, 1, budget, actionIds, fieldNames, schemaVersion)
      : undefined;
    const document = hasDocument
      ? parseDocument(contribution.document, id, actionIds)
      : undefined;
    if (!data && ((tree && treeUsesBinding(tree)) || (navigation?.badge && isBinding(navigation.badge)))) {
      throw new Error(`Plugin rendererUi contribution ${id} uses bindings without a data declaration.`);
    }
    if (stateKey && !fieldNames.size) {
      throw new Error(`Plugin rendererUi contribution ${id} stateKey requires at least one field.`);
    }
    return Object.freeze({
      id,
      slot,
      ...(stateKey ? { stateKey } : {}),
      ...(!legacySettingsSlot && settingsTarget ? { target: settingsTarget } : {}),
      ...(contribution.order === undefined ? {} : {
        order: finiteOrder(contribution.order, `Plugin rendererUi contribution ${id} order`),
      }),
      ...(navigation ? { navigation } : {}),
      ...(data ? { data } : {}),
      ...(tree ? { tree } : {}),
      ...(document ? { document } : {}),
    }) as RuntimePluginUiContribution;
  });
  return Object.freeze({
    schemaVersion,
    actions: Object.freeze(actions),
    contributions: Object.freeze(contributions),
  });
}

/**
 * Normalizes the only runtime-controlled value that may reach declarative UI.
 * The root is always an object and the total JSON payload is kept within the
 * same per-value budget as extension state storage.
 */
export function parseRuntimePluginUiData(value: unknown): RuntimePluginUiData {
  const budget = { entries: 0 };
  const normalized = normalizePluginUiDataValue(value, 1, budget, 'Plugin renderer UI data');
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error('Plugin renderer UI data must be an object.');
  }
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > RUNTIME_PLUGIN_UI_LIMITS.dataBytes) {
    throw new Error('Plugin renderer UI data is too large.');
  }
  return normalized as RuntimePluginUiData;
}

function normalizePluginUiDataValue(
  value: unknown,
  depth: number,
  budget: { entries: number },
  label: string,
): RuntimePluginUiDataValue {
  if (depth > RUNTIME_PLUGIN_UI_LIMITS.dataDepth) throw new Error('Plugin renderer UI data is too deep.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    // Bound UTF-16 length before UTF-8 encoding so one hostile postMessage
    // string cannot force an unbounded temporary allocation in the host.
    if (value.length > RUNTIME_PLUGIN_UI_LIMITS.dataBytes) {
      throw new Error('Plugin renderer UI data is too large.');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) {
    budget.entries += value.length;
    if (budget.entries > RUNTIME_PLUGIN_UI_LIMITS.dataEntries) {
      throw new Error('Plugin renderer UI data contains too many entries.');
    }
    return Object.freeze(value.map((item, index) => normalizePluginUiDataValue(
      item,
      depth + 1,
      budget,
      `${label}[${index}]`,
    )));
  }
  if (!value || typeof value !== 'object') throw new Error(`${label} contains a non-JSON value.`);
  const entries = Object.entries(value as Record<string, unknown>);
  budget.entries += entries.length;
  if (budget.entries > RUNTIME_PLUGIN_UI_LIMITS.dataEntries) {
    throw new Error('Plugin renderer UI data contains too many entries.');
  }
  return Object.freeze(Object.fromEntries(entries.map(([key, item]) => {
    if (!key || key.length > 256) throw new Error(`${label} contains an invalid key.`);
    return [key, normalizePluginUiDataValue(item, depth + 1, budget, `${label}.${key}`)];
  })));
}

function parseNode(
  value: unknown,
  depth: number,
  budget: ParseBudget,
  actionIds: ReadonlySet<string>,
  fieldNames: Set<string>,
  schemaVersion: RuntimePluginUiManifest['schemaVersion'],
): RuntimePluginUiNode {
  if (depth > RUNTIME_PLUGIN_UI_LIMITS.depth) throw new Error('Plugin rendererUi tree is too deep.');
  budget.nodes += 1;
  if (budget.nodes > RUNTIME_PLUGIN_UI_LIMITS.nodes) throw new Error('Plugin rendererUi contains too many nodes.');
  const input = objectRecord(value, 'Plugin rendererUi node must be an object.');
  if (input.type === 'stack') {
    const node = exactRecord(input, ['type', 'direction', 'gap', 'children'], 'Plugin rendererUi stack');
    const direction = optionalEnum(node.direction, ['column', 'row'] as const, 'Plugin rendererUi stack direction');
    const gap = optionalEnum(node.gap, ['compact', 'normal'] as const, 'Plugin rendererUi stack gap');
    const children = boundedArray(node.children, 'Plugin rendererUi stack children', RUNTIME_PLUGIN_UI_LIMITS.nodes);
    return Object.freeze({
      type: 'stack',
      ...(direction ? { direction } : {}),
      ...(gap ? { gap } : {}),
      children: Object.freeze(children.map((child) => parseNode(
        child,
        depth + 1,
        budget,
        actionIds,
        fieldNames,
        schemaVersion,
      ))),
    });
  }
  if (input.type === 'text' || input.type === 'badge') {
    const node = exactRecord(input, ['type', 'text', 'tone'], `Plugin rendererUi ${input.type}`);
    const tone = optionalEnum(
      node.tone,
      ['default', 'muted', 'success', 'warning', 'danger'] as const,
      `Plugin rendererUi ${input.type} tone`,
    );
    return Object.freeze({
      type: input.type,
      text: textSource(node.text, `Plugin rendererUi ${input.type} text`, budget, schemaVersion),
      ...(tone ? { tone } : {}),
    });
  }
  if (input.type === 'notice') {
    const node = exactRecord(input, ['type', 'text', 'title', 'tone'], 'Plugin rendererUi notice');
    const tone = optionalEnum(
      node.tone,
      ['default', 'success', 'warning', 'danger'] as const,
      'Plugin rendererUi notice tone',
    );
    return Object.freeze({
      type: 'notice',
      text: textSource(node.text, 'Plugin rendererUi notice text', budget, schemaVersion),
      ...(node.title === undefined ? {} : {
        title: textSource(node.title, 'Plugin rendererUi notice title', budget, schemaVersion),
      }),
      ...(tone ? { tone } : {}),
    });
  }
  if (input.type === 'button') {
    const node = exactRecord(input, ['type', 'actionId', 'label', 'variant'], 'Plugin rendererUi button');
    const actionId = identity(node.actionId, 'Plugin rendererUi button actionId');
    if (!actionIds.has(actionId)) throw new Error(`Plugin rendererUi button references unknown action: ${actionId}.`);
    const variant = optionalEnum(
      node.variant,
      ['primary', 'secondary', 'danger'] as const,
      'Plugin rendererUi button variant',
    );
    return Object.freeze({
      type: 'button',
      actionId,
      label: budgetText(node.label, 'Plugin rendererUi button label', budget),
      ...(variant ? { variant } : {}),
    });
  }
  if (input.type === 'field') {
    const node = exactRecord(
      input,
      ['type', 'name', 'label', 'defaultValue', 'placeholder', 'required', 'maxLength'],
      'Plugin rendererUi field',
    );
    const name = fieldName(node.name, 'Plugin rendererUi field name');
    registerField(name, fieldNames, budget);
    const maxLength = node.maxLength === undefined
      ? RUNTIME_PLUGIN_UI_LIMITS.valueCharacters
      : boundedInteger(node.maxLength, 1, RUNTIME_PLUGIN_UI_LIMITS.valueCharacters, 'Plugin rendererUi field maxLength');
    const defaultValue = optionalTextSource(
      node.defaultValue,
      'Plugin rendererUi field defaultValue',
      budget,
      schemaVersion,
      maxLength,
    );
    return Object.freeze({
      type: 'field',
      name,
      label: budgetText(node.label, 'Plugin rendererUi field label', budget),
      ...(defaultValue === undefined ? {} : { defaultValue }),
      ...(node.placeholder === undefined ? {} : {
        placeholder: budgetText(node.placeholder, 'Plugin rendererUi field placeholder', budget),
      }),
      ...(node.required === undefined ? {} : { required: booleanValue(node.required, 'Plugin rendererUi field required') }),
      maxLength,
    });
  }
  if (input.type === 'select') {
    const node = exactRecord(
      input,
      ['type', 'name', 'label', 'defaultValue', 'options'],
      'Plugin rendererUi select',
    );
    const name = fieldName(node.name, 'Plugin rendererUi select name');
    registerField(name, fieldNames, budget);
    const optionValues = new Set<string>();
    const options = boundedArray(
      node.options,
      'Plugin rendererUi select options',
      RUNTIME_PLUGIN_UI_LIMITS.optionsPerSelect,
      1,
    ).map((option, index) => {
      const item = exactRecord(option, ['label', 'value'], `Plugin rendererUi select options[${index}]`);
      const optionValue = boundedValue(item.value, `Plugin rendererUi select options[${index}].value`);
      if (optionValues.has(optionValue)) throw new Error(`Duplicate Plugin rendererUi select option: ${optionValue}.`);
      optionValues.add(optionValue);
      return Object.freeze({
        label: budgetText(item.label, `Plugin rendererUi select options[${index}].label`, budget),
        value: optionValue,
      });
    });
    const defaultValue = optionalTextSource(
      node.defaultValue,
      'Plugin rendererUi select defaultValue',
      budget,
      schemaVersion,
      RUNTIME_PLUGIN_UI_LIMITS.valueCharacters,
    );
    if (typeof defaultValue === 'string' && !optionValues.has(defaultValue)) {
      throw new Error('Plugin rendererUi select defaultValue must match an option.');
    }
    return Object.freeze({
      type: 'select',
      name,
      label: budgetText(node.label, 'Plugin rendererUi select label', budget),
      ...(defaultValue === undefined ? {} : { defaultValue }),
      options: Object.freeze(options),
    });
  }
  throw new Error(`Unsupported Plugin rendererUi node type: ${String(input.type)}.`);
}

function registerField(name: string, names: Set<string>, budget: ParseBudget): void {
  if (names.has(name)) throw new Error(`Duplicate Plugin rendererUi field: ${name}.`);
  names.add(name);
  budget.fields += 1;
  if (budget.fields > RUNTIME_PLUGIN_UI_LIMITS.fields) throw new Error('Plugin rendererUi contains too many fields.');
}

function pluginUiSlot(
  value: unknown,
  schemaVersion: RuntimePluginUiManifest['schemaVersion'],
): RuntimePluginUiSlotId {
  if (
    value === 'renderer.chat.composer.status'
    || value === 'renderer.capabilities.plugin.details'
    || value === 'renderer.plugin.page'
  ) return value;
  // Schema v1 originally allowed Plugin settings in host Settings sections.
  // Read those manifests for upgrade compatibility, but never preserve their
  // target: the canonical projection always belongs to the Plugin detail page.
  if (value === 'renderer.settings.page.extensions') {
    return schemaVersion === RUNTIME_PLUGIN_UI_LEGACY_SCHEMA_VERSION
      ? 'renderer.capabilities.plugin.details'
      : value;
  }
  throw new Error(`Plugin rendererUi Slot is not allowed: ${String(value)}.`);
}

function parseNavigation(
  value: unknown,
  contributionId: string,
  budget: ParseBudget,
  schemaVersion: RuntimePluginUiManifest['schemaVersion'],
): NonNullable<RuntimePluginUiContribution['navigation']> {
  const record = exactRecord(value, ['label', 'badge'], `Plugin rendererUi contribution ${contributionId} navigation`);
  return Object.freeze({
    label: budgetText(record.label, `Plugin rendererUi contribution ${contributionId} navigation label`, budget),
    ...(record.badge === undefined ? {} : {
      badge: textSource(
        record.badge,
        `Plugin rendererUi contribution ${contributionId} navigation badge`,
        budget,
        schemaVersion,
      ),
    }),
  });
}

function parseDataDeclaration(
  value: unknown,
  contributionId: string,
): NonNullable<RuntimePluginUiContribution['data']> {
  const record = exactRecord(value, ['stateKey', 'scope'], `Plugin rendererUi contribution ${contributionId} data`);
  const stateKey = nonEmptyText(record.stateKey, `Plugin rendererUi contribution ${contributionId} data stateKey`);
  if (!STATE_KEY_PATTERN.test(stateKey)) {
    throw new Error(`Plugin rendererUi contribution ${contributionId} data stateKey is invalid.`);
  }
  return Object.freeze({
    stateKey,
    scope: enumValue(
      record.scope,
      ['global', 'project', 'thread'] as const,
      `Plugin rendererUi contribution ${contributionId} data scope`,
    ),
  });
}

function parseDocument(
  value: unknown,
  contributionId: string,
  actionIds: ReadonlySet<string>,
): RuntimePluginUiDocument {
  const record = exactRecord(
    value,
    ['htmlResourceId', 'cssResourceId', 'jsResourceId', 'actionIds'],
    `Plugin rendererUi contribution ${contributionId} document`,
  );
  const htmlResourceId = resourceIdentity(
    record.htmlResourceId,
    `Plugin rendererUi contribution ${contributionId} document htmlResourceId`,
  );
  const cssResourceId = record.cssResourceId === undefined
    ? undefined
    : resourceIdentity(
      record.cssResourceId,
      `Plugin rendererUi contribution ${contributionId} document cssResourceId`,
    );
  const jsResourceId = record.jsResourceId === undefined
    ? undefined
    : resourceIdentity(
      record.jsResourceId,
      `Plugin rendererUi contribution ${contributionId} document jsResourceId`,
    );
  if (new Set([htmlResourceId, cssResourceId, jsResourceId].filter(Boolean)).size
    !== [htmlResourceId, cssResourceId, jsResourceId].filter(Boolean).length) {
    throw new Error(`Plugin rendererUi contribution ${contributionId} document resources must be unique.`);
  }
  const declaredActionIds = boundedArray(
    record.actionIds,
    `Plugin rendererUi contribution ${contributionId} document actionIds`,
    RUNTIME_PLUGIN_UI_LIMITS.actions,
  ).map((item, index) => identity(
    item,
    `Plugin rendererUi contribution ${contributionId} document actionIds[${index}]`,
  ));
  const uniqueActionIds = new Set<string>();
  for (const actionId of declaredActionIds) {
    if (!actionIds.has(actionId)) {
      throw new Error(`Plugin rendererUi document references unknown action: ${actionId}.`);
    }
    if (uniqueActionIds.has(actionId)) {
      throw new Error(`Duplicate Plugin rendererUi document action: ${actionId}.`);
    }
    uniqueActionIds.add(actionId);
  }
  return Object.freeze({
    htmlResourceId,
    ...(cssResourceId ? { cssResourceId } : {}),
    ...(jsResourceId ? { jsResourceId } : {}),
    actionIds: Object.freeze(declaredActionIds),
  });
}

function textSource(
  value: unknown,
  label: string,
  budget: ParseBudget,
  schemaVersion: RuntimePluginUiManifest['schemaVersion'],
  maxLength?: number,
): RuntimePluginUiTextSource {
  if (typeof value === 'string') {
    if (maxLength !== undefined) {
      const result = boundedValue(value, label, maxLength);
      budget.textCharacters += result.length;
      if (budget.textCharacters > RUNTIME_PLUGIN_UI_LIMITS.textCharacters) {
        throw new Error('Plugin rendererUi text is too large.');
      }
      return result;
    }
    return budgetText(value, label, budget);
  }
  if (schemaVersion !== RUNTIME_PLUGIN_UI_SCHEMA_VERSION) {
    throw new Error(`${label} must be a string in schemaVersion ${schemaVersion}.`);
  }
  const record = exactRecord(value, ['path', 'fallback'], `${label} binding`);
  const path = nonEmptyText(record.path, `${label} binding path`);
  if (!BINDING_PATH_PATTERN.test(path) || path.length > 256) throw new Error(`${label} binding path is invalid.`);
  const fallback = record.fallback === undefined
    ? undefined
    : boundedValue(record.fallback, `${label} binding fallback`, maxLength);
  if (fallback !== undefined) {
    budget.textCharacters += fallback.length;
    if (budget.textCharacters > RUNTIME_PLUGIN_UI_LIMITS.textCharacters) {
      throw new Error('Plugin rendererUi text is too large.');
    }
  }
  return Object.freeze({ path, ...(fallback === undefined ? {} : { fallback }) });
}

function optionalTextSource(
  value: unknown,
  label: string,
  budget: ParseBudget,
  schemaVersion: RuntimePluginUiManifest['schemaVersion'],
  maxLength?: number,
): RuntimePluginUiTextSource | undefined {
  return value === undefined ? undefined : textSource(value, label, budget, schemaVersion, maxLength);
}

function treeUsesBinding(node: RuntimePluginUiNode): boolean {
  if (node.type === 'stack') return node.children.some(treeUsesBinding);
  if (node.type === 'text' || node.type === 'badge') return isBinding(node.text);
  if (node.type === 'notice') return isBinding(node.text) || Boolean(node.title && isBinding(node.title));
  if (node.type === 'field' || node.type === 'select') return Boolean(node.defaultValue && isBinding(node.defaultValue));
  return false;
}

function isBinding(value: RuntimePluginUiTextSource): value is RuntimePluginUiBinding {
  return typeof value !== 'string';
}

function identity(value: unknown, label: string): string {
  const result = nonEmptyText(value, label);
  if (!IDENTITY_PATTERN.test(result) || result.length > 96) throw new Error(`${label} is invalid.`);
  return result;
}

function resourceIdentity(value: unknown, label: string): string {
  const result = nonEmptyText(value, label);
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/u.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

function fieldName(value: unknown, label: string): string {
  const result = nonEmptyText(value, label);
  if (!FIELD_PATTERN.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

function extensionStateKey(value: unknown, label: string): string {
  const result = nonEmptyText(value, label);
  if (!STATE_KEY_PATTERN.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

function budgetText(value: unknown, label: string, budget: ParseBudget): string {
  const result = nonEmptyText(value, label);
  budget.textCharacters += result.length;
  if (budget.textCharacters > RUNTIME_PLUGIN_UI_LIMITS.textCharacters) {
    throw new Error('Plugin rendererUi text is too large.');
  }
  return result;
}

function boundedValue(
  value: unknown,
  label: string,
  maxLength: number = RUNTIME_PLUGIN_UI_LIMITS.valueCharacters,
): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${label} is invalid.`);
  return value;
}

function finiteOrder(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}

function nonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function optionalEnum<const TValues extends readonly string[]>(
  value: unknown,
  values: TValues,
  label: string,
): TValues[number] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(`${label} is invalid.`);
  return value as TValues[number];
}

function enumValue<const TValues extends readonly string[]>(
  value: unknown,
  values: TValues,
  label: string,
): TValues[number] {
  const result = optionalEnum(value, values, label);
  if (result === undefined) throw new Error(`${label} is required.`);
  return result;
}

function boundedArray(value: unknown, label: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain between ${min} and ${max} items.`);
  }
  return value;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = objectRecord(value, `${label} must be an object.`);
  const allowed = new Set(keys);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} contains unsupported property: ${unknown}.`);
  return record;
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
