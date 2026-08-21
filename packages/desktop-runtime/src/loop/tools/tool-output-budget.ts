/**
 * 工具结果进入模型上下文前的体积预算。
 *
 * 参考 Codex,用 UTF-8 字节数近似 token:4 bytes ≈ 1 token。截断保留开头和
 * 结尾,预算包含截断提示与 result_id 元数据;本模块只负责估算、首尾截断和
 * 结果信封,不负责落盘(落盘由 ToolResultStore 完成)。
 */

export const TOOL_OUTPUT_BUDGET_DEFAULT_TOKENS = 10_000;
export const TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS = 8_000;
export const TOOL_OUTPUT_BUDGET_BROWSER_SNAPSHOT_TOKENS = 4_000;
export const TOOL_OUTPUT_BUDGET_READ_TOOL_RESULT_TOKENS = 8_000;

/** 单个结果本地存储硬上限;超过则本地存储本身也裁剪。 */
export const TOOL_OUTPUT_LOCAL_HARD_CAP_BYTES = 16 * 1024 * 1024;
/** 单个 thread 的本地结果配额;超过时按最旧优先淘汰。 */
export const TOOL_OUTPUT_THREAD_QUOTA_BYTES = 128 * 1024 * 1024;

/** UTF-8 字节数近似 token,向上取整,与 Codex 的 4 bytes ≈ 1 token 对齐。 */
export function estimateUtf8Tokens(text: string): number {
  return Math.max(0, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}

export type BoundedToolOutput = {
  content: string;
  originalEstimatedTokens: number;
  visibleTokens: number;
  truncated: boolean;
  /** 截断时写入,供 read_tool_result 恢复完整文本。 */
  resultId?: string;
};

export type BoundToolOutputInput = {
  content: string;
  tokenLimit: number;
  resultId?: string;
  /** 本地存储本身也发生裁剪;envelope 注明,提示 read_tool_result 也无法恢复全部原文。 */
  locallyTruncated?: boolean;
};

/**
 * 对工具结果应用模型可见上限。未超限时原样返回;超限时返回有界首尾摘要,
 * 信封本身计入预算,避免截断提示把上下文顶出限制。
 */
export function boundToolOutput(input: BoundToolOutputInput): BoundedToolOutput {
  const { content, tokenLimit, resultId, locallyTruncated } = input;
  const originalEstimatedTokens = estimateUtf8Tokens(content);
  if (originalEstimatedTokens <= tokenLimit) {
    return { content, originalEstimatedTokens, visibleTokens: originalEstimatedTokens, truncated: false };
  }

  const header = `${truncationHeader(resultId, originalEstimatedTokens, tokenLimit, locallyTruncated)}\n\n`;
  const separator = '\n... middle omitted ...\n';
  const overheadBytes = Buffer.byteLength(header, 'utf8') + Buffer.byteLength(separator, 'utf8');
  const availableBytes = Math.max(0, tokenLimit * 4 - overheadBytes);
  const headBytes = Math.floor(availableBytes * 0.6);
  const tailBytes = availableBytes - headBytes;

  const buffer = Buffer.from(content, 'utf8');
  const headEnd = utf8CharEnd(buffer, Math.min(headBytes, buffer.length));
  const tailStart = headEnd >= buffer.length
    ? buffer.length
    : utf8CharStart(buffer, Math.max(0, buffer.length - tailBytes));

  const head = buffer.subarray(0, headEnd).toString('utf8');
  const tail = tailStart > headEnd
    ? buffer.subarray(tailStart).toString('utf8')
    : '';

  const bounded = [
    header,
    head,
    ...(tail ? [separator, tail] : []),
  ].join('');
  return {
    content: bounded,
    originalEstimatedTokens,
    visibleTokens: estimateUtf8Tokens(bounded),
    truncated: true,
    ...(resultId ? { resultId } : {}),
  };
}

/** 截断信封的固定提示部分;预算按该字节数扣除。 */
export function truncationHeader(
  resultId: string | undefined,
  originalEstimatedTokens: number,
  visibleTokenLimit: number,
  locallyTruncated = false,
): string {
  return [
    'Warning: tool output was truncated.',
    ...(resultId ? [`result_id: ${resultId}`] : []),
    `original_estimated_tokens: ${originalEstimatedTokens}`,
    `visible_token_limit: ${visibleTokenLimit}`,
    ...(locallyTruncated ? ['locally_truncated: true'] : []),
    resultId
      ? 'Use read_tool_result to read another range.'
      : 'The complete output is unavailable because local result storage did not succeed.',
  ].join('\n');
}

/**
 * 返回从 index 开始的下一个 UTF-8 字符边界(即第一个不是 continuation 字节
 * 的位置)。若 index 本身已是字符边界则原样返回。
 */
export function utf8CharStart(buffer: Buffer, index: number): number {
  let cursor = Math.max(0, index);
  while (cursor < buffer.length && (buffer[cursor] & 0b1100_0000) === 0b1000_0000) {
    cursor += 1;
  }
  return cursor;
}

/** 返回 index 所在字符的起始字节位置(向前回退到非 continuation 字节)。 */
export function utf8CharEnd(buffer: Buffer, index: number): number {
  let cursor = Math.min(buffer.length, index);
  while (cursor > 0 && (buffer[cursor] & 0b1100_0000) === 0b1000_0000) {
    cursor -= 1;
  }
  return cursor;
}
