import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  WorkspaceSearchEngine,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResponse,
} from '../../ports/workspace-search-engine.js';
import { systemClock } from '../../ports/clock.js';
import { PcLocalToolHost } from '../tool/pc-local-tool-host.js';
import { FileWorkspaceProjectStore } from '../workspace/file-workspace-project-store.js';

describe('workspace search wiring', () => {
  it('routes project content search and Agent search_text through the same engine', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-search-wiring-'));
    const projectDir = path.join(root, 'project');
    await mkdir(projectDir);
    const engine = new RecordingSearchEngine();
    const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock, {
      searchEngine: engine,
      temporaryWorkspacePath: path.join(root, 'temporary'),
    });
    const project = await store.addProject({ path: projectDir });
    const host = new PcLocalToolHost(store, undefined, undefined, engine);

    const projectResult = await store.search(project.id, 'needle');
    const agentResult = await host.runTool('search_text', { query: 'needle', regex: false }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      environment: {
        id: 'local',
        cwd: project.path,
        workspaceRoot: project.path,
        workspaceRoots: [project.path],
      },
    });

    expect(engine.requests).toHaveLength(2);
    expect(engine.requests.map((request) => request.root)).toEqual([project.path, project.path]);
    expect(engine.requests.map((request) => request.regex)).toEqual([false, false]);
    expect(engine.requests.map((request) => request.supersedeKey)).toEqual(['project-content-search', undefined]);
    expect(projectResult.results).toEqual([{ path: 'src/shared.ts', line: 7, preview: 'const needle = true;' }]);
    expect(agentResult.content).toContain('src/shared.ts:7:7: const needle = true;');
  });

  it('keeps concurrent Agent searches for the same workspace independent', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-search-concurrent-agent-'));
    const projectDir = path.join(root, 'project');
    await mkdir(projectDir);
    const engine = new ConcurrentRecordingSearchEngine();
    const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock, {
      searchEngine: engine,
      temporaryWorkspacePath: path.join(root, 'temporary'),
    });
    const project = await store.addProject({ path: projectDir });
    const host = new PcLocalToolHost(store, undefined, undefined, engine);
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      environment: {
        id: 'local',
        cwd: project.path,
        workspaceRoot: project.path,
        workspaceRoots: [project.path],
      },
    };

    const [first, second] = await Promise.all([
      host.runTool('search_text', { query: 'first', regex: false }, context),
      host.runTool('search_text', { query: 'second', regex: false }, context),
    ]);

    expect(engine.requests.map((request) => request.supersedeKey)).toEqual([undefined, undefined]);
    expect(first.content).toContain('found first');
    expect(second.content).toContain('found second');
  });
});

class RecordingSearchEngine implements WorkspaceSearchEngine {
  readonly requests: WorkspaceTextSearchRequest[] = [];

  async search(request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResponse> {
    this.requests.push(request);
    return {
      query: request.query,
      engine: 'ripgrep',
      truncated: false,
      matches: [{
        path: 'src/shared.ts',
        lineNumber: 7,
        column: 7,
        line: 'const needle = true;',
        before: [],
        beforeStart: 0,
        after: [],
      }],
    };
  }
}

class ConcurrentRecordingSearchEngine implements WorkspaceSearchEngine {
  readonly requests: WorkspaceTextSearchRequest[] = [];
  private releaseBoth!: () => void;
  private readonly bothStarted = new Promise<void>((resolve) => {
    this.releaseBoth = resolve;
  });

  async search(request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResponse> {
    this.requests.push(request);
    if (this.requests.length === 2) this.releaseBoth();
    await this.bothStarted;
    return {
      query: request.query,
      engine: 'ripgrep',
      truncated: false,
      matches: [{
        path: 'src/shared.ts',
        lineNumber: 1,
        column: 1,
        line: `found ${request.query}`,
        before: [],
        beforeStart: 0,
        after: [],
      }],
    };
  }
}
