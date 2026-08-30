export const RUNTIME_PLUGIN_UI_SCHEMA_VERSION = 1 as const;

export const RUNTIME_PLUGIN_UI_LIMITS = Object.freeze({
  actions: 32,
  contributions: 16,
  depth: 8,
  fields: 24,
  nodes: 128,
  optionsPerSelect: 20,
  textCharacters: 16_384,
  valueCharacters: 4_000,
});

export type RuntimePluginUiSlotId =
  | 'renderer.chat.composer.status'
  | 'renderer.settings.page.extensions';

export type RuntimePluginUiTone = 'default' | 'muted' | 'success' | 'warning' | 'danger';

export type RuntimePluginUiStackNode = Readonly<{
  type: 'stack';
  direction?: 'column' | 'row';
  gap?: 'compact' | 'normal';
  children: readonly RuntimePluginUiNode[];
}>;

export type RuntimePluginUiTextNode = Readonly<{
  type: 'text';
  text: string;
  tone?: RuntimePluginUiTone;
}>;

export type RuntimePluginUiBadgeNode = Readonly<{
  type: 'badge';
  text: string;
  tone?: RuntimePluginUiTone;
}>;

export type RuntimePluginUiNoticeNode = Readonly<{
  type: 'notice';
  text: string;
  title?: string;
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
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
}>;

export type RuntimePluginUiSelectNode = Readonly<{
  type: 'select';
  name: string;
  label: string;
  defaultValue?: string;
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

export type RuntimePluginUiContribution = Readonly<{
  id: string;
  slot: RuntimePluginUiSlotId;
  /** Required and allowlisted by the host for settings extensions. */
  target?: string;
  order?: number;
  tree: RuntimePluginUiNode;
}>;

export type RuntimePluginUiManifest = Readonly<{
  schemaVersion: typeof RUNTIME_PLUGIN_UI_SCHEMA_VERSION;
  actions: readonly RuntimePluginUiAction[];
  contributions: readonly RuntimePluginUiContribution[];
}>;

export type RuntimePluginUiActionInput = Readonly<{
  pluginId: string;
  actionId: string;
  values: Readonly<Record<string, string>>;
  context: Readonly<{
    contributionId: string;
    surface: RuntimePluginUiSlotId;
    threadId?: string;
  }>;
}>;

export type RuntimePluginUiActionResult = Readonly<{ status: 'completed' }>;

type ParseBudget = {
  fields: number;
  nodes: number;
  textCharacters: number;
};

const IDENTITY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;

/**
 * Parses untrusted manifest data into a bounded, JSON-only projection. Unknown
 * properties are rejected so markup, styles, handlers, and URLs cannot hide in
 * otherwise valid nodes.
 */
export function parseRuntimePluginUiManifest(value: unknown): RuntimePluginUiManifest {
  const record = exactRecord(value, ['schemaVersion', 'actions', 'contributions'], 'Plugin rendererUi');
  if (record.schemaVersion !== RUNTIME_PLUGIN_UI_SCHEMA_VERSION) {
    throw new Error(`Plugin rendererUi schemaVersion must be ${RUNTIME_PLUGIN_UI_SCHEMA_VERSION}.`);
  }
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
  const contributions = rawContributions.map((item, index) => {
    const contribution = exactRecord(
      item,
      ['id', 'slot', 'target', 'order', 'tree'],
      `Plugin rendererUi contributions[${index}]`,
    );
    const id = identity(contribution.id, `Plugin rendererUi contributions[${index}].id`);
    if (contributionIds.has(id)) throw new Error(`Duplicate Plugin rendererUi contribution: ${id}.`);
    contributionIds.add(id);
    const slot = pluginUiSlot(contribution.slot);
    const target = contribution.target === undefined
      ? undefined
      : identity(contribution.target, `Plugin rendererUi contribution ${id} target`);
    if (slot === 'renderer.settings.page.extensions' && !target) {
      throw new Error(`Plugin rendererUi contribution ${id} requires a settings target.`);
    }
    if (slot !== 'renderer.settings.page.extensions' && target) {
      throw new Error(`Plugin rendererUi contribution ${id} cannot target a keyed settings page.`);
    }
    return Object.freeze({
      id,
      slot,
      ...(target ? { target } : {}),
      ...(contribution.order === undefined ? {} : {
        order: finiteOrder(contribution.order, `Plugin rendererUi contribution ${id} order`),
      }),
      tree: parseNode(contribution.tree, 1, budget, actionIds, new Set<string>()),
    });
  });
  return Object.freeze({
    schemaVersion: RUNTIME_PLUGIN_UI_SCHEMA_VERSION,
    actions: Object.freeze(actions),
    contributions: Object.freeze(contributions),
  });
}

function parseNode(
  value: unknown,
  depth: number,
  budget: ParseBudget,
  actionIds: ReadonlySet<string>,
  fieldNames: Set<string>,
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
      text: budgetText(node.text, `Plugin rendererUi ${input.type} text`, budget),
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
      text: budgetText(node.text, 'Plugin rendererUi notice text', budget),
      ...(node.title === undefined ? {} : { title: budgetText(node.title, 'Plugin rendererUi notice title', budget) }),
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
    const defaultValue = optionalValue(node.defaultValue, 'Plugin rendererUi field defaultValue', maxLength);
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
    const defaultValue = optionalValue(node.defaultValue, 'Plugin rendererUi select defaultValue');
    if (defaultValue !== undefined && !optionValues.has(defaultValue)) {
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

function pluginUiSlot(value: unknown): RuntimePluginUiSlotId {
  if (value === 'renderer.chat.composer.status' || value === 'renderer.settings.page.extensions') return value;
  throw new Error(`Plugin rendererUi Slot is not allowed: ${String(value)}.`);
}

function identity(value: unknown, label: string): string {
  const result = nonEmptyText(value, label);
  if (!IDENTITY_PATTERN.test(result) || result.length > 96) throw new Error(`${label} is invalid.`);
  return result;
}

function fieldName(value: unknown, label: string): string {
  const result = nonEmptyText(value, label);
  if (!FIELD_PATTERN.test(result)) throw new Error(`${label} is invalid.`);
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

function optionalValue(value: unknown, label: string, maxLength?: number): string | undefined {
  return value === undefined ? undefined : boundedValue(value, label, maxLength);
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
