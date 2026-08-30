import type { RendererAnySlot } from '@setsuna-desktop/feature-core/renderer';
import { comparePriority, isVisualRegistration } from './selection.js';
import type { ErasedDeclaration, ErasedRegistration } from './runtime.js';

export class RendererSlotValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Renderer Slot validation failed with ${issues.length} issue(s). ${issues[0] ?? ''}`.trim());
    this.name = 'RendererSlotValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

export function validateRendererPluginSnapshot(
  roots: ReadonlyMap<string, ErasedDeclaration>,
  bySlot: ReadonlyMap<string, readonly ErasedRegistration[]>,
  knownChildSlotIds: ReadonlySet<string>,
): void {
  const issues: string[] = [];
  const declared = new Set([...roots.keys(), ...knownChildSlotIds]);
  const graph = new Map<string, Set<string>>();
  const declarations: ErasedDeclaration[] = [...roots.values()];
  for (const entries of bySlot.values()) {
    for (const entry of entries) {
      if (!isVisualRegistration(entry)) continue;
      for (const child of entry.children) {
        declared.add(child.slot.id);
        declarations.push(child);
        const children = graph.get(entry.slot.id) ?? new Set<string>();
        children.add(child.slot.id);
        graph.set(entry.slot.id, children);
        if (scopeRank(child.slot.scope) < scopeRank(entry.slot.scope)) {
          issues.push(
            `Slot "${entry.slot.id}" (${entry.slot.scope}) cannot own broader child "${child.slot.id}" (${child.slot.scope}).`,
          );
        }
      }
    }
  }
  for (const slotId of bySlot.keys()) {
    if (!declared.has(slotId)) {
      issues.push(`Slot "${slotId}" has contributions but no root or parent declaration.`);
    }
  }
  for (const declaration of declarations) {
    const entries = bySlot.get(declaration.slot.id) ?? [];
    if (declaration.required && entries.length === 0 && !declaration.fallback) {
      issues.push(`Required Slot "${declaration.slot.id}" has no contribution or fallback.`);
    }
    if (!declaration.fallback) validateRequiredKeys(declaration, entries, issues);
  }
  for (const [slotId, entries] of bySlot) {
    const kind = entries[0]?.slot.kind;
    if (kind === 'single') validateHighestPriority(slotId, entries, issues);
    if (kind === 'keyed') {
      const keys = new Set(entries.filter(isVisualRegistration).map((entry) => entry.key ?? ''));
      for (const key of keys) {
        validateHighestPriority(
          `${slotId}[${key}]`,
          entries.filter((entry) => isVisualRegistration(entry) && entry.key === key),
          issues,
        );
      }
    }
  }
  detectDeclarationCycles(graph, issues);
  if (issues.length) throw new RendererSlotValidationError(issues);
}

function validateRequiredKeys(
  declaration: ErasedDeclaration,
  entries: readonly ErasedRegistration[],
  issues: string[],
): void {
  for (const requiredKey of declaration.requiredKeys) {
    const hasKey = entries.some((entry) => (
      isVisualRegistration(entry) && entry.key === requiredKey
    ));
    if (!hasKey) {
      issues.push(
        `Required keyed Slot "${declaration.slot.id}[${requiredKey}]" has no contribution or fallback.`,
      );
    }
  }
}

function validateHighestPriority(
  identity: string,
  entries: readonly ErasedRegistration[],
  issues: string[],
): void {
  const sorted = [...entries].sort(comparePriority);
  if (sorted.length > 1 && sorted[0].priority === sorted[1].priority) {
    issues.push(
      `Slot "${identity}" has multiple highest-priority entries: "${sorted[0].entryId}" and "${sorted[1].entryId}".`,
    );
  }
}

function detectDeclarationCycles(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  issues: string[],
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (slotId: string) => {
    if (visiting.has(slotId)) {
      const start = path.indexOf(slotId);
      issues.push(`Renderer Slot declaration cycle: ${[...path.slice(start), slotId].join(' -> ')}.`);
      return;
    }
    if (visited.has(slotId)) return;
    visiting.add(slotId);
    path.push(slotId);
    for (const child of graph.get(slotId) ?? []) visit(child);
    path.pop();
    visiting.delete(slotId);
    visited.add(slotId);
  };
  for (const slotId of graph.keys()) visit(slotId);
}

function scopeRank(scope: RendererAnySlot['scope']): number {
  if (scope === 'app') return 0;
  if (scope === 'project') return 1;
  return 2;
}
