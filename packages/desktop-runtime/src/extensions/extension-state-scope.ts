export function stateScope(
  value: unknown,
  context: Readonly<{ projectId?: string; threadId: string }>,
): string {
  const scope = value === undefined ? 'thread' : requiredText(value);
  if (scope === 'global') return 'global';
  if (scope === 'project') {
    if (!context.projectId) throw new Error('Project-scoped extension state requires an active project.');
    return `project:${context.projectId}`;
  }
  if (scope === 'thread') return `thread:${context.threadId}`;
  throw new Error(`Unsupported extension state scope: ${scope}`);
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Extension state scope is required.');
  return value.trim();
}
