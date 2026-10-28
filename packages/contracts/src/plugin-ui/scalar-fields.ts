import type { RuntimePluginUiNumberNode, RuntimePluginUiBooleanNode } from './model.js';
export type RuntimePluginUiScalarNode = RuntimePluginUiNumberNode | RuntimePluginUiBooleanNode;

/** Keep the v1 action wire format (strings), with identical validation at both trust boundaries. */
export function validPluginUiScalarValue(node: RuntimePluginUiScalarNode, value: string): boolean {
  if (node.type === 'boolean') return value === 'true' || value === 'false';
  if (!value.trim()) return !node.required;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(value)) return false;
  const number = Number(value);
  if (!Number.isFinite(number) || (node.min !== undefined && number < node.min) || (node.max !== undefined && number > node.max)) return false;
  if (node.step !== undefined) {
    const steps = (number - (node.min ?? 0)) / node.step;
    if (!Number.isFinite(steps) || Math.abs(steps - Math.round(steps)) > 1e-7) return false;
  }
  return true;
}

export function parsePluginUiScalarNode(input: Record<string, unknown>, name: string, label: string): RuntimePluginUiScalarNode {
  if (input.type === 'boolean') {
    if (input.defaultValue !== undefined && typeof input.defaultValue !== 'boolean') throw new Error('Boolean defaultValue must be a boolean.');
    return Object.freeze({ type: 'boolean', name, label, ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }) });
  }
  const limits: { defaultValue?: number; min?: number; max?: number; step?: number; required?: boolean } = {};
  for (const key of ['defaultValue', 'min', 'max', 'step'] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Number ${key} must be finite.`);
    limits[key] = value;
  }
  if (input.required !== undefined) {
    if (typeof input.required !== 'boolean') throw new Error('Number required must be a boolean.');
    limits.required = input.required;
  }
  if ((limits.step !== undefined && limits.step <= 0) || (limits.min !== undefined && limits.max !== undefined && limits.min > limits.max)) throw new Error('Invalid number bounds.');
  const node = Object.freeze({ type: 'number' as const, name, label, ...limits });
  if (node.defaultValue !== undefined && !validPluginUiScalarValue(node, String(node.defaultValue))) throw new Error('Number defaultValue does not match its bounds or step.');
  return node;
}
