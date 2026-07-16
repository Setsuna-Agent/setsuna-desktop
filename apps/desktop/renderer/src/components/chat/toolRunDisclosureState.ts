export type ToolRunDisclosurePreference = {
  anchorRunId: string;
  open: boolean;
};

export type ToolRunDisclosurePreferences = ReadonlyMap<string, ToolRunDisclosurePreference>;

const assistantDisclosureScopeSeparator = '::tool-runs::';

export function assistantToolRunDisclosureScopePrefix(assistantItemId: string): string {
  return `${assistantItemId}${assistantDisclosureScopeSeparator}`;
}

export function assistantToolRunDisclosureScopeId(assistantItemId: string, segmentId: string): string {
  return `${assistantToolRunDisclosureScopePrefix(assistantItemId)}${segmentId}`;
}

export function resolveToolRunDisclosureOpen({
  defaultOpen,
  descendantExpanded,
  preference,
}: {
  defaultOpen: boolean;
  descendantExpanded?: boolean;
  preference?: ToolRunDisclosurePreference;
}): boolean {
  return preference?.open ?? (defaultOpen || descendantExpanded === true);
}

export function updateToolRunDisclosurePreference(
  current: ToolRunDisclosurePreferences,
  disclosureId: string,
  anchorRunId: string,
  open: boolean,
): ToolRunDisclosurePreferences {
  const existing = current.get(disclosureId);
  if (existing?.anchorRunId === anchorRunId && existing.open === open) return current;
  const next = new Map(current);
  next.set(disclosureId, { anchorRunId, open });
  return next;
}

export function hasExpandedToolRunDisclosure(
  preferences: ToolRunDisclosurePreferences,
  runIds: Iterable<string>,
): boolean {
  const visibleRunIds = new Set(runIds);
  for (const preference of preferences.values()) {
    if (preference.open && visibleRunIds.has(preference.anchorRunId)) return true;
  }
  return false;
}

export function hasExpandedAssistantToolRunDisclosure(
  preferences: ToolRunDisclosurePreferences,
  assistantItemId: string,
): boolean {
  const scopePrefix = assistantToolRunDisclosureScopePrefix(assistantItemId);
  for (const [disclosureId, preference] of preferences) {
    if (preference.open && disclosureId.startsWith(scopePrefix)) return true;
  }
  return false;
}
