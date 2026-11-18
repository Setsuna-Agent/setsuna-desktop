import { detectWorkspacePreviewImageMimeType, MAX_WORKSPACE_IMAGE_BYTES } from '@setsuna-desktop/contracts';
import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { defineRuntimeDependencies, defineRuntimeFeature, runtimeRouteRegistrarCapability } from '@setsuna-desktop/feature-core/runtime';
import {
  commitDesignEdits, createDesignDocument, designFeature, designImageExtensions, designWorkspaceFilesCapability, importDesignImage,
  listDesignDocuments, navigateDesignHistory, readDesignDocument,
} from '../contracts/index.js';
import { DesignDocumentService } from './design-document-service.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  files: requiredCapability(designWorkspaceFilesCapability),
});

export const designRuntimeFeature = defineRuntimeFeature({
  definition: designFeature,
  dependencies,
  setup({ dependencies: { routes, files }, scope }) {
    const documents = new DesignDocumentService(files);
    routes.register(scope, importDesignImage, ({ ref, name, base64 }, { signal }) => {
      const bytes = Buffer.from(base64, 'base64');
      const mimeType = detectWorkspacePreviewImageMimeType(bytes);
      if (!mimeType || bytes.byteLength > MAX_WORKSPACE_IMAGE_BYTES || bytes.toString('base64') !== base64) {
        throw new FeatureOperationFailure({ code: 'INVALID_INPUT', message: 'The design image is invalid or too large.', retryable: false });
      }
      return files.importImage(ref, { name, extension: designImageExtensions[mimeType], bytes }, signal);
    });
    routes.register(scope, listDesignDocuments, (workspace, { signal }) => files.list(workspace, signal));
    routes.register(scope, createDesignDocument, (input, { signal }) => documents.create(input, signal));
    routes.register(scope, readDesignDocument, (input, { signal }) => documents.read(input, signal));
    routes.register(scope, commitDesignEdits, (input, { signal }) => documents.commit(input, signal));
    routes.register(scope, navigateDesignHistory, (input, { signal }) => documents.navigate(input, signal));
  },
});
