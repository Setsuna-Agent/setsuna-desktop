import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileWorkspaceProjectStore } from '../workspace/file-workspace-project-store.js';
import { VIEW_IMAGE_TOOL_NAME, WorkspaceImageToolHost } from './workspace-image-tool-host.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('workspace image tool host', () => {
  it('only advertises view_image to vision models and returns a model attachment', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-view-image-test-'));
    const projectDir = path.join(root, 'project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'reference.png'), ONE_PIXEL_PNG);
    const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock);
    const project = await store.addProject({ path: projectDir });
    const host = new WorkspaceImageToolHost(store);
    const textContext = { threadId: 'thread_1', projectId: project.id, modelCapabilities: { supportsImages: false } };
    const visionContext = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolCallId: 'call/1',
      projectId: project.id,
      modelCapabilities: { supportsImages: true },
    };

    await expect(host.listTools(textContext)).resolves.toEqual([]);
    await expect(host.runTool(VIEW_IMAGE_TOOL_NAME, { path: 'reference.png' }, textContext))
      .rejects.toThrow('does not support image input');
    await expect(host.listTools(visionContext)).resolves.toEqual([
      expect.objectContaining({ name: VIEW_IMAGE_TOOL_NAME }),
    ]);

    const result = await host.runTool(VIEW_IMAGE_TOOL_NAME, { path: 'reference.png' }, visionContext);
    expect(result).toMatchObject({
      content: expect.stringContaining('reference.png'),
      attachments: [{
        id: 'workspace_image_call_1',
        name: 'reference.png',
        type: 'image/png',
        size: ONE_PIXEL_PNG.byteLength,
        url: `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`,
      }],
      data: {
        projectId: project.id,
        path: 'reference.png',
        mimeType: 'image/png',
        size: ONE_PIXEL_PNG.byteLength,
      },
    });
    expect(JSON.stringify(result.data)).not.toContain(ONE_PIXEL_PNG.toString('base64'));
  });
});
