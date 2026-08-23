import type { RuntimeMemoryKind } from '@setsuna-desktop/feature-memory/contracts';

export const DEFAULT_MEMORY_LIMIT = 50;
export const MAX_MEMORY_LIMIT = 500;
export const MEMORY_FILE_NAME = 'memories.json';
export const MEMORY_MARKDOWN_FILE_NAME = 'MEMORY.md';
export const MEMORY_SUMMARY_FILE_NAME = 'memory_summary.md';
export const RAW_MEMORIES_FILE_NAME = 'raw_memories.md';
export const ROLLOUT_SUMMARIES_DIR_NAME = 'rollout_summaries';
export const SKILLS_DIR_NAME = 'skills';
export const MEMORY_PREVIEW_MAX_ITEMS = 500;
export const MEMORY_PREVIEW_SNIPPET_CHARS = 1200;
export const DEFAULT_MEMORY_FILE_LIST_LIMIT = 50;
export const DEFAULT_MEMORY_FILE_SEARCH_LIMIT = 50;
export const MAX_MEMORY_FILE_RESULTS = 200;
export const MAX_MEMORY_CONTENT_CHARS = 4000;
export const MAX_MEMORY_TITLE_CHARS = 80;
export const MAX_MEMORY_SOURCE_CHARS = 160;
export const MAX_MEMORY_TAG_CHARS = 40;
export const MAX_MEMORY_TAGS = 8;
export const MAX_STAGE1_RAW_MEMORY_CHARS = 60_000;
export const MAX_STAGE1_ROLLOUT_SUMMARY_CHARS = 4_000;
export const MAX_STAGE1_ROLLOUT_SLUG_CHARS = 80;
export const MAX_STAGE1_FAILURE_REASON_CHARS = 500;
export const MAX_PHASE2_FAILURE_REASON_CHARS = 500;
export const MEMORY_KINDS = new Set<RuntimeMemoryKind>([
  'preference',
  'project_rule',
  'fact',
  'workflow',
  'decision',
  'note',
]);
