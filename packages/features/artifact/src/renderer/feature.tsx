import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRendererDependencies, defineRendererFeature } from '@setsuna-desktop/feature-core/renderer';
import { registerChatToolResult } from '@setsuna-desktop/renderer-contracts/chat';
import {
  artifactFeature,
  artifactRendererHostCapability,
  artifactResultCodec,
  isLegacyArtifactResult,
  legacyArtifactResultCodec,
  PUBLISH_ARTIFACT_TOOL_NAME,
} from '../contracts/index.js';
import { ArtifactToolResultView } from './ArtifactToolResultView.js';
import { artifactMessages } from './messages.js';

const dependencies = defineRendererDependencies({
  host: requiredCapability(artifactRendererHostCapability),
});

export const artifactRendererFeature = defineRendererFeature({
  definition: artifactFeature,
  dependencies,
  messages: [artifactMessages],
  setup(context) {
    const host = context.dependencies.host;
    registerChatToolResult(context.ui, {
        id: 'artifact.file-result-view',
        resultKind: 'artifact.file',
        major: 1,
        payload: artifactResultCodec,
        sourceToolNames: [PUBLISH_ARTIFACT_TOOL_NAME],
        legacy: {
          matches: isLegacyArtifactResult,
          payload: legacyArtifactResultCodec,
        },
        presentation: 'replace',
        placement: 'assistant-tail',
        identity: (artifact) => `${artifact.workspaceRoot}\u0000${artifact.path}`,
        render: (props) => <ArtifactToolResultView {...props} host={host} />,
    });
  },
});
