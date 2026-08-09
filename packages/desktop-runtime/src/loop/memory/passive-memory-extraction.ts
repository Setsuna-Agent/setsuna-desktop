import type {
  RuntimeMemoryKind,
  RuntimeMemoryScope,
  RuntimeMemoryStage1Status,
} from '@setsuna-desktop/contracts';
import {
  parseJsonArrayFromText,
  parseJsonObjectFromText,
  stripMarkdownFence,
} from '../context/prompt-utils.js';

export const PASSIVE_MEMORY_MAX_ITEMS = 5;
const PASSIVE_MEMORY_STAGE1_RAW_MAX_CHARS = 60_000;
const PASSIVE_MEMORY_STAGE1_SUMMARY_MAX_CHARS = 4_000;
const PASSIVE_MEMORY_STAGE1_SLUG_MAX_CHARS = 80;

type PassiveMemoryStage1Result = {
  status: RuntimeMemoryStage1Status;
  rawMemory?: string;
  rolloutSummary?: string;
  rolloutSlug?: string;
  failureReason?: string;
};

export type PassiveMemoryCandidate = {
  content: string;
  scope: RuntimeMemoryScope;
  kind?: RuntimeMemoryKind;
  title?: string;
  tags?: string[];
};

type PassiveMemoryExtraction = {
  candidates: PassiveMemoryCandidate[];
  stage1: PassiveMemoryStage1Result | null;
};

export function stage1RolloutSummaryFromCandidates(candidates: PassiveMemoryCandidate[]): string {
  return candidates.map((candidate) => {
    const kind = candidate.kind ?? 'note';
    const scope = candidate.scope === 'project' ? 'project' : 'global';
    return `- [${scope}/${kind}] ${candidate.content}`;
  }).join('\n');
}

export function passiveMemoryExtractionFromModelText(
  value: string,
  projectId: string | undefined,
): PassiveMemoryExtraction {
  const parsed = parseJsonObjectFromText(value);
  const rawMemories = Array.isArray(parsed?.memories) ? parsed.memories : parseJsonArrayFromText(value);
  const candidates: PassiveMemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of rawMemories) {
    const candidate = normalizePassiveMemoryCandidate(raw, projectId);
    if (!candidate) continue;
    const key = memoryDedupeText(candidate.content);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
    if (candidates.length >= PASSIVE_MEMORY_MAX_ITEMS) break;
  }
  return { candidates, stage1: passiveMemoryStage1FromModelText(value, parsed, candidates) };
}

export function memoryDedupeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function passiveMemoryStage1FromModelText(
  value: string,
  parsed: Record<string, unknown> | null,
  candidates: PassiveMemoryCandidate[],
): PassiveMemoryStage1Result | null {
  const text = stripMarkdownFence(value).trim();
  if (!text) return { status: 'succeeded_no_output' };
  if (parsed && hasStage1OutputFields(parsed)) {
    const rawMemory = normalizeStage1ModelText(parsed.raw_memory, PASSIVE_MEMORY_STAGE1_RAW_MAX_CHARS);
    const rolloutSummary = normalizeStage1ModelText(parsed.rollout_summary, PASSIVE_MEMORY_STAGE1_SUMMARY_MAX_CHARS);
    const rolloutSlug = normalizeStage1Slug(parsed.rollout_slug);
    if (!rawMemory || !rolloutSummary) return { status: 'succeeded_no_output' };
    return { status: 'succeeded', rawMemory, rolloutSummary, rolloutSlug };
  }
  if (parsed || candidates.length || parseJsonArrayFromText(value).length) {
    return candidates.length ? null : { status: 'succeeded_no_output' };
  }
  return { status: 'failed', failureReason: 'Model returned non-JSON memory extraction output.' };
}

function hasStage1OutputFields(value: Record<string, unknown>): boolean {
  return Object.hasOwn(value, 'raw_memory')
    || Object.hasOwn(value, 'rollout_summary')
    || Object.hasOwn(value, 'rollout_slug');
}

function normalizeStage1ModelText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\r\n/g, '\n').trim();
  return text ? Array.from(text).slice(0, maxChars).join('').trimEnd() : undefined;
}

function normalizeStage1Slug(value: unknown): string | undefined {
  const text = normalizeStage1ModelText(value, PASSIVE_MEMORY_STAGE1_SLUG_MAX_CHARS);
  return text?.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || undefined;
}

function normalizePassiveMemoryCandidate(
  value: unknown,
  projectId: string | undefined,
): PassiveMemoryCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const content = normalizePassiveMemoryText(record.content, 2000);
  if (!content) return null;
  return {
    content,
    scope: passiveMemoryScope(record.scope, projectId),
    kind: passiveMemoryKind(record.kind),
    title: normalizePassiveMemoryText(record.title, 80),
    tags: passiveMemoryTags(record.tags),
  };
}

function passiveMemoryScope(value: unknown, projectId: string | undefined): RuntimeMemoryScope {
  return value === 'project' && projectId ? 'project' : 'global';
}

function passiveMemoryKind(value: unknown): RuntimeMemoryKind | undefined {
  if (
    value === 'preference'
    || value === 'project_rule'
    || value === 'fact'
    || value === 'workflow'
    || value === 'decision'
    || value === 'note'
  ) return value;
  return undefined;
}

function passiveMemoryTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = [...new Set(
    value
      .map((item) => normalizePassiveMemoryText(item, 24))
      .filter((tag): tag is string => Boolean(tag)),
  )];
  return tags.length ? tags.slice(0, 6) : undefined;
}

function normalizePassiveMemoryText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? Array.from(text).slice(0, maxChars).join('') : undefined;
}
