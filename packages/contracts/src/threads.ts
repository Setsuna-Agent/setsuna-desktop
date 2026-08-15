import type {
  RuntimeApprovalAvailableDecision,
  RuntimeApprovalResolutionSource,
  RuntimeApprovalReviewAssessment,
  RuntimeApprovalRetryKind,
  RuntimeExecPolicyAmendment,
  RuntimeMcpElicitation,
  RuntimeNetworkApprovalContext,
  RuntimeNetworkPolicyAmendment,
  RuntimePermissionApprovalContext,
  RuntimeUserInputRequest,
} from './approvals.js';
import type { RuntimeInputMessageAttachment, RuntimeMessageAttachment } from './attachments.js';
import type { RuntimeApprovalReviewer } from './config.js';
import type { RuntimeHookSource } from './hooks.js';
import type { RuntimeMemoryCitation } from './memory.js';
import type {
  RuntimeAssistantMessagePhase,
  RuntimeMessagePromptSource,
  RuntimeMessageProviderMetadata,
  RuntimeMessageRole,
} from './message-metadata.js';
import type { RuntimePluginReference } from './plugin-reference.js';
import type {
  RuntimeModelRequestStepSnapshot,
  RuntimeModelVerification,
  RuntimeSafetyBuffering,
  RuntimeStreamItem,
  RuntimeToolCall,
} from './provider.js';
import type { RuntimeUsage } from './usage.js';
import { visibleTextOutsideThinkTags } from './swe/think-tag-scanner.js';

export type * from './message-metadata.js';

/** UTF-16 offsets into RuntimeMessage.content for one serialized Skill slot. */
export type RuntimeSkillReference = {
  skillId: string;
  start: number;
  end: number;
};

export function cloneRuntimeSkillReferences(
  references: RuntimeSkillReference[] | undefined,
): RuntimeSkillReference[] | undefined {
  return references?.map((reference) => ({ ...reference }));
}

/** Keep only ordered, non-overlapping references for Skills selected on this input. */
export function normalizeRuntimeSkillReferences({
  content,
  references,
  skillIds,
}: {
  content: string;
  references: RuntimeSkillReference[] | undefined;
  skillIds: string[];
}): RuntimeSkillReference[] {
  const selectedIds = new Set(skillIds);
  const ordered = (references ?? [])
    .map((reference, order) => ({
      order,
      skillId: reference.skillId.trim(),
      start: reference.start,
      end: reference.end,
    }))
    .filter((reference) => (
      selectedIds.has(reference.skillId)
      && Number.isInteger(reference.start)
      && Number.isInteger(reference.end)
      && reference.start >= 0
      && reference.end > reference.start
      && reference.end <= content.length
    ))
    .sort((left, right) => left.start - right.start || left.end - right.end || left.order - right.order);

  const normalized: RuntimeSkillReference[] = [];
  let previousEnd = 0;
  for (const reference of ordered) {
    if (reference.start < previousEnd) continue;
    normalized.push({
      skillId: reference.skillId,
      start: reference.start,
      end: reference.end,
    });
    previousEnd = reference.end;
  }
  return normalized;
}

export type RuntimeMessage = {
  id: string;
  clientId?: string;
  turnId?: string;
  role: RuntimeMessageRole;
  /** 用户输入的领域类型；普通消息可省略，特殊任务由 transcript 使用独立标识展示。 */
  inputKind?: RuntimeMessageInputKind;
  promptSource?: RuntimeMessagePromptSource;
  content: string;
  /** Ordered structured stream channels; absent only for historical tag-based messages. */
  streamParts?: RuntimeMessageStreamPart[];
  /** 该条用户输入显式选择的 Skill；用于历史消息恢复结构化引用样式。 */
  skillIds?: string[];
  /** 精确记录序列化 Skill 词槽的位置，避免把同名普通正文误渲染成引用。 */
  skillReferences?: RuntimeSkillReference[];
  createdAt: string;
  completedAt?: string;
  status?: 'streaming' | 'complete' | 'error';
  /** Missing while streaming means the runtime has not resolved presentation yet. */
  phase?: RuntimeAssistantMessagePhase;
  visibility?: 'transcript' | 'model';
  error?: string;
  attachments?: RuntimeMessageAttachment[];
  contextCompaction?: RuntimeContextCompactionNotice;
  goalMode?: RuntimeGoalLifecycleNotice;
  reviewMode?: RuntimeReviewModeNotice;
  planMode?: RuntimePlanModeNotice;
  providerMetadata?: RuntimeMessageProviderMetadata;
  memoryCitation?: RuntimeMemoryCitation;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: RuntimeToolCall[];
  toolRuns?: RuntimeToolRun[];
  hookRuns?: RuntimeHookRun[];
};

export type RuntimeMessageStreamPart = {
  type: 'content' | 'reasoning';
  content: string;
};

export type RuntimeContextCompactionNotice = {
  autoCompactTokenLimit?: number;
  compactedMessageCount: number;
  compactedRequestTokens?: number;
  compactedTokens: number;
  forced?: boolean;
  historyTokens?: number;
  keptRecentMessageCount: number;
  maxContextTokens?: number;
  maxContextTokensK: number;
  message?: string;
  originalMessageCount: number;
  originalRequestTokens?: number;
  originalTokens: number;
  scope?: string;
  source?: 'local' | 'remote';
  summaryRole?: string;
  summaryTokens?: number;
  targetContextTokens?: number;
  tokensUntilCompaction?: number;
  transcriptAfterMessageId?: string;
  triggerScopes?: string[];
};

export type RuntimeReviewModeNotice = {
  kind: 'entered' | 'exited';
  review: string;
  /** Provider-boundary reasoning was already separated; absent on historical tag envelopes. */
  reasoningSeparated?: true;
  /** Parsed review output used by the transcript summary and diff annotations. */
  findings?: RuntimeReviewFinding[];
  summary?: string;
};

export type RuntimeReviewFinding = {
  body: string;
  endLine?: number;
  path: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  startLine: number;
  title: string;
};

export type RuntimeReviewResult = {
  findings: RuntimeReviewFinding[];
  summary: string;
};

/** Parse the stable review profile output into data shared by runtime and UI. */
export function parseRuntimeReviewResult(
  review: string,
  options: { legacyThinkTags?: boolean } = {},
): RuntimeReviewResult {
  const normalized = (
    options.legacyThinkTags === false ? review : visibleTextOutsideThinkTags(review)
  ).trim();
  if (!normalized) return { findings: [], summary: '' };

  const lines = normalized.split(/\r?\n/u);
  const findings: RuntimeReviewFinding[] = [];
  const summaryLines: string[] = [];
  let current: (RuntimeReviewFinding & { bodyLines: string[] }) | null = null;

  const finishCurrent = () => {
    if (!current) return;
    const { bodyLines, ...finding } = current;
    findings.push({ ...finding, body: bodyLines.join('\n').trim() });
    current = null;
  };

  for (const line of lines) {
    const header = parseReviewFindingHeader(normalizeReviewFindingHeader(line));
    if (header) {
      finishCurrent();
      current = {
        ...header,
        body: '',
        bodyLines: [],
      };
      continue;
    }
    if (current) current.bodyLines.push(line);
    else summaryLines.push(line);
  }
  finishCurrent();

  return {
    findings,
    summary: summaryLines.join('\n').trim(),
  };
}

// Scan the stable `[P0-P3] title — path:line` header in one forward pass.
// Model output is untrusted, and the former multi-greedy expression could
// backtrack polynomially on long malformed lines. The latest valid delimiter
// wins so titles may quote an em dash; the first location after that delimiter
// remains the stable annotation target when providers append more locations.
function parseReviewFindingHeader(line: string): RuntimeReviewFinding | null {
  const priority = reviewPriorityPrefix(line);
  if (!priority) return null;

  let cursor = priority.contentStart;
  let delimiterVersion = 0;
  let resolvedVersion = -1;
  let titleEnd = -1;
  let pathStart = -1;
  const markdownLinksByLabelStart = reviewMarkdownLinksByLabelStart(line);
  let locationCandidate: {
    endLine?: number;
    pathEnd: number;
    pathStart: number;
    startLine: number;
    titleEnd: number;
  } | null = null;

  while (cursor < line.length) {
    if (cursor === pathStart && line[cursor] === '[') {
      const markdownLink = markdownLinksByLabelStart.get(cursor);
      if (markdownLink) {
        const [labelEnd, targetStart] = markdownLink;
        const labelLocation = reviewLocationWithin(
          line,
          cursor + 1,
          labelEnd,
        );
        if (labelLocation) {
          locationCandidate = {
            titleEnd,
            pathStart: cursor + 1,
            pathEnd: labelLocation.pathEnd,
            startLine: labelLocation.startLine,
            ...(labelLocation.endLine !== undefined ? { endLine: labelLocation.endLine } : {}),
          };
        }
        // Prefer a target containing the full repository path, while retaining the label as a
        // fallback for ordinary GitHub `#L42` links whose target has no `:42` location.
        pathStart = targetStart;
        cursor = targetStart;
        continue;
      }
    }

    if (isReviewWhitespace(line[cursor])) {
      const whitespaceStart = cursor;
      while (isReviewWhitespace(line[cursor])) cursor += 1;
      if (isReviewFindingDelimiter(line[cursor]) && isReviewWhitespace(line[cursor + 1])) {
        cursor += 1;
        while (isReviewWhitespace(line[cursor])) cursor += 1;
        delimiterVersion += 1;
        titleEnd = whitespaceStart;
        pathStart = cursor;
        continue;
      }
      continue;
    }

    if (line[cursor] === ':' && pathStart >= 0 && resolvedVersion !== delimiterVersion) {
      const location = reviewLocationAt(line, cursor);
      if (location) {
        locationCandidate = {
          titleEnd,
          pathStart,
          pathEnd: cursor,
          startLine: location.startLine,
          ...(location.endLine !== undefined ? { endLine: location.endLine } : {}),
        };
        resolvedVersion = delimiterVersion;
        cursor = location.end;
        continue;
      }
    }

    cursor += 1;
  }

  if (!locationCandidate) return null;
  const title = line.slice(priority.contentStart, locationCandidate.titleEnd).trim();
  const rawPath = line.slice(locationCandidate.pathStart, locationCandidate.pathEnd).trim();
  const path = rawPath.startsWith('`')
    ? rawPath.slice(1, rawPath.endsWith('`') ? -1 : undefined).trim()
    : rawPath;
  if (!title || !path) return null;

  return {
    priority: priority.priority,
    title,
    path,
    startLine: locationCandidate.startLine,
    ...(locationCandidate.endLine && locationCandidate.endLine !== locationCandidate.startLine
      ? { endLine: locationCandidate.endLine }
      : {}),
    body: '',
  };
}

function reviewPriorityPrefix(line: string): {
  contentStart: number;
  priority: RuntimeReviewFinding['priority'];
} | null {
  if (
    line.length < 6
    || line[0] !== '['
    || line[1] !== 'P'
    || line[2] < '0'
    || line[2] > '3'
    || line[3] !== ']'
    || !isReviewWhitespace(line[4])
  ) return null;

  let contentStart = 5;
  while (isReviewWhitespace(line[contentStart])) contentStart += 1;
  return {
    contentStart,
    priority: `P${line[2]}` as RuntimeReviewFinding['priority'],
  };
}

function reviewLocationAt(line: string, colonIndex: number, additionalSuffix?: string): {
  end: number;
  endLine?: number;
  startLine: number;
} | null {
  let cursor = colonIndex + 1;
  const startDigits = cursor;
  while (isAsciiDigit(line[cursor])) cursor += 1;
  if (cursor === startDigits) return null;

  const startLine = Number(line.slice(startDigits, cursor));
  let endLine: number | undefined;
  if (line[cursor] === '-') {
    const endDigits = cursor + 1;
    cursor = endDigits;
    while (isAsciiDigit(line[cursor])) cursor += 1;
    if (cursor === endDigits) return null;
    endLine = Number(line.slice(endDigits, cursor));
  }
  if (line[cursor] === '`') cursor += 1;

  const suffixStart = line[cursor];
  if (
    suffixStart !== undefined
    && !isReviewWhitespace(suffixStart)
    && suffixStart !== '（'
    && suffixStart !== '('
    && suffixStart !== '，'
    && suffixStart !== ','
    && suffixStart !== ';'
    && suffixStart !== ')'
    && suffixStart !== additionalSuffix
  ) return null;
  if (!Number.isSafeInteger(startLine) || (endLine !== undefined && !Number.isSafeInteger(endLine))) return null;

  return { end: cursor, startLine, ...(endLine !== undefined ? { endLine } : {}) };
}

function reviewLocationWithin(line: string, start: number, end: number) {
  for (let cursor = start; cursor < end; cursor += 1) {
    const location = line[cursor] === ':' ? reviewLocationAt(line, cursor, ']') : null;
    if (location && location.end <= end) return { ...location, pathEnd: cursor };
  }
  return null;
}
function reviewMarkdownLinksByLabelStart(line: string) {
  const links = new Map<number, [labelEnd: number, targetStart: number]>();
  let labelStart = -1;
  for (let cursor = 0; cursor + 1 < line.length; cursor += 1) {
    if (line[cursor] === '\\') {
      cursor += 1;
      continue;
    }
    if (line[cursor] === '[') {
      labelStart = cursor;
    } else if (labelStart >= 0 && line[cursor] === ']' && line[cursor + 1] === '(') {
      links.set(labelStart, [cursor, cursor + 2]);
      labelStart = -1;
    }
  }
  return links;
}

function isReviewFindingDelimiter(value: string | undefined): boolean {
  return value === '—' || value === '–' || value === '-';
}

function isReviewWhitespace(value: string | undefined): boolean {
  return value !== undefined && value.trim() === '';
}

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

/** Reparse persisted raw text so historical notices benefit from parser fixes. */
export function normalizeRuntimeReviewNotice(
  notice: RuntimeReviewModeNotice,
): RuntimeReviewModeNotice {
  if (notice.kind !== 'exited') return notice;
  const parsed = parseRuntimeReviewResult(notice.review, {
    legacyThinkTags: notice.reasoningSeparated !== true,
  });
  if (parsed.findings.length || !notice.findings?.length) {
    return { ...notice, ...parsed };
  }
  return notice;
}

function normalizeReviewFindingHeader(line: string): string {
  let normalized = line.trim()
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^[-+*]\s+/u, '');
  if (
    (normalized.startsWith('**') && normalized.endsWith('**'))
    || (normalized.startsWith('__') && normalized.endsWith('__'))
  ) {
    normalized = normalized.slice(2, -2).trim();
  }
  return normalized;
}

/** 仅用于读取旧线程；runtime 不再创建或更新 Plan mode 消息。 */
export type RuntimePlanModeNotice = {
  mode: 'plan';
  status: 'awaiting_confirmation' | 'accepted' | 'dismissed';
};

export type RuntimeMailboxDeliveryRecord = {
  id: string;
  content: string;
  createdAt: string;
  turnId?: string;
  deliveryMode?: 'queue_only' | 'trigger_turn';
  fromAgentId?: string;
  fromThreadId?: string;
  toAgentId?: string;
  triggerTurn?: boolean;
};

export type RuntimeThreadTurnTaskKind = 'regular' | 'compact' | 'review' | 'goal' | 'user_shell';

export type RuntimeThreadTurnStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type RuntimeThreadTurnTokenCount = {
  createdAt: string;
  modelContextWindow?: number;
  tokensUntilCompaction?: number;
  usage: RuntimeUsage;
};

export type RuntimeThreadTurnStepSnapshot = {
  createdAt: string;
  snapshot: RuntimeModelRequestStepSnapshot;
};

export type RuntimeThreadTurn = {
  id: string;
  completedAt?: string;
  diff?: string;
  error?: string;
  input?: string;
  items: RuntimeStreamItem[];
  modelVerifications?: RuntimeModelVerification[];
  safetyBuffering?: RuntimeSafetyBuffering;
  startedAt?: string;
  status?: RuntimeThreadTurnStatus;
  stepSnapshots?: RuntimeThreadTurnStepSnapshot[];
  taskKind?: RuntimeThreadTurnTaskKind;
  tokenCounts?: RuntimeThreadTurnTokenCount[];
};

export type RuntimeThreadContextCompactionState = {
  status: 'running' | 'completed';
  turnId?: string;
  completedAt?: string;
  forced?: boolean;
  maxContextTokens?: number;
  maxContextTokensK?: number;
  notice?: RuntimeContextCompactionNotice;
  percent?: number;
  startedAt?: string;
  tokensUntilCompaction?: number;
  usedTokens?: number;
};

export type RuntimeThreadGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';

export type RuntimeThreadGoalStopReasonCode =
  | 'userPaused'
  | 'turnCancelled'
  | 'runtimeReloaded'
  | 'budgetReached'
  | 'noProgress'
  | 'continuationLimit'
  | 'runtimeError'
  | 'usageLimited';

export type RuntimeThreadGoalStopReason = {
  code: RuntimeThreadGoalStopReasonCode;
  message?: string;
};

export type RuntimeThreadGoalSafetyState = {
  automaticTurns: number;
  consecutiveNoProgressTurns: number;
  lastProgressFingerprint?: string;
  /** Bounded recent evidence used to detect short repeating work cycles. */
  recentProgressFingerprints?: string[];
};

export type RuntimeThreadGoalExecutionOptions = {
  /** 创建 Goal 时绑定的输入资源和执行选项，后续自动续轮会保持同一语义。 */
  attachments?: RuntimeInputMessageAttachment[];
  /** 首轮 Goal 对应的可见用户消息，用于避免重复向模型附加同一批附件。 */
  sourceMessageId?: string;
  skillIds?: string[];
  skillReferences?: RuntimeSkillReference[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export type RuntimeThreadGoal = {
  version: 1;
  id: string;
  threadId: string;
  objective: string;
  status: RuntimeThreadGoalStatus;
  /** Legacy persisted field. New Goal writes always normalize this to null. */
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  /** Highest persisted event sequence already examined for Goal usage accounting. */
  accountedThroughSeq?: number;
  createdAt: number;
  updatedAt: number;
  stopReason?: RuntimeThreadGoalStopReason;
  safety?: RuntimeThreadGoalSafetyState;
  execution?: RuntimeThreadGoalExecutionOptions;
};

export type RuntimeGoalExitKind =
  | 'blocked'
  | 'usageLimited'
  | 'complete';

/** Legacy transcript notices may still contain lifecycle kinds hidden by current clients. */
export type RuntimeGoalLifecycleKind =
  | 'active'
  | 'continuation'
  | 'paused'
  | 'resumed'
  | 'budgetLimited'
  | 'cleared'
  | RuntimeGoalExitKind;

export type RuntimeGoalLifecycleNotice = {
  kind: RuntimeGoalLifecycleKind;
  goal: RuntimeThreadGoal;
};

export type RuntimeGoalExitNotice = {
  kind: RuntimeGoalExitKind;
  goal: RuntimeThreadGoal;
};

export function cloneRuntimeThreadGoal(goal: RuntimeThreadGoal): RuntimeThreadGoal {
  return {
    ...goal,
    stopReason: goal.stopReason ? { ...goal.stopReason } : undefined,
    safety: goal.safety ? {
      ...goal.safety,
      recentProgressFingerprints: goal.safety.recentProgressFingerprints
        ? [...goal.safety.recentProgressFingerprints]
        : undefined,
    } : undefined,
    execution: goal.execution ? {
      ...goal.execution,
      attachments: goal.execution.attachments?.map((attachment) => ({ ...attachment })),
      skillIds: goal.execution.skillIds ? [...goal.execution.skillIds] : undefined,
      skillReferences: cloneRuntimeSkillReferences(goal.execution.skillReferences),
    } : undefined,
  };
}

export type RuntimeThreadGoalPatch = {
  objective?: string;
  status?: RuntimeThreadGoalStatus;
};

export type RuntimeMessageInputKind = 'message' | 'goal' | 'review';

/** Review 通过专用启动接口执行，不进入普通消息队列。 */
export type RuntimeQueuedTurnInputKind = Exclude<RuntimeMessageInputKind, 'review'>;

export function normalizeRuntimeQueuedTurnInputKind(value: unknown): RuntimeQueuedTurnInputKind {
  // 已持久化的旧版 plan 队列项在升级后按普通消息继续执行，避免遗留队列卡住。
  return value === 'goal' ? 'goal' : 'message';
}

/**
 * 等待当前轮次结束后再作为独立用户轮次发送的输入。
 *
 * 它与 active turn 内的 steer 不同：排队期间不会进入 transcript，也不会被当前
 * 模型请求消费；只有被调度或手动立即发送后才会生成真正的用户消息。
 */
export type RuntimeQueuedTurnInput = {
  id: string;
  /** 旧版本持久化项可能缺失该字段，读取时按 message 归一化。 */
  kind?: RuntimeQueuedTurnInputKind;
  input: string;
  clientId?: string;
  attachments?: RuntimeInputMessageAttachment[];
  skillIds?: string[];
  skillReferences?: RuntimeSkillReference[];
  thinking?: boolean;
  thinkingEffort?: string;
  createdAt: string;
  updatedAt?: string;
};

export type RuntimeGitInfo = {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
};

export type RuntimeThreadMemoryMode = 'enabled' | 'disabled' | 'polluted';

export type RuntimeToolRunStatus = 'pending_approval' | 'running' | 'success' | 'error' | 'rejected' | 'cancelled';

export type RuntimeToolRunPhase = 'preparing' | 'executing';

export type RuntimeHookRunEventName = 'PreToolUse' | 'PermissionRequest' | 'PostToolUse' | 'PreCompact' | 'PostCompact' | 'SessionStart' | 'SubagentStart' | 'UserPromptSubmit' | 'SubagentStop' | 'Stop';

export type RuntimeHookRunStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'stopped';

export type RuntimeHookOutputEntryKind = 'warning' | 'stop' | 'feedback' | 'context' | 'error';

export type RuntimeHookOutputEntry = {
  kind: RuntimeHookOutputEntryKind;
  text: string;
};

export type RuntimeHookRun = {
  id: string;
  turnId?: string;
  toolCallId?: string;
  toolName?: string;
  eventName: RuntimeHookRunEventName;
  handlerType: 'command';
  status: RuntimeHookRunStatus;
  command?: string;
  matcher?: string | null;
  lastAssistantMessagePreview?: string;
  promptPreview?: string;
  statusMessage?: string | null;
  sourcePath?: string;
  source?: RuntimeHookSource;
  pluginId?: string;
  message?: string;
  entries?: RuntimeHookOutputEntry[];
  stdoutPreview?: string;
  stderrPreview?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
};

export type RuntimeToolRun = {
  id: string;
  name: string;
  plugin?: RuntimePluginReference;
  source?: 'agent' | 'userShell';
  status: RuntimeToolRunStatus;
  phase?: RuntimeToolRunPhase;
  argumentsPreview?: string;
  argumentsLength?: number;
  resultPreview?: string;
  data?: unknown;
  durationMs?: number;
  preparedAt?: string;
  startedAt?: string;
  completedAt?: string;
  approvalId?: string;
  approvalReason?: string;
  approvalReviewer?: RuntimeApprovalReviewer;
  approvalRetryKind?: RuntimeApprovalRetryKind;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approvalMessage?: string;
  approvalResolutionSource?: RuntimeApprovalResolutionSource;
  approvalReviewAssessment?: RuntimeApprovalReviewAssessment;
  availableApprovalDecisions?: RuntimeApprovalAvailableDecision[];
  proposedExecPolicyAmendment?: RuntimeExecPolicyAmendment;
  networkApprovalContext?: RuntimeNetworkApprovalContext;
  proposedNetworkPolicyAmendments?: RuntimeNetworkPolicyAmendment[];
  permissionApprovalContext?: RuntimePermissionApprovalContext;
  elicitation?: RuntimeMcpElicitation;
  userInput?: RuntimeUserInputRequest;
  hookRuns?: RuntimeHookRun[];
};

export type RuntimeThreadSummary = {
  id: string;
  activeTurnId?: string | null;
  forkedFromId?: string;
  parentThreadId?: string;
  projectId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  memoryMode?: RuntimeThreadMemoryMode;
  gitInfo?: RuntimeGitInfo | null;
  goal?: RuntimeThreadGoal;
  messageCount: number;
  lastMessagePreview: string;
  /** Present only on search results when an older message matched the query. */
  searchMatchPreview?: string;
};

export type RuntimeThread = RuntimeThreadSummary & {
  activeTurnId?: string | null;
  contextCompaction?: RuntimeThreadContextCompactionState;
  mailboxDeliveries?: RuntimeMailboxDeliveryRecord[];
  /** Present only on paged REST snapshots; persisted runtime snapshots omit it. */
  messagePage?: RuntimeThreadMessagePageInfo;
  pendingHookRuns?: RuntimeHookRun[];
  queuedTurnInputs?: RuntimeQueuedTurnInput[];
  turns?: RuntimeThreadTurn[];
  messages: RuntimeMessage[];
  lastSeq: number;
};

export type RuntimeThreadMessagePageInfo = {
  nextBefore: number | null;
  total: number;
};

export type RuntimeMessagePageQuery = {
  before?: number;
  limit?: number;
};

export type RuntimeMessagePage = RuntimeThreadMessagePageInfo & {
  messages: RuntimeMessage[];
};

export type ThreadQuery = {
  search?: string;
  includeArchived?: boolean;
  ancestorThreadId?: string;
  parentThreadId?: string;
  scope?: 'all' | 'global' | 'project';
  projectId?: string;
};

export type ThreadList = {
  threads: RuntimeThreadSummary[];
};

export type CreateThreadInput = {
  title?: string;
  projectId?: string;
  forkedFromId?: string;
  parentThreadId?: string;
  memoryMode?: RuntimeThreadMemoryMode;
};

export type ThreadPatch = {
  title?: string;
  archived?: boolean;
};

export type ThreadMemoryModePatch = {
  mode: RuntimeThreadMemoryMode;
};

export type SendTurnInput = {
  input: string;
  clientId?: string;
  attachments?: RuntimeInputMessageAttachment[];
  skillIds?: string[];
  skillReferences?: RuntimeSkillReference[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export type SteerTurnInput = {
  input: string;
  expectedTurnId: string;
  clientId?: string;
  attachments?: RuntimeInputMessageAttachment[];
  skillIds?: string[];
  skillReferences?: RuntimeSkillReference[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export type QueueTurnInput = Omit<SteerTurnInput, 'expectedTurnId'> & {
  /**
   * 旧客户端省略时按普通消息处理；runtime 持久化后始终写入显式类型。
   */
  kind?: RuntimeQueuedTurnInputKind;
};

/**
 * 取回编辑使用独立会话令牌，确保旧页面的迟到 release 不会解锁后来重新开始的编辑。
 */
export type QueuedTurnInputEditSession = {
  editToken: string;
  input: RuntimeQueuedTurnInput;
};

export type QueuedTurnInputEditRelease = {
  editToken: string;
};

export type QueuedTurnInputEditReleaseResponse = {
  released: boolean;
  resumed: QueuedTurnInputResponse | null;
};

export type QueuedTurnInputPatch = {
  editToken: string;
  input: string;
  /** undefined 表示保留原附件，空数组表示移除全部附件。 */
  attachments?: RuntimeInputMessageAttachment[];
};

export type QueuedTurnInputDisposition = 'queued' | 'started' | 'steered';

export type QueuedTurnInputResponse = {
  accepted: true;
  disposition: QueuedTurnInputDisposition;
  queuedInputId: string;
  turnId: string | null;
};

export type DeleteQueuedTurnInputResponse = {
  deleted: boolean;
};

export type SendTurnResponse = {
  accepted: true;
  turnId: string;
};

/**
 * startTurn 既可能立即启动，也可能因为线程忙碌或队列被编辑而仅完成持久化。
 */
export type StartTurnResponse = SendTurnResponse | QueuedTurnInputResponse;

export type MessagePatch = {
  content: string;
  skillIds?: string[];
  skillReferences?: RuntimeSkillReference[];
};

export type MessageDeleteInput = {
  messageIds: string[];
};

export type RegenerateMessageInput = {
  content?: string;
  skillIds?: string[];
  skillReferences?: RuntimeSkillReference[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export type RuntimeReviewTarget = { type: 'uncommittedChanges' } | { type: 'baseBranch'; branch: string } | { type: 'commit'; sha: string; title?: string } | { type: 'custom'; instructions: string };
