import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { MAX_FILE_READ_STATE_ENTRIES } from './pc-local-tool-constants.js';
import { formatPath } from './pc-local-tool-paths.js';
import { errorResult } from './pc-local-tool-utils.js';

type FileReadIdentity = Pick<Stats, 'mtimeMs' | 'size'> & { contentHash?: string; samplingStepId?: string };

export type FileReadCacheState = { reads: Map<string, FileReadIdentity>; samplingStepId?: string };

/** Only actual reads establish observations; writes and previews must not refresh them. */
export function rememberRead(
  state: FileReadCacheState,
  filePath: string,
  info: Pick<Stats, 'mtimeMs' | 'size'>,
  completeContent?: string,
): void {
  const previous = state.reads.get(filePath);
  const sameVersion = previous?.mtimeMs === info.mtimeMs && previous.size === info.size;
  const contentHash = completeContent === undefined
    ? sameVersion ? previous.contentHash : undefined
    : hashContent(completeContent);
  // An unchanged reread must not erase evidence already available to an earlier
  // sampling step. A new content hash belongs to the step that actually read it.
  const samplingStepId = contentHash && contentHash === previous?.contentHash
    && (previous.samplingStepId || completeContent === undefined)
    ? previous.samplingStepId
    : state.samplingStepId;
  state.reads.delete(filePath);
  state.reads.set(filePath, { mtimeMs: info.mtimeMs, size: info.size, contentHash, samplingStepId });
  while (state.reads.size > MAX_FILE_READ_STATE_ENTRIES) {
    const oldest = state.reads.keys().next().value;
    if (oldest === undefined) break;
    state.reads.delete(oldest);
  }
}

export async function priorReadGuard(
  state: FileReadCacheState & { root: string },
  filePath: string,
  currentStats: Pick<Stats, 'mtimeMs' | 'size'>,
  verb: string,
) {
  const previous = state.reads.get(filePath);
  const label = formatPath(filePath, state.root);
  if (!previous) return errorResult(`请先查看 ${label}，再${verb}它。`);
  if (previous.mtimeMs !== currentStats.mtimeMs || previous.size !== currentStats.size) {
    return errorResult(`${label} 在上次查看后发生了变化，请重新查看后再${verb}。`);
  }
  return null;
}

export function overwriteObservationError(
  state: FileReadCacheState & { root: string }, filePath: string, currentContent: string,
): string | null {
  const observation = state.reads.get(filePath);
  const observed = observation?.contentHash;
  const label = formatPath(filePath, state.root);
  if (!observed) {
    return `覆盖现有文件 ${label} 前，必须在本轮使用 read_file 完整读取它（不指定范围）。局部或截断的读取、预览和写入不能代替完整读取；大文件请使用 edit 或 apply_patch 做定向修改。`;
  }
  if (observed !== hashContent(currentContent)) {
    return `${label} 在完整读取后发生了变化，不能按旧版本整文件覆盖。请重新 read_file 后再生成内容，或使用 edit/apply_patch 匹配当前原文。`;
  }
  if (state.samplingStepId && (!observation?.samplingStepId || observation.samplingStepId === state.samplingStepId)) {
    return `覆盖 ${label} 必须依据此前采样返回的完整内容；同一采样批次或批次不明的 read_file 不能授权本次 write_file。请等待读取结果，在下一次回复中生成覆盖内容。`;
  }
  return null;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
