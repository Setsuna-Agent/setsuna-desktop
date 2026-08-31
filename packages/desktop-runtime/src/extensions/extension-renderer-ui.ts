import type {
  RuntimePluginUiContribution,
  RuntimePluginUiNode,
} from '@setsuna-desktop/contracts';

type RendererUiField = Extract<RuntimePluginUiNode, { type: 'field' | 'select' }>;

export function treeUsesRendererUiAction(node: RuntimePluginUiNode, actionId: string): boolean {
  if (node.type === 'button') return node.actionId === actionId;
  return node.type === 'stack' && node.children.some((child) => treeUsesRendererUiAction(child, actionId));
}

export function validateRendererUiActionValues(
  values: Readonly<Record<string, string>>,
  contribution: RuntimePluginUiContribution,
): void {
  const fields = rendererUiFields(contribution);
  for (const [name, value] of Object.entries(values)) {
    const field = fields.get(name);
    if (!field) throw new Error(`Renderer UI action contains an undeclared field: ${name}`);
    if (field.type === 'field' && value.length > (field.maxLength ?? 4_000)) {
      throw new Error(`Renderer UI action field is too large: ${name}`);
    }
    if (field.type === 'select' && !field.options.some((option) => option.value === value)) {
      throw new Error(`Renderer UI action select value is invalid: ${name}`);
    }
  }
  for (const field of fields.values()) {
    if (field.type === 'field' && field.required && !values[field.name]?.trim()) {
      throw new Error(`Renderer UI action field is required: ${field.name}`);
    }
  }
}

/** Returns only bounded string values declared by this contribution. */
export function projectRendererUiState(
  value: unknown,
  contribution: RuntimePluginUiContribution,
): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
  const record = value as Record<string, unknown>;
  const projected: Record<string, string> = {};
  for (const [name, field] of rendererUiFields(contribution)) {
    const candidate = record[name];
    if (typeof candidate !== 'string') continue;
    if (field.type === 'field' && candidate.length > (field.maxLength ?? 4_000)) continue;
    if (field.type === 'select' && !field.options.some((option) => option.value === candidate)) continue;
    projected[name] = candidate;
  }
  return Object.freeze(projected);
}

function rendererUiFields(contribution: RuntimePluginUiContribution): Map<string, RendererUiField> {
  const fields = new Map<string, RendererUiField>();
  const visit = (node: RuntimePluginUiNode): void => {
    if (node.type === 'field' || node.type === 'select') fields.set(node.name, node);
    if (node.type === 'stack') node.children.forEach(visit);
  };
  visit(contribution.tree);
  return fields;
}
