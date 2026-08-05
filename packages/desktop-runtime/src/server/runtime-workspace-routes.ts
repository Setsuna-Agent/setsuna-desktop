import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type WorkspaceFileSaveInput,
  type WorkspaceSearchResponse,
} from '@setsuna-desktop/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { WorkspaceProjectStore } from '../ports/workspace-project-store.js';
import { WorkspaceSearchCancelledError } from '../ports/workspace-search-engine.js';
import {
  archiveRuntimeWorkspaceProject,
  saveRuntimeWorkspaceFile,
} from '../runtime/use-cases/workspace-operations.js';
import { assertSafeRuntimeId } from '../security/runtime-id.js';
import { RuntimeHttpError } from './http-error.js';
import { readBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

const PROJECT_CONTENT_SEARCH_SUPERSEDE_KEY = 'project-content-search';

export async function searchWorkspaceProjectForRest(
  workspaceProjects: Pick<WorkspaceProjectStore, 'search'>,
  projectId: string,
  query: string,
): Promise<WorkspaceSearchResponse> {
  try {
    return await workspaceProjects.search(projectId, query, {
      supersedeKey: PROJECT_CONTENT_SEARCH_SUPERSEDE_KEY,
    });
  } catch (error) {
    if (!(error instanceof WorkspaceSearchCancelledError)) throw error;
    return { query, results: [], truncated: false, superseded: true };
  }
}

export async function handleRuntimeWorkspaceRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v1/projects') {
    sendJson(response, 200, await runtime.workspaceProjects.listProjects());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/projects') {
    sendJson(response, 201, await runtime.workspaceProjects.addProject(await readBody(request)));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/workspace/status') {
    if (url.searchParams.has('threadId')) {
      const threadId = runtimeQueryId(url.searchParams.get('threadId'), 'Thread id');
      const thread = await runtime.threadStore.getThread(threadId);
      if (!thread) {
        sendJson(response, 404, { error: 'Thread not found' });
        return true;
      }
      const projectId = thread.projectId
        ?? (await runtime.workspaceProjects.ensureTemporaryWorkspace({
          threadId,
          createdAt: thread.createdAt,
        })).id;
      sendJson(response, 200, await runtime.workspaceProjects.getStatus(projectId));
      return true;
    }
    sendJson(
      response,
      200,
      await runtime.workspaceProjects.getStatus(url.searchParams.get('projectId') ?? undefined),
    );
    return true;
  }

  const projectArchiveMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/archive$/u);
  if (projectArchiveMatch && request.method === 'POST') {
    await archiveRuntimeWorkspaceProject(
      runtime,
      decodeURIComponent(projectArchiveMatch[1]),
    );
    sendJson(response, 200, { ok: true });
    return true;
  }

  const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/u);
  if (projectMatch && request.method === 'DELETE') {
    await runtime.workspaceProjects.removeProject(decodeURIComponent(projectMatch[1]));
    sendJson(response, 200, { ok: true });
    return true;
  }

  const projectFilesMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/files$/u);
  if (projectFilesMatch && request.method === 'GET') {
    sendJson(
      response,
      200,
      await runtime.workspaceProjects.listEntries(
        decodeURIComponent(projectFilesMatch[1]),
        url.searchParams.get('path') ?? '.',
      ),
    );
    return true;
  }

  const projectEntriesSearchMatch = url.pathname.match(
    /^\/v1\/projects\/([^/]+)\/entries\/search$/u,
  );
  if (projectEntriesSearchMatch && request.method === 'GET') {
    sendJson(
      response,
      200,
      await runtime.workspaceProjects.searchEntries(
        decodeURIComponent(projectEntriesSearchMatch[1]),
        url.searchParams.get('q') ?? '',
        url.searchParams.has('parent') ? url.searchParams.get('parent') : undefined,
      ),
    );
    return true;
  }

  const projectReadMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/read$/u);
  if (projectReadMatch && request.method === 'GET') {
    sendJson(
      response,
      200,
      await runtime.workspaceProjects.readFile(
        decodeURIComponent(projectReadMatch[1]),
        url.searchParams.get('path') ?? '',
        // CodeView virtualizes long files, so the regular preview can use the
        // same complete-content budget as edit mode instead of the legacy
        // lightweight prefix.
        { maxTextBytes: WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES },
      ),
    );
    return true;
  }

  const projectWriteMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/write$/u);
  if (projectWriteMatch && request.method === 'PUT') {
    sendJson(
      response,
      200,
      await saveRuntimeWorkspaceFile(
        runtime.workspaceProjects,
        decodeURIComponent(projectWriteMatch[1]),
        url.searchParams.get('path') ?? '',
        await readBody<WorkspaceFileSaveInput>(request),
      ),
    );
    return true;
  }

  const projectSearchMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/search$/u);
  if (projectSearchMatch && request.method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    sendJson(
      response,
      200,
      await searchWorkspaceProjectForRest(
        runtime.workspaceProjects,
        decodeURIComponent(projectSearchMatch[1]),
        query,
      ),
    );
    return true;
  }

  return false;
}

function runtimeQueryId(value: string | null, label: string): string {
  try {
    return assertSafeRuntimeId(value ?? '', label);
  } catch {
    throw new RuntimeHttpError(400, `${label} is invalid.`, 'invalid_runtime_id');
  }
}
