import type { DesignDocument } from './document.js';
import { designResourceParts } from './design-resource-id.js';
import { designVariableCollectionKey, type DesignVariableModeIds } from './design-variable-collections.js';
import { designVariableAliasId, designVariableValue, type DesignVariable, type DesignVariableValue } from './design-variables.js';

export function createDesignVariableResolver(styles: DesignDocument['styles'], documentId: string, modes?: DesignVariableModeIds) {
  const values = new Map<string, DesignVariableValue>();

  function variable(id: string): DesignVariable | undefined {
    const style = styles && Object.hasOwn(styles, id) ? styles[id] : undefined;
    return style?.kind === 'text' ? undefined : style;
  }

  return function resolve(id: string): DesignVariableValue | undefined {
    const cached = values.get(id);
    if (cached !== undefined) return cached;
    let current = variable(id);
    if (!current) return;

    let key = id;
    const path = new Map<string, DesignVariableValue>();
    let result: DesignVariableValue;
    for (;;) {
      const known = values.get(key);
      if (known !== undefined) {
        result = known;
        break;
      }
      const repeated = path.get(key);
      if (repeated !== undefined) {
        // Each cycle member uses its own fallback. Earlier links use the value at the cycle entry.
        let inCycle = false;
        for (const [id, fallback] of path) {
          inCycle ||= id === key;
          values.set(id, inCycle ? fallback : repeated);
        }
        return values.get(id);
      }
      let mode: string | undefined;
      if (modes) {
        const owner = designResourceParts(key)?.documentId ?? documentId;
        const collection = designVariableCollectionKey(owner, current.collectionId);
        mode = Object.hasOwn(modes, collection) ? modes[collection] : undefined;
      }
      result = designVariableValue(current, mode);
      path.set(key, result);
      const aliasId = designVariableAliasId(current, mode);
      const source = aliasId ? variable(aliasId) : undefined;
      if (!aliasId || source?.kind !== current.kind) break;
      key = aliasId;
      current = source;
    }
    for (const entry of path.keys()) values.set(entry, result);
    return result;
  };
}

export function designVariableAliasDependents(styles: DesignDocument['styles'], id: string): ReadonlySet<string> {
  const dependents = new Map<string, string[]>();
  for (const [key, style] of Object.entries(styles ?? {})) {
    if (style.kind === 'text') continue;
    for (const target of [style.aliasId, ...Object.values(style.modeAliasIds ?? {})]) {
      if (!target) continue;
      const entries = dependents.get(target);
      if (entries) entries.push(key);
      else dependents.set(target, [key]);
    }
  }
  // Include every dependent across modes so a new reference stays safe on any board.
  const blocked = new Set([id]);
  for (const key of blocked) for (const dependent of dependents.get(key) ?? []) blocked.add(dependent);
  return blocked;
}

export function mapDesignVariableAliases(variable: DesignVariable, mapId: (id: string) => string): DesignVariable {
  if (!variable.aliasId && !variable.modeAliasIds) return variable;
  return { ...variable, aliasId: variable.aliasId && mapId(variable.aliasId),
    modeAliasIds: variable.modeAliasIds && Object.fromEntries(Object.entries(variable.modeAliasIds).map(([mode, id]) => [mode, mapId(id)])) };
}
