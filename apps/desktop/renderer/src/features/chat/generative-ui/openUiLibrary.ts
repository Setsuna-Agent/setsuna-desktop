import type { Library } from '@openuidev/react-lang';
import { openuiLibrary } from '@openuidev/react-ui/genui-lib';
import { withOpenUiComponentBoundary } from './OpenUiComponentBoundary.js';
import { withWorkspaceImages } from './OpenUiImages.js';
import { withScopedOpenUiControls } from './OpenUiControls.js';

// Preserve upstream schemas and local bindings; submission-oriented components
// are deliberately absent from both the renderer and the Agent's catalog.
export const presentationLibrary: Library = openuiLibrary.extend({
  components: {
    remove: ['Form', 'EditableTable'],
    override: Object.values(openuiLibrary.components)
      .filter(({ name }) => name !== 'Form' && name !== 'EditableTable')
      .map((definition) => ({
        ...definition,
        component: withOpenUiComponentBoundary(withWorkspaceImages(definition.name,
          withScopedOpenUiControls(definition.name, definition.component))),
      })),
  },
});
