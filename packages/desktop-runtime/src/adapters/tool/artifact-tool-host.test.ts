import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileWorkspaceProjectStore } from '../workspace/file-workspace-project-store.js';
import { ArtifactToolHost, PUBLISH_ARTIFACT_TOOL_NAME } from './artifact-tool-host.js';

const PDF_CONTENT = Buffer.from('%PDF-1.4\nfixture\n', 'utf8');

describe('artifact tool host', () => {
  it('publishes a verified file from the temporary workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-artifact-test-'));
    const workspacePath = path.join(root, 'temporary-workspace');
    await mkdir(workspacePath, { recursive: true });
    await writeFile(path.join(workspacePath, 'AI 趋势报告.pdf'), PDF_CONTENT);
    const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock, {
      temporaryWorkspacePath: workspacePath,
    });
    const host = new ArtifactToolHost(store);
    const context = { threadId: 'thread_1', turnId: 'turn_1', toolCallId: 'call/1' };
    const tools = await host.listTools(context);
    const workspace = await store.getStatus();

    expect(tools).toEqual([expect.objectContaining({ name: PUBLISH_ARTIFACT_TOOL_NAME })]);
    expect(host.systemPrompt(context, { tools })).toContain('call publish_artifact once');
    await expect(host.runTool(PUBLISH_ARTIFACT_TOOL_NAME, { path: 'AI 趋势报告.pdf' }, context)).resolves.toMatchObject({
      content: expect.stringContaining('AI 趋势报告.pdf'),
      preview: '发布产物 AI 趋势报告.pdf',
      data: {
        artifact: {
          id: 'artifact_call_1',
          kind: 'file',
          name: 'AI 趋势报告.pdf',
          projectId: 'temporary_workspace',
          workspaceRoot: workspace.project?.path,
          path: 'AI 趋势报告.pdf',
          mimeType: 'application/pdf',
          size: PDF_CONTENT.byteLength,
          modifiedAt: expect.any(String),
        },
      },
    });
  });

  it('accepts absolute paths inside a project and rejects invalid targets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-artifact-test-'));
    const projectDir = path.join(root, 'project');
    await mkdir(path.join(projectDir, 'output'), { recursive: true });
    await writeFile(path.join(projectDir, 'output', 'report.xlsx'), 'workbook');
    await writeFile(path.join(root, 'outside.pdf'), PDF_CONTENT);
    const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock);
    const project = await store.addProject({ path: projectDir });
    const host = new ArtifactToolHost(store);
    const context = { threadId: 'thread_1', projectId: project.id, toolCallId: 'call_2' };

    await expect(host.runTool(
      PUBLISH_ARTIFACT_TOOL_NAME,
      { path: path.join(project.path, 'output', 'report.xlsx') },
      context,
    )).resolves.toMatchObject({
      data: { artifact: { path: 'output/report.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } },
    });
    await expect(host.runTool(PUBLISH_ARTIFACT_TOOL_NAME, { path: '../outside.pdf' }, context)).rejects.toThrow('escapes');
    await expect(host.runTool(PUBLISH_ARTIFACT_TOOL_NAME, { path: 'output' }, context)).rejects.toThrow('not a file');
    await expect(host.runTool(PUBLISH_ARTIFACT_TOOL_NAME, { path: 'missing.pdf' }, context)).rejects.toThrow();
  });
});
