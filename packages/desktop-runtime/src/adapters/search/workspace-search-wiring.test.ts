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
    expect(projectResult.results).toEqual([{ path: 'src/shared.ts', line: 7, preview: 'const needle = true;' }]);
    expect(agentResult.content).toContain('src/shared.ts:7:7: const needle = true;');
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
