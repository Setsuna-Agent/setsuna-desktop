export type PenObject = Readonly<Record<string, unknown>>;
export type ReadPenValue = (value: unknown) => unknown;
export type PenValues = Readonly<{ read: ReadPenValue; withTheme(value: unknown): PenValues }>;

export function penObject(value: unknown): PenObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PenObject : undefined;
}

export function penNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Math.abs(value) <= 10_000_000 ? value : undefined;
}

export function penPositive(value: unknown): number | undefined {
  const number = penNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

export function penSpacing(value: unknown): number {
  return Math.max(0, penNumber(value) ?? 0);
}

export function penOpacity(value: unknown): number | undefined {
  const number = penNumber(value);
  return number === undefined ? undefined : Math.min(1, Math.max(0, number));
}

export function createPenValues(document: PenObject): PenValues {
  const variables = penObject(document.variables) ?? {};
  const defaults = new Map<string, string>();
  for (const [axis, options] of Object.entries(penObject(document.themes) ?? {})) {
    if (Array.isArray(options) && typeof options[0] === 'string') defaults.set(axis, options[0]);
  }
  const scopes = new Map<string, PenValues>();

  function themeScope(overrides: ReadonlyMap<string, string>, key: string): PenValues {
    const resolved = new Map<string, unknown>();
    const themeValue = (axis: string) => overrides.get(axis) ?? defaults.get(axis);
    const scope: PenValues = {
      read(value) {
        if (typeof value !== 'string' || !value.startsWith('$')) return value;
        let current: unknown = value;
        const chain = new Set<string>();
        while (typeof current === 'string' && current.startsWith('$')) {
          const name = current.slice(1);
          if (!Object.hasOwn(variables, name)) break;
          if (resolved.has(name)) { current = resolved.get(name); break; }
          if (chain.has(name)) { current = undefined; break; }
          chain.add(name);
          const definition = penObject(variables[name])?.value;
          current = Array.isArray(definition) ? themedPenValue(definition, themeValue) : definition;
        }
        for (const name of chain) resolved.set(name, current);
        return current;
      },
      withTheme(value) {
        const patch = penObject(value);
        if (!patch) return scope;
        // Cache resolved variables by effective theme so sibling scopes never share stale values.
        const next = new Map(overrides);
        for (const [axis, option] of Object.entries(patch)) {
          if (typeof option !== 'string' || !defaults.has(axis)) continue;
          if (option === defaults.get(axis)) next.delete(axis);
          else next.set(axis, option);
        }
        const nextKey = JSON.stringify([...next].sort(([left], [right]) => left.localeCompare(right)));
        return scopes.get(nextKey) ?? themeScope(next, nextKey);
      },
    };
    scopes.set(key, scope);
    return scope;
  }
  return themeScope(new Map(), '[]');
}

function themedPenValue(values: readonly unknown[], themeValue: (axis: string) => string | undefined): unknown {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const entry = penObject(values[index]);
    if (entry && Object.entries(penObject(entry.theme) ?? {}).every(([axis, option]) => themeValue(axis) === option)) return entry.value;
  }
}
