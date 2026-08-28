import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeDependencies, defineRuntimeFeature } from '@setsuna-desktop/feature-core/runtime';
import {
  artifactFeature,
  artifactRuntimeToolServiceCapability,
  artifactWorkspaceFilesCapability,
} from '../contracts/index.js';
import { ArtifactRuntimeTools } from './artifact-runtime-tools.js';

const dependencies = defineRuntimeDependencies({
  workspaceFiles: requiredCapability(artifactWorkspaceFilesCapability),
});

export const artifactRuntimeFeature = defineRuntimeFeature({
  definition: artifactFeature,
  dependencies,
  provides: [declareCapabilityProvider(artifactRuntimeToolServiceCapability)],
  setup(context) {
    context.provide(
      declareCapabilityProvider(artifactRuntimeToolServiceCapability),
      new ArtifactRuntimeTools(context.dependencies.workspaceFiles),
    );
  },
});
