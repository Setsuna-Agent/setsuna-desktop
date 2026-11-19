import { parseDesignColor } from './design-color.js';

const parameterTypes = ['string', 'number', 'color', 'boolean'] as const;
const maxParameters = 64;
export const maxDesignScriptParameterLength = 8_000;

type ParameterType = (typeof parameterTypes)[number];
export type DesignScriptValue = string | number | boolean;
export type DesignScriptInputs = Readonly<Record<string, DesignScriptValue>>;
export type DesignScriptParameter = Readonly<{ name: string; type: ParameterType; defaultValue: DesignScriptValue }>;
export type DesignScriptCanvas = Readonly<{ width: number; height: number; input: DesignScriptInputs }>;

export function parseDesignScriptInputs(input: unknown): DesignScriptInputs {
  const entries = Object.entries(parameterRecord(input));
  if (entries.length > maxParameters) throw new Error('Too many script parameters.');
  return Object.fromEntries(entries.map(([name, value]) => [parameterName(name), parameterValue(value)]));
}

export function parseDesignScriptParameters(input: unknown): readonly DesignScriptParameter[] {
  if (!Array.isArray(input) || input.length > maxParameters) throw new Error('Invalid script parameter list.');
  const names = new Set<string>();
  return input.map((entry) => {
    const value = parameterRecord(entry);
    const name = parameterName(value.name);
    const type = parameterTypes.find((type) => type === value.type);
    if (!type || names.has(name)) throw new Error(`Invalid script parameter ${name}.`);
    names.add(name);
    return { name, type, defaultValue: typedParameterValue(type, value.defaultValue) };
  });
}

export function designScriptParameterValue(parameter: DesignScriptParameter, inputs: DesignScriptInputs | undefined): DesignScriptValue {
  if (inputs && Object.hasOwn(inputs, parameter.name)) {
    try { return typedParameterValue(parameter.type, inputs[parameter.name]); }
    catch { /* An edited script may declare a different type at the same path. */ }
  }
  return parameter.defaultValue;
}

function parameterRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid script parameters.');
  return input as Record<string, unknown>;
}

function parameterName(input: unknown): string {
  if (typeof input !== 'string' || !/^[\p{ID_Start}_$][\p{ID_Continue}$]{0,127}$/u.test(input) || input === '__proto__') {
    throw new Error('Invalid script parameter name.');
  }
  return input;
}

function parameterValue(input: unknown): DesignScriptValue {
  if (typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))
    || (typeof input === 'string' && input.length <= maxDesignScriptParameterLength)) return input;
  throw new Error('Invalid script parameter value.');
}

function typedParameterValue(type: ParameterType, input: unknown): DesignScriptValue {
  if (type === 'color') return parseDesignColor(input);
  const value = parameterValue(input);
  if (typeof value !== type) throw new Error('Invalid script parameter type.');
  return value;
}
