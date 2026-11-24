import { detectWorkspacePreviewImageMimeType, MAX_WORKSPACE_IMAGE_BYTES } from '@setsuna-desktop/contracts';
import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { defineRuntimeDependencies, defineRuntimeFeature, runtimeRouteRegistrarCapability } from '@setsuna-desktop/feature-core/runtime';
import {
  listProjectDesigns, getDesignCatalog, readDesignImage, searchDesignImages, setDesignProject, commitDesignEdits, createDesignDocument, deleteDesignDocument, designFeature, designFontStorageCapability, designImageExtensions,
  designScriptSandboxCapability, designWorkspaceFilesCapability, importDesignImage, importDesignScript,
  importDesignShader, listDesignDocumentEntries, listDesignDocuments, maxDesignScriptBytes, maxDesignShaderBytes, moveDesignDocument, navigateDesignHistory,
  parseDesignShaderSource, readDesignDocument, readDesignScriptParameters, readDesignShader, renderDesignScript, resolveDesignDocumentRoot,
  type DesignDocumentRef, type DesignScriptParameter,
} from '../contracts/index.js';
import { importDesignFont, listDesignFonts, readDesignFont, removeDesignFont } from '../contracts/design-fonts.js';
import { designScriptParameterValue } from '../contracts/design-script-parameters.js';
import { designToolsCapability, designTurnHostCapability, startDesignTask, replyDesignTask, bindDesignInput, watchDesignCommand, stopDesignTask } from '../contracts/design-task.js';
import { createDesignConversation, listDesignConversations } from '../contracts/design-conversations.js';
import { designCommandFromQuery } from '../contracts/design-command-key.js';
import { prepareDesignLibraryPreset } from '../contracts/operations.js';
import { createChatDesignTools } from './chat-design-tools.js';
import { DesignTasks } from './design-tasks.js';
import { DesignDocumentService } from './design-document-service.js';
import { DesignFontStore } from './design-font-store.js';
import { parseDesignScriptOutput } from './design-script-output.js';
import { readScriptParameters } from './design-script-parameters.js';

const dependencies = defineRuntimeDependencies({
  turns: requiredCapability(designTurnHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  files: requiredCapability(designWorkspaceFilesCapability),
  fontStorage: requiredCapability(designFontStorageCapability),
  scripts: requiredCapability(designScriptSandboxCapability),
});

export const designRuntimeFeature = defineRuntimeFeature({
  definition: designFeature,
  dependencies,
  provides: [declareCapabilityProvider(designToolsCapability)],
  setup({ dependencies: { routes, files, fontStorage, scripts, turns }, scope, provide }) {
    const documents = new DesignDocumentService(files);
    const tasks = new DesignTasks(turns, documents);
    provide(declareCapabilityProvider(designToolsCapability), { editor: tasks, chat: createChatDesignTools(files, documents, tasks) });
    scope.add(() => tasks.dispose());
    routes.register(scope, listDesignConversations, (owner) => turns.list(owner));
    // Keep file identity and chat creation under the same workspace lock as a rename or transfer.
    routes.register(scope, createDesignConversation, (owner, { signal }) =>
      documents.withSnapshot(owner.ref, signal, ({ document }) => {
        if (document.documentId !== owner.documentId) throw new Error('Design document changed.');
        return turns.create(owner);
      }));
    routes.register(scope, startDesignTask, (input, { signal }) => tasks.start(input, signal));
    routes.register(scope, replyDesignTask, (input, { signal }) => tasks.reply(input, signal));
    routes.register(scope, watchDesignCommand, (input, { signal }) => tasks.watchCommand(input, signal));
    routes.register(scope, bindDesignInput, (input) => tasks.bindInput(input));
    routes.register(scope, stopDesignTask, ({ sessionId }) => tasks.stop(sessionId));
    const fonts = new DesignFontStore(fontStorage.dataDir);
    routes.register(scope, listDesignFonts, (_, { signal }) => fonts.list(signal));
    routes.register(scope, importDesignFont, ({ base64 }, { signal }) => fonts.import(base64, signal));
    routes.register(scope, readDesignFont, ({ id }, { signal }) => fonts.read(id, signal));
    routes.register(scope, removeDesignFont, (input, { signal }) => fonts.remove(input.id, tasks.fileOperationSignal(designCommandFromQuery(input), signal)));
    routes.register(scope, importDesignImage, ({ ref, name, base64 }, { signal }) => {
      const bytes = Buffer.from(base64, 'base64');
      const mimeType = detectWorkspacePreviewImageMimeType(bytes);
      if (!mimeType || bytes.byteLength > MAX_WORKSPACE_IMAGE_BYTES || bytes.toString('base64') !== base64) {
        throw new FeatureOperationFailure({ code: 'INVALID_INPUT', message: 'The design image is invalid or too large.', retryable: false });
      }
      return files.importImage(ref, { name, extension: designImageExtensions[mimeType], bytes }, signal);
    });
    routes.register(scope, importDesignScript, ({ ref, name, source }, { signal }) => files.importSource(ref, { name, source, extension: 'js' }, signal));
    routes.register(scope, importDesignShader, ({ ref, name, source }, { signal }) => files.importSource(ref, { name, source, extension: 'glsl' }, signal));
    routes.register(scope, readDesignShader, async ({ shaderPath, ...ref }, { signal }) => {
      try {
        return parseDesignShaderSource(await files.readSource(ref, shaderPath, maxDesignShaderBytes, signal));
      } catch {
        signal.throwIfAborted();
        throw new FeatureOperationFailure({ code: 'DESIGN_SHADER_FAILED', message: 'The GLSL file could not be loaded.', retryable: false });
      }
    });
    async function withScript<T>(ref: DesignDocumentRef, path: string, signal: AbortSignal,
      use: (source: string, parameters: readonly DesignScriptParameter[]) => T | Promise<T>): Promise<T> {
      try {
        const source = await files.readSource(ref, path, maxDesignScriptBytes, signal);
        return await use(source, readScriptParameters(source));
      } catch {
        signal.throwIfAborted();
        throw new FeatureOperationFailure({ code: 'DESIGN_SCRIPT_FAILED', message: 'The canvas script could not be loaded or rendered.', retryable: false });
      }
    }
    routes.register(scope, readDesignScriptParameters, ({ scriptPath, ...ref }, { signal }) =>
      withScript(ref, scriptPath, signal, (_, parameters) => parameters));
    routes.register(scope, renderDesignScript, ({ ref, scriptPath, width, height, inputs }, { signal }) =>
      withScript(ref, scriptPath, signal, async (source, parameters) => {
        const input = Object.fromEntries(parameters.map((parameter) => [parameter.name, designScriptParameterValue(parameter, inputs)]));
        return parseDesignScriptOutput(await scripts.evaluate(source, { width, height, input }, signal));
      }));
    routes.register(scope, listProjectDesigns, ({ projectId }, { signal }) => files.projectDesigns(projectId, signal));
    routes.register(scope, getDesignCatalog, (_, { signal }) => files.catalog(signal));
    routes.register(scope, setDesignProject, async ({ ref, documentId, projectId }, { signal }) => {
      await files.setProject(ref, documentId, projectId, signal);
      return null;
    });
    routes.register(scope, readDesignImage, ({ ref, path }, { signal }) => files.readImage(ref, path, signal));
    routes.register(scope, searchDesignImages, ({ ref, query }, { signal }) => files.searchImages(ref, query, signal));
    routes.register(scope, listDesignDocuments, (workspace, { signal }) => files.list(workspace, signal));
    routes.register(scope, listDesignDocumentEntries, (workspace, { signal }) => files.listEntries(workspace, signal));
    routes.register(scope, createDesignDocument, (input, { signal }) => documents.create(input, tasks.fileOperationSignal(input.command, signal)));
    routes.register(scope, prepareDesignLibraryPreset, async ({ ref, presetId }, { signal }) =>
      documents.prepareLibraryPreset(await files.resolveResourceRoot(ref, signal), presetId, signal));
    routes.register(scope, moveDesignDocument, (input, { signal }) => files.move(input, tasks.fileOperationSignal(input.command, signal)));
    routes.register(scope, deleteDesignDocument, async (ref, { signal }) => {
      await files.delete(ref, tasks.fileOperationSignal(designCommandFromQuery(ref), signal));
      return null;
    });
    routes.register(scope, readDesignDocument, (input, { signal }) => documents.read(input, signal));
    routes.register(scope, resolveDesignDocumentRoot, (ref, { signal }) => files.resolveResourceRoot(ref, signal));
    routes.register(scope, commitDesignEdits, (input, { signal }) => documents.commit(input, signal));
    routes.register(scope, navigateDesignHistory, (input, { signal }) => documents.navigate(input, signal));
  },
});
