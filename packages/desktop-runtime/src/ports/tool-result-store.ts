/**
 * 超限工具结果的本地存储边界。
 *
 * 只有最终允许暴露给模型的完整文本才会落盘(即 PostToolUse hook / extension
 * 处理之后的结果),原始 CDP 帧、shell 原始流都不在此列。结果按 thread 授权,
 * 其他 thread 即使猜到 result_id 也不能读取。
 */
export type StoredToolResultInput = {
  /** 调用方生成的稳定 ID,必须同时写进截断信封,模型才能凭它恢复。 */
  resultId: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  /** 最终允许暴露给模型的完整文本,已在 hooks/extensions 之后生成。 */
  fullText: string;
  originalEstimatedTokens: number;
  visibleTokenLimit: number;
  /** 本地存储本身也发生裁剪(单结果硬上限或线程配额),模型端 envelope 需注明。 */
  locallyTruncated: boolean;
};

export type StoredToolResultPage = {
  /** 本次读取范围内可见的文本。 */
  content: string;
  /** 下一页起始字节偏移;null 表示已到末尾。 */
  nextOffset: number | null;
  totalBytes: number;
};

export type StoredToolResultRecord = {
  resultId: string;
  threadIds: string[];
  toolCallId: string;
  toolName: string;
  originalEstimatedTokens: number;
  visibleTokenLimit: number;
  locallyTruncated: boolean;
  /** 存储的完整文本字节数(可能小于 fullText,因为单结果硬上限已裁剪)。 */
  sizeBytes: number;
  createdAt: string;
};

export type RetainStoredToolResultsInput = {
  sourceThreadId: string;
  destinationThreadId: string;
  resultIds: string[];
};

export type RetainStoredToolResultsResult = {
  retainedResultIds: string[];
  unavailableResultIds: string[];
};

export type ToolResultStore = {
  save(input: StoredToolResultInput): Promise<{ locallyTruncated: boolean }>;
  /**
   * 按 thread 授权读取一段范围。offset/limit 以 UTF-8 字节计。
   * 线程无权访问、结果不存在或范围无效时返回 null。
   */
  read(threadId: string, resultId: string, offset: number, limit: number): Promise<StoredToolResultPage | null>;
  /**
   * fork/side conversation 只继承源线程仍可访问的结果。正常配额淘汰通过
   * unavailableResultIds 返回；索引读写等真实存储错误仍抛出。
   */
  retainForThread(input: RetainStoredToolResultsInput): Promise<RetainStoredToolResultsResult>;
  releaseThread(threadId: string): Promise<void>;
  /** 启动恢复:清理已删除线程的孤儿结果。 */
  recover(validThreadIds: string[]): Promise<void>;
};
