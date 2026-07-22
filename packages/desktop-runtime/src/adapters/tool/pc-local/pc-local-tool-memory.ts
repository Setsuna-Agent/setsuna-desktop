// @ts-nocheck

/** Plan updates and durable local-memory persistence. */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_MEMORY_STORE_DIR,
  MAX_MEMORY_CONTENT_CHARS,
  MAX_MEMORY_SOURCE_CHARS,
  MAX_MEMORY_TAG_CHARS,
  MAX_MEMORY_TAGS,
  MAX_MEMORY_TITLE_CHARS,
  MEMORY_KIND_LABELS,
  MEMORY_KINDS,
  MEMORY_STORE_FILE_NAME,
  MEMORY_STORE_VERSION,
} from './pc-local-tool-constants.js';
import {
  clipString,
  errorResult,
  okResult,
  shortSingleLine,
} from './pc-local-tool-utils.js';

export function updatePlan(args) {
  const plan = normalizePlanItems(args?.plan);
  if (!plan.length) return errorResult('请提供至少一个计划步骤。');
  const inProgressCount = plan.filter((item) => item.status === 'in_progress').length;
  if (inProgressCount > 1) return errorResult('任务计划最多只能有一个 in_progress 步骤。');
  const explanation = shortSingleLine(args?.explanation || '', 240);
  const completedCount = plan.filter((item) => item.status === 'completed').length;
  const activeStep = plan.find((item) => item.status === 'in_progress')?.step || '';
  const lines = plan.map((item) => `${planStatusMarker(item.status)} ${item.step}`);
  return okResult(
    [
      explanation ? `Note: ${explanation}` : '',
      'Task plan:',
      ...lines,
    ].filter(Boolean).join('\n'),
    activeStep
      ? `计划更新：${activeStep}`
      : `计划更新：${completedCount}/${plan.length} 已完成`,
    {
      explanation,
      plan,
      plan_summary: {
        total: plan.length,
        completed: completedCount,
        in_progress: inProgressCount,
        pending: plan.filter((item) => item.status === 'pending').length,
        active_step: activeStep,
      },
    },
  );
}

export async function rememberMemory(args, state) {
  if (state?.memoryEnabled === false) {
    return errorResult('记忆功能已关闭，不能沉淀新记忆。');
  }
  if (String(args?.origin || '').trim().toLowerCase() === 'passive' && state?.allowPassiveMemory !== true) {
    return errorResult('当前工具只用于用户明确要求的主动记忆，不能在本轮对话中机会主义写入被动记忆。');
  }

  const memory = normalizeRememberMemoryArgs(args, state);
  const storePath = memoryStorePath(state);
  const store = await readMemoryStore(storePath);
  const memories = Array.isArray(store.memories) ? store.memories : [];
  const dedupeKey = memoryDedupeKey(memory);
  const existing = memories.find((item) =>
    item
    && typeof item === 'object'
    && !['archived', 'deleted'].includes(String(item.status || 'active'))
    && memoryDedupeKey(item) === dedupeKey
  );

  if (existing) {
    return okResult(
      [
        `Memory already exists: ${existing.title || memory.title}`,
        `Scope: ${existing.scope || memory.scope}`,
        `Kind: ${existing.kind || memory.kind}`,
        `Storage: ${storePath}`,
      ].join('\n'),
      `记忆已存在：${existing.title || memory.title}`,
      {
        memory: existing,
        memory_duplicate: true,
        memory_store_path: storePath,
      },
    );
  }

  const now = new Date().toISOString();
  const nextMemory = {
    ...memory,
    id: `mem-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  const nextStore = {
    ...store,
    version: MEMORY_STORE_VERSION,
    memories: [...memories, nextMemory],
  };
  await writeMemoryStore(storePath, nextStore);

  return okResult(
    [
      `Memory saved: ${nextMemory.title}`,
      `Scope: ${nextMemory.scope}`,
      `Kind: ${nextMemory.kind}`,
      `Storage: ${storePath}`,
    ].join('\n'),
    `已沉淀记忆：${nextMemory.title}`,
    {
      memory: nextMemory,
      memory_duplicate: false,
      memory_store_path: storePath,
    },
  );
}

export function normalizeRememberMemoryArgs(args, state) {
  const content = clipString(String(args?.content ?? '').trim(), MAX_MEMORY_CONTENT_CHARS);
  if (!content) throw new Error('记忆内容不能为空。');
  const kind = normalizeMemoryKind(args?.kind);
  const scope = normalizeMemoryScope(args?.scope);
  const origin = normalizeMemoryOrigin(args?.origin, state);
  const title = normalizeMemoryTitle(args?.title, content, kind);
  const source = clipString(shortSingleLine(args?.source || '', MAX_MEMORY_SOURCE_CHARS), MAX_MEMORY_SOURCE_CHARS);
  const tags = normalizeMemoryTags(args?.tags);
  return {
    scope,
    kind,
    origin,
    title,
    content,
    ...(tags.length ? { tags } : {}),
    ...(source ? { source } : {}),
    ...(scope === 'project' ? { workspaceRoot: path.resolve(String(state?.root || process.cwd())) } : {}),
  };
}

function normalizeMemoryScope(value) {
  return String(value || '').trim().toLowerCase() === 'global' ? 'global' : 'project';
}

function normalizeMemoryKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return MEMORY_KINDS.has(kind) ? kind : 'note';
}

function normalizeMemoryOrigin(value, state) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'passive' && state?.allowPassiveMemory === true) return 'passive';
  return 'active';
}

function normalizeMemoryTitle(value, content, kind) {
  const explicitTitle = shortSingleLine(value || '', MAX_MEMORY_TITLE_CHARS);
  if (explicitTitle) return explicitTitle;
  const firstLine = shortSingleLine(String(content || '').split(/\r?\n/)[0] || '', MAX_MEMORY_TITLE_CHARS);
  return firstLine || MEMORY_KIND_LABELS[kind] || '记忆';
}

function normalizeMemoryTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of value) {
    const tag = shortSingleLine(item || '', MAX_MEMORY_TAG_CHARS);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_MEMORY_TAGS) break;
  }
  return tags;
}

function memoryDedupeKey(memory) {
  return [
    normalizeMemoryScope(memory?.scope),
    normalizeMemoryKind(memory?.kind),
    normalizeDedupeText(memory?.content),
    normalizeMemoryScope(memory?.scope) === 'project'
      ? path.resolve(String(memory?.workspaceRoot || ''))
      : '',
  ].join('\0');
}

function normalizeDedupeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function memoryStorePath(state) {
  return path.join(memoryStoreRoot(state), MEMORY_STORE_FILE_NAME);
}

function memoryStoreRoot(state) {
  const raw = String(state?.memoryStorageRoot || '').trim();
  return path.resolve(raw || DEFAULT_MEMORY_STORE_DIR);
}

async function readMemoryStore(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { version: MEMORY_STORE_VERSION, memories: [] };
    }
    return {
      ...parsed,
      version: Number(parsed.version || MEMORY_STORE_VERSION),
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: MEMORY_STORE_VERSION, memories: [] };
    if (error instanceof SyntaxError) {
      throw new Error(`记忆文件 JSON 解析失败：${error.message || String(error)}`);
    }
    throw error;
  }
}

async function writeMemoryStore(filePath, store) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}

export function normalizePlanItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const step = shortSingleLine(item.step || item.text || item.title || '', 180);
      const status = normalizePlanStatus(item.status);
      return step ? { step, status } : null;
    })
    .filter(Boolean)
    .slice(0, 12);
}

function normalizePlanStatus(value) {
  const status = String(value || '').trim();
  return status === 'in_progress' || status === 'completed' ? status : 'pending';
}

function planStatusMarker(status) {
  if (status === 'completed') return '[x]';
  if (status === 'in_progress') return '[>]';
  return '[ ]';
}
