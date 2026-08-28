import type {
  DesktopOpenPathResult,
  DesktopWorkspaceFilePreviewResult,
} from '@setsuna-desktop/contracts';
import type { RuntimeArtifact } from '../contracts/index.js';

export async function openArtifactWithDefaultApp(
  artifact: RuntimeArtifact,
  openWorkspaceFile: (
    workspaceRoot: string,
    filePath: string,
  ) => Promise<DesktopOpenPathResult>,
): Promise<string | null> {
  const result = await openWorkspaceFile(artifact.workspaceRoot, artifact.path);
  return result.ok ? null : result.error ?? null;
}

export async function openArtifactInBrowser(
  artifact: RuntimeArtifact,
  createWorkspaceFilePreview: (
    workspaceRoot: string,
    filePath: string,
  ) => Promise<DesktopWorkspaceFilePreviewResult>,
  openBrowser: (url: string) => void,
): Promise<string | null> {
  const result = await createWorkspaceFilePreview(artifact.workspaceRoot, artifact.path);
  if (!result.ok) return result.error;
  openBrowser(result.url);
  return null;
}
