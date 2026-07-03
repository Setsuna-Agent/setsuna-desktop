import type { RuntimeSkillSummary, WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';

export type TextCommand = {
  end: number;
  query: string;
  start: number;
};

export function parseMentionCommand(value: string, cursorOffset?: number | null): TextCommand | null {
  return parseCursorCommand(value, '@', cursorOffset);
}

export function parseSlashCommand(value: string, cursorOffset?: number | null): TextCommand | null {
  return parseCursorCommand(value, '/', cursorOffset);
}

export function entryLabel(entry: WorkspaceEntrySearchItem): string {
  return entry.kind === 'directory' ? `${entry.path.replace(/\/$/, '')}/` : entry.path;
}

export function skillTokenText(skill: RuntimeSkillSummary): string {
  return `/${skillDisplayText(skill)}`;
}

export function skillDisplayText(skill: RuntimeSkillSummary): string {
  return skill.name.trim() || skill.id;
}

export function stripSkillToken(value: string, skill: RuntimeSkillSummary): string {
  const escaped = skillTokenText(skill).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), ' ').replace(/[ \t]{2,}/g, ' ').trimStart();
}

function parseCursorCommand(value: string, marker: '@' | '/', cursorOffset?: number | null): TextCommand | null {
  const cursor = clampCursorOffset(value, cursorOffset);
  const directCommand = parseCommandEndingAtCursor(value, marker, cursor);
  if (directCommand) return directCommand;
  return parseIsolatedCommandBeforeCursor(value, marker, cursor);
}

function parseCommandEndingAtCursor(value: string, marker: '@' | '/', cursor: number): TextCommand | null {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = value.slice(0, cursor).match(new RegExp(`(^|\\s)${escapedMarker}([^\\s\\n]*)$`));
  if (!match || match.index === undefined) return null;
  if (!isCommandBoundary(value.charAt(cursor))) return null;
  const start = match.index + (match[1] || '').length;
  return {
    end: cursor,
    query: match[2] || '',
    start,
  };
}

function parseIsolatedCommandBeforeCursor(value: string, marker: '@' | '/', cursor: number): TextCommand | null {
  let markerIndex = cursor - 1;
  while (markerIndex >= 0 && isInlineWhitespace(value.charAt(markerIndex))) {
    markerIndex -= 1;
  }
  if (value.charAt(markerIndex) !== marker) return null;
  if (!isCommandBoundary(value.charAt(markerIndex - 1)) || !isCommandBoundary(value.charAt(markerIndex + 1))) return null;
  return {
    end: cursor,
    query: '',
    start: markerIndex,
  };
}

function clampCursorOffset(value: string, cursorOffset?: number | null): number {
  if (typeof cursorOffset !== 'number' || !Number.isFinite(cursorOffset)) return value.length;
  return Math.min(value.length, Math.max(0, Math.floor(cursorOffset)));
}

function isCommandBoundary(char: string): boolean {
  return !char || /\s/u.test(char);
}

function isInlineWhitespace(char: string): boolean {
  return char === ' ' || char === '\t';
}
