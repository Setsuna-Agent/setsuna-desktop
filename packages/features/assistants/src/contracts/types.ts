import type { BrandIconConfig, RuntimeConfiguredModelReference, WorkspaceProjectIcon } from '@setsuna-desktop/contracts';
import type { AutomationSchedule } from '@setsuna-desktop/feature-automation/contracts';

export type AssistantQqSettings = {
  /** One QQ bot AppID binds to exactly one assistant, so inbound messages resolve their identity directly. */
  appId: string;
  enabled: boolean;
  /** Defaults to enabled when loading configurations saved before this option existed. */
  markdownEnabled?: boolean;
};

export type AssistantDraft = {
  name: string;
  avatar?: BrandIconConfig;
  avatarColor?: string;
  /** Tone and working preferences only; permissions are decided by the runtime. */
  personality: string;
  modelSelection?: RuntimeConfiguredModelReference;
  thinkingEffort?: string;
  /** Projects this assistant may search, read and dispatch work into. */
  projectIds: string[];
  qq?: AssistantQqSettings;
};

export type Assistant = AssistantDraft & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantExecutionConfig = Pick<AssistantDraft, 'modelSelection' | 'thinkingEffort'>;

export type AssistantPeerKind = 'c2c' | 'group';

/** A QQ private chat user or group, identified by the bot-scoped openid. */
export type AssistantPeerRef = {
  kind: AssistantPeerKind;
  openid: string;
};

export type AssistantQqPeer = AssistantPeerRef & {
  assistantId: string;
  /** Optional platform-provided name; authorization and routing always use openid. */
  displayName?: string;
  /** Unknown senders stay pending until the owner explicitly allows them on the desktop. */
  status: 'pending' | 'allowed';
  firstSeenAt: string;
  lastSeenAt: string;
};

/** Old source values are retained only while existing transcripts are imported. */
export type AssistantConversationSource = 'shared' | 'local' | 'qq-c2c' | 'qq-group';

/** One active transcript per assistant; imported originals remain as archived evidence. */
export type AssistantConversation = {
  threadId: string;
  assistantId: string;
  source: AssistantConversationSource;
  peerOpenid?: string;
  pinned?: boolean;
  /** History was copied into this assistant's shared transcript; the original is no longer an entry point. */
  mergedInto?: string;
  createdAt: string;
};

/**
 * pending: waiting for another write task in the same workspace and not submitted yet.
 * queued: accepted by the project conversation's durable queue.
 */
export type AssistantTaskStatus = 'pending' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export type AssistantTaskRequest = {
  id: string;
  /** desktop: the request needs structured data that only the desktop approval surface can supply. */
  kind: 'approval' | 'input' | 'desktop';
  toolName: string;
  summary: string;
  fields?: { id: string; label: string; required: boolean }[];
};

export type AssistantTaskOrigin = {
  /** Assistant conversation that dispatched the task and receives its reports. */
  threadId: string;
  turnId?: string;
  peer?: AssistantPeerRef;
  /** QQ message that triggered the dispatch, reused for passive replies while its window is open. */
  messageId?: string;
  /** Group member who asked for the work. */
  initiator?: string;
};

export type AssistantTask = {
  id: string;
  assistantId: string;
  title: string;
  pinned?: boolean;
  origin: AssistantTaskOrigin;
  projectId: string;
  workThreadId: string;
  /** Write tasks in the same workspace run one after another unless they use a worktree. */
  workspaceKey: string;
  /** Latest submitted instruction; kept while pending so it can start later. */
  instructions: string;
  /** Configuration captured for the work conversation, retained across queueing and restart. */
  execution?: AssistantExecutionConfig;
  status: AssistantTaskStatus;
  /** clientId of the latest submitted input; resolves the turn even after queueing, steering or restart. */
  clientId?: string;
  turnId?: string;
  queuedInputId?: string;
  requests: AssistantTaskRequest[];
  result?: string;
  error?: string;
  /** Last state delivered to the assistant; a difference means a report is still owed. */
  reported?: { status: AssistantTaskStatus; requestIds: string[] };
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type AssistantDeliveryStatus = 'waiting' | 'ready' | 'sent' | 'failed';

/** Outbound QQ reply for one assistant turn. Retries resend only this reply, never the turn. */
export type AssistantDelivery = {
  id: string;
  assistantId: string;
  peer: AssistantPeerRef;
  /** Absent for runtime notices that do not belong to a conversation turn. */
  threadId?: string;
  /** clientId of the inbound user message, when the reply belongs to a QQ-triggered turn. */
  clientId?: string;
  turnId?: string;
  /** Scheduled source; cancellation and authorization are checked again before sending. */
  reminderId?: string;
  replyToMessageId?: string;
  /** Group member who sent the inbound message. */
  initiator?: string;
  /** Project grants checked again before sending or retrying a task report. */
  projectIds?: string[];
  /** A failed passive reply falls back to active messages on retry. */
  activeOnly?: boolean;
  status: AssistantDeliveryStatus;
  content?: string;
  sentChunks: number;
  attempts: number;
  nextAttemptAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

/** Inbound QQ message ids, used for duplicate suppression and passive-reply sequencing. */
export type AssistantInboxEntry = {
  assistantId: string;
  messageId: string;
  peer: AssistantPeerRef;
  receivedAt: string;
  repliesUsed: number;
};

export type AssistantsState = {
  assistants: Assistant[];
  conversations: AssistantConversation[];
  peers: AssistantQqPeer[];
  tasks: AssistantTask[];
  reminders: AssistantReminder[];
  deliveries: AssistantDelivery[];
  inbox: AssistantInboxEntry[];
};

export type AssistantProject = { id: string; name: string; path: string; git: boolean; icon?: WorkspaceProjectIcon };

export type AssistantModel = {
  providerId: string;
  modelId: string;
  name: string;
  thinkingEfforts: string[];
};

export type AssistantConnectorState = 'disabled' | 'connecting' | 'connected' | 'error';

export type AssistantConnectorStatus = {
  assistantId: string;
  state: AssistantConnectorState;
  secretConfigured: boolean;
  error?: string;
};

/** Conversation as listed in the assistant page; title and recency come from the Core thread. */
export type AssistantConversationView = AssistantConversation & {
  title: string;
  updatedAt: string;
  activeTurnId?: string;
  /** Redirect a restored old entry to this same assistant after history consolidation. */
  previousThreadIds?: string[];
};

export type AssistantsSnapshot = {
  assistants: Assistant[];
  conversations: AssistantConversationView[];
  peers: AssistantQqPeer[];
  tasks: AssistantTask[];
  reminders: AssistantReminder[];
  connectors: AssistantConnectorStatus[];
  models: AssistantModel[];
  projects: AssistantProject[];
};

export type AssistantReminderDraft = {
  title: string;
  instructions: string;
  schedule: AutomationSchedule;
};

export type AssistantReminder = AssistantReminderDraft & {
  id: string;
  assistantId: string;
  peer?: AssistantPeerRef;
  /** QQ openids belong to one bot; a replacement AppID cannot inherit its recipients. */
  qqAppId?: string;
  initiator?: string;
  pinned?: boolean;
  status: 'active' | 'paused' | 'completed';
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** A durable mailbox receipt makes an interrupted submission safe to finish after restart. */
  lastRun?: { id: string; threadId: string; scheduledFor: string; instructions: string; turnId?: string };
};

export type AssistantPeerUpdate = AssistantPeerRef & {
  /** removed deletes the peer; a later message from it becomes pending again. */
  status: 'allowed' | 'removed';
};
