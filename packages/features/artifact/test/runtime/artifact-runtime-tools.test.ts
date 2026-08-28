import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PUBLISH_ARTIFACT_TOOL_NAME,
  type ArtifactWorkspaceFiles,
} from '../../src/contracts/index.js';
import { ArtifactRuntimeTools } from '../../src/runtime/artifact-runtime-tools.js';

describe('ArtifactRuntimeTools', () => {
  it('publishes inspected metadata as a versioned Artifact result', async () => {
    const workspaceRoot = path.resolve('/workspace/project');
    const inspectFile = vi.fn().mockResolvedValue({
      path: 'output/report.xlsx',
      size: 512,
      modifiedAt: '2026-08-28T00:00:00.000Z',
    });
    const tools = new ArtifactRuntimeTools(workspaceFiles({
      id: 'project_1',
      path: workspaceRoot,
      inspectFile,
    }));

    await expect(tools.runTool(PUBLISH_ARTIFACT_TOOL_NAME, {
      path: path.join(workspaceRoot, 'output', 'report.xlsx'),
    }, {
      threadId: 'thread_1',
      projectId: 'project_1',
      toolCallId: 'call/1',
    })).resolves.toMatchObject({
      data: {
        resultKind: 'artifact.file',
        resultMajor: 1,
        payload: {
          id: 'artifact_call_1',
          name: 'report.xlsx',
          path: 'output/report.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 512,
        },
      },
    });
    expect(inspectFile).toHaveBeenCalledWith('project_1', path.join('output', 'report.xlsx'));
  });

  it('uses the managed workspace backing an unbound logical project', async () => {
    const getStatus = vi.fn().mockResolvedValue({
      project: workspaceProject('temporary_workspace.2026-08-28.thread_1', '/managed/thread_1'),
      exists: true,
      readable: true,
    });
    const inspectFile = vi.fn().mockResolvedValue({ path: 'report.pdf', size: 64 });
    const tools = new ArtifactRuntimeTools({ getStatus, inspectFile });

    await expect(tools.runTool(PUBLISH_ARTIFACT_TOOL_NAME, { path: 'report.pdf' }, {
      threadId: 'thread_1',
      projectId: 'logical_project',
      environment: {
        id: 'managed_environment',
        cwd: '/managed/thread_1',
        workspaceRoot: '/managed/thread_1',
        workspaceRoots: ['/managed/thread_1'],
        workspaceProjectId: 'temporary_workspace.2026-08-28.thread_1',
      },
    })).resolves.toMatchObject({
      data: { payload: { projectId: 'temporary_workspace.2026-08-28.thread_1' } },
    });
    expect(getStatus).toHaveBeenCalledWith('temporary_workspace.2026-08-28.thread_1');
  });
});

function workspaceFiles(input: Readonly<{
  id: string;
  path: string;
  inspectFile: ArtifactWorkspaceFiles['inspectFile'];
}>): ArtifactWorkspaceFiles {
  return {
    getStatus: async () => ({
      project: workspaceProject(input.id, input.path),
      exists: true,
      readable: true,
    }),
    inspectFile: input.inspectFile,
  };
}

function workspaceProject(id: string, projectPath: string) {
  return {
    id,
    name: id,
    path: projectPath,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
}
