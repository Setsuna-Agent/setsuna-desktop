import { validPluginUiScalarValue } from '@setsuna-desktop/contracts';
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
  const app = contribution.document ?? contribution.reactApp;
  return app
    ? app.actionIds.includes(actionId)
    : Boolean(contribution.tree && treeUsesAction(contribution.tree, actionId));
}

export function validateRendererUiActionValues(
  values: Readonly<Record<string, string>>,
  contributions: readonly RuntimePluginUiContribution[],
): void {
  const fields = new Map<string, Extract<RuntimePluginUiNode, { type: 'field' | 'select' | 'number' | 'boolean' }>>();
  const visit = (node: RuntimePluginUiNode): void => {
    if (node.type === 'field' || node.type === 'select' || node.type === 'number' || node.type === 'boolean') fields.set(node.name, node);
    if (node.type === 'stack') node.children.forEach(visit);
  };
  contributions.forEach((contribution) => {
    if (contribution.tree) visit(contribution.tree);
  });
  for (const [name, value] of Object.entries(values)) {
    const field = fields.get(name);
    if (field && (field.type === 'number' || field.type === 'boolean') && !validPluginUiScalarValue(field, value)) throw new Error(`Invalid scalar field: ${name}`);
    if (!field) throw new Error(`Renderer UI action contains an undeclared field: ${name}`);
    if (field.type === 'field' && field.secret) throw new Error('Secret fields must use host-only secretChanges.');
    if (field.type === 'field' && value.length > (field.maxLength ?? 4_000)) {
      throw new Error(`Renderer UI action field is too large: ${name}`);
    }
    if (field.type === 'select' && !field.options.some((option) => option.value === value)) {
      throw new Error(`Renderer UI action select value is invalid: ${name}`);
    }
  }
  for (const field of fields.values()) {
    if ((field.type === 'number' || field.type === 'boolean') && !validPluginUiScalarValue(field, values[field.name] ?? '')) throw new Error(`Invalid scalar field: ${field.name}`);
    if (field.type === 'field' && !field.secret && field.required && !values[field.name]?.trim()) {
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
