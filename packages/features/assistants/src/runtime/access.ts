import type { Assistant, AssistantProject, AssistantsRuntimeHost, AssistantThreadInfo, AssistantThreadMessage } from '../contracts/index.js';

export class AssistantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantAccessError';
  }
}

/**
 * The single authorization boundary for assistant tools. Project search, history reads and task
 * targets all resolve through here, so an assistant can never reach a project it was not granted.
 */
export class AssistantAccess {
  constructor(private readonly host: AssistantsRuntimeHost) {}

  async projects(assistant: Assistant): Promise<AssistantProject[]> {
    const granted = new Set(assistant.projectIds);
    return (await this.host.listProjects()).filter((project) => granted.has(project.id));
  }

  async project(assistant: Assistant, projectId: string): Promise<AssistantProject> {
    const project = (await this.projects(assistant)).find((item) => item.id === projectId);
    if (!project) throw new AssistantAccessError(`Project ${projectId} is not authorized for this assistant or is unavailable.`);
    return project;
  }

  /** Only ordinary, unarchived project conversations inside granted projects are reachable. */
  async thread(assistant: Assistant, threadId: string, projectId?: string): Promise<AssistantThreadInfo> {
    const info = await this.host.getThreadInfo(threadId);
    const reachable = info && !info.featureOwned && !info.archived && info.projectId && assistant.projectIds.includes(info.projectId);
    if (!reachable || (projectId && info.projectId !== projectId)) {
      throw new AssistantAccessError(`Conversation ${threadId} is not available in this assistant's authorized projects.`);
    }
    await this.project(assistant, info.projectId!);
    return info;
  }

  async search(assistant: Assistant, input: { projectId?: string; query?: string; limit: number }): Promise<AssistantThreadInfo[]> {
    const projectIds = input.projectId
      ? [(await this.project(assistant, input.projectId)).id]
      : (await this.projects(assistant)).map((project) => project.id);
    if (!projectIds.length) return [];
    const threads = await this.host.searchThreads({ projectIds, query: input.query, limit: input.limit });
    // The host filters too; checking again keeps this boundary independent of host query semantics.
    return threads.filter((thread) => thread.projectId && projectIds.includes(thread.projectId) && !thread.featureOwned && !thread.archived);
  }

  async read(assistant: Assistant, threadId: string, limit: number): Promise<{ thread: AssistantThreadInfo; messages: AssistantThreadMessage[] }> {
    const thread = await this.thread(assistant, threadId);
    return { thread, messages: await this.host.readThreadMessages(threadId, limit) };
  }
}
