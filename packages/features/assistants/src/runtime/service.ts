import type { RuntimeInterfaceLanguage, StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { AssistantsRuntimeHost, AssistantsToolService, AssistantToolContext } from '../contracts/index.js';
import { AssistantAccess } from './access.js';
import { AssistantDeliveryOutbox } from './deliveries.js';
import { AssistantDirectory } from './directory.js';
import { QqConnectorManager } from './qq/qq-connector.js';
import { AssistantsStateStore } from './state-store.js';
import { AssistantSidebarEntries } from './sidebar-entries.js';
import { AssistantTaskCoordinator } from './tasks.js';
import { AssistantTools } from './tools.js';
import { AssistantReminders } from './reminders.js';

/**
 * Composes the assistants Feature. Activation only loads its state file; event subscription,
 * recovery and QQ connections start later in the background so they never delay runtime readiness.
 */
export class AssistantsRuntime implements AssistantsToolService {
  readonly directory: AssistantDirectory;
  readonly sidebarEntries: AssistantSidebarEntries;
  private readonly store: AssistantsStateStore;
  private readonly outbox: AssistantDeliveryOutbox;
  private readonly tasks: AssistantTaskCoordinator;
  private readonly connectors: QqConnectorManager;
  private readonly tools: AssistantTools;
  private readonly reminders: AssistantReminders;
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private disposed = false;
  private historyRetry: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: AssistantsRuntimeHost, private readonly onError: (error: unknown) => void) {
    this.store = new AssistantsStateStore(host.dataDir);
    this.outbox = new AssistantDeliveryOutbox(host, this.store, onError);
    this.directory = new AssistantDirectory(host, this.store, {
      connectorStatuses: () => this.connectors.statuses(),
      assistantChanged: () => { if (this.started) void this.connectors.sync(); },
    });
    this.sidebarEntries = new AssistantSidebarEntries(this.store);
    const access = new AssistantAccess(host);
    this.tasks = new AssistantTaskCoordinator(host, this.store, access, this.outbox, onError);
    this.connectors = new QqConnectorManager(host, this.store, this.directory, this.outbox, onError);
    this.reminders = new AssistantReminders(host, this.store, this.directory, this.outbox, onError);
    this.tools = new AssistantTools(host, this.directory, access, this.tasks, this.outbox, this.reminders);
  }

  initialize(): Promise<void> {
    return this.store.load();
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    // Subscribe before recovery so events raised meanwhile queue behind the recovery mutation.
    this.unsubscribe = this.host.subscribeEvents((event) => this.handleEvent(event));
    this.reminders.start();
    void this.recover();
  }

  pendingMutationCount(): number { return this.store.pendingMutationCount(); }

  setMaintenancePaused(paused: boolean): void {
    const resumed = this.store.isMaintenancePaused() && !paused;
    this.store.setMaintenancePaused(paused);
    if (resumed && this.started) void this.outbox.flush();
    if (resumed && this.started) void this.reminders.tick().catch(this.onError);
  }

  isAssistantThread(threadId: string): boolean {
    return Boolean(this.directory.assistantForThread(threadId));
  }

  listTools(language?: RuntimeInterfaceLanguage) { return this.tools.definitions(language); }

  systemPrompt(threadId: string, language?: RuntimeInterfaceLanguage): string | null {
    return this.tools.systemPrompt(threadId, language);
  }

  async runTool(name: string, input: unknown, context: AssistantToolContext) {
    // A fast model waits for the routing receipt instead of borrowing another QQ turn's peer.
    await this.store.settled();
    return this.tools.run(name, input, context);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.historyRetry) clearTimeout(this.historyRetry);
    this.unsubscribe?.();
    this.reminders.dispose();
    this.tasks.dispose();
    this.connectors.dispose();
    this.outbox.dispose();
    await this.store.dispose();
  }

  private handleEvent(event: StoredThreadEvent): void {
    if (this.disposed) return;
    if (event.type === 'thread.deleted' && this.directory.conversation(event.threadId)) {
      void this.store.mutate(({ state }) => { this.directory.forgetThread(state, event.threadId); }).catch(this.onError);
    }
    this.tasks.handleEvent(event);
    this.outbox.handleEvent(event);
  }

  /** Each stage is independent: one failing must not keep the others (or QQ) from recovering. */
  private async recover(): Promise<void> {
    const stages: (() => Promise<void>)[] = [
      () => this.reconcileHistory(),
      () => this.tasks.recover(),
      () => this.outbox.recover(),
      () => this.connectors.sync(),
    ];
    for (const stage of stages) {
      if (this.disposed) return;
      await stage().catch(this.onError);
    }
  }

  /** Busy histories retry in the background; runtime core readiness never waits for this migration. */
  private async reconcileHistory(): Promise<void> {
    try { await this.directory.reconcileConversations(); }
    finally {
      if (!this.disposed && this.directory.hasPendingConversationHistory()) {
        this.historyRetry = setTimeout(() => {
          this.historyRetry = null;
          if (!this.disposed) void this.reconcileHistory().catch(this.onError);
        }, 1_000);
        this.historyRetry.unref?.();
      }
    }
  }
}
