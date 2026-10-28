import type {
  RuntimePluginUiContribution,
  RuntimePluginUiNode,
} from '@setsuna-desktop/contracts';

type RendererUiField = Extract<RuntimePluginUiNode, { type: 'field' | 'select' }>;

/** Returns only bounded string values declared by this contribution. */
export function projectRendererUiState(
  value: unknown,
  contribution: RuntimePluginUiContribution,
): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
  const record = value as Record<string, unknown>;
  const projected: Record<string, string> = {};
  for (const [name, field] of rendererUiFields(contribution)) {
    if (field.type === 'field' && field.secret) continue;
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
  if (contribution.tree) visit(contribution.tree);
  return fields;
}
