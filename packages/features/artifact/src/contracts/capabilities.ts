import type {
  DesktopOpenPathResult,
  DesktopWorkspaceFilePreviewResult,
  RuntimeEnvironment,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export type ArtifactToolExecutionContext = Readonly<{
  threadId: string;
  projectId?: string;
  turnId?: string;
  toolCallId?: string;
  environment?: RuntimeEnvironment;
}>;

export type ArtifactToolRuntimeProfile = Readonly<{
  supportsParallel: true;
}>;

export type ArtifactToolExecutionResult = Readonly<{
  content: string;
  preview?: string;
  data?: unknown;
}>;

export interface ArtifactRuntimeToolService {
  listTools(context: ArtifactToolExecutionContext): Promise<RuntimeToolDefinition[]>;
  systemPrompt(
    context: ArtifactToolExecutionContext,
    request?: Readonly<{ tools: RuntimeToolDefinition[] }>,
  ): string | null;
  toolRuntimeProfile(name: string): ArtifactToolRuntimeProfile | null;
  runTool(
    name: string,
    input: unknown,
    context: ArtifactToolExecutionContext,
  ): Promise<ArtifactToolExecutionResult>;
}

export const artifactRuntimeToolServiceCapability: CapabilityToken<ArtifactRuntimeToolService> = defineCapability({
  id: 'artifact.runtime-tools',
  description: 'Artifact-owned publish tool definition and execution service',
});

export type ArtifactFileMetadata = Readonly<{
  path: string;
  size: number;
  modifiedAt?: string;
}>;

export type ArtifactWorkspaceStatus = Readonly<{
  project?: Readonly<{
    id: string;
    path?: string;
  }>;
  exists: boolean;
  readable: boolean;
}>;

export interface ArtifactWorkspaceFiles {
  getStatus(projectId?: string): Promise<ArtifactWorkspaceStatus>;
  inspectFile(projectId: string, relativePath: string): Promise<ArtifactFileMetadata>;
}

export const artifactWorkspaceFilesCapability: CapabilityToken<ArtifactWorkspaceFiles> = defineCapability({
  id: 'artifact.workspace-files',
  description: 'Narrow workspace file inspection used to publish verified deliverables',
});

export interface ArtifactRendererHost {
  readonly createWorkspaceFilePreview: ((
    workspaceRoot: string,
    filePath: string,
  ) => Promise<DesktopWorkspaceFilePreviewResult>) | null;
  readonly openWorkspaceFile: ((
    workspaceRoot: string,
    filePath: string,
  ) => Promise<DesktopOpenPathResult>) | null;
}

export const artifactRendererHostCapability: CapabilityToken<ArtifactRendererHost> = defineCapability({
  id: 'artifact.renderer-host',
  description: 'Native file open and preview actions used by Artifact result cards',
});
