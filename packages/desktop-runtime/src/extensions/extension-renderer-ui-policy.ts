import type {
  RuntimePluginUiContribution,
  RuntimePluginUiDataScope,
  RuntimePluginUiNode,
} from '@setsuna-desktop/contracts';

export function treeUsesAction(node: RuntimePluginUiNode, actionId: string): boolean {
  if (node.type === 'button') return node.actionId === actionId;
  return node.type === 'stack' && node.children.some((child) => treeUsesAction(child, actionId));
}

export function contributionUsesAction(
  contribution: RuntimePluginUiContribution,
  actionId: string,
): boolean {
  return contribution.document
    ? contribution.document.actionIds.includes(actionId)
    : treeUsesAction(contribution.tree, actionId);
}

export function validateRendererUiActionValues(
  values: Readonly<Record<string, string>>,
  contributions: readonly RuntimePluginUiContribution[],
): void {
  const fields = new Map<string, Extract<RuntimePluginUiNode, { type: 'field' | 'select' }>>();
  const visit = (node: RuntimePluginUiNode): void => {
    if (node.type === 'field' || node.type === 'select') fields.set(node.name, node);
    if (node.type === 'stack') node.children.forEach(visit);
  };
  contributions.forEach((contribution) => {
    if (contribution.tree) visit(contribution.tree);
  });
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

export function assertRendererUiScopeContext(
  scope: RuntimePluginUiDataScope,
  context: Readonly<{ projectId?: string; threadId?: string }>,
): void {
  if (scope === 'project' && !context.projectId) {
    throw new Error('Project-scoped Renderer UI requires an active project.');
  }
  if (scope === 'thread' && !context.threadId) {
    throw new Error('Thread-scoped Renderer UI requires an active thread.');
  }
}
