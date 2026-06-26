import type { RuntimeSkillSummary, WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';

export type TextCommand = {
  end: number;
  query: string;
  start: number;
};

export function parseMentionCommand(value: string): TextCommand | null {
  return parseTrailingCommand(value, '@');
}

export function parseSlashCommand(value: string): TextCommand | null {
  return parseTrailingCommand(value, '/');
}

export function entryLabel(entry: WorkspaceEntrySearchItem): string {
  return entry.kind === 'directory' ? `${entry.path.replace(/\/$/, '')}/` : entry.path;
}

export function skillTokenText(skill: RuntimeSkillSummary): string {
  return `/${skill.name}`;
}

export function stripSkillToken(value: string, skill: RuntimeSkillSummary): string {
  const escaped = skillTokenText(skill).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), ' ').replace(/[ \t]{2,}/g, ' ').trimStart();
}

function parseTrailingCommand(value: string, marker: '@' | '/'): TextCommand | null {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = value.match(new RegExp(`(^|\\s)${escapedMarker}([^\\s\\n]*)$`));
  if (!match || match.index === undefined) return null;
  const start = match.index + (match[1] || '').length;
  return {
    end: value.length,
    query: match[2] || '',
    start,
  };
}
