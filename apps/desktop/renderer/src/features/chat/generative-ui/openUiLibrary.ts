import type { Library } from '@openuidev/react-lang';
// Use the same bundle as ThemeProvider: the genui-lib subpath has its own theme
// context, so its body portals otherwise lose the host theme and font tokens.
import { openuiLibrary } from '@openuidev/react-ui';
import { withOpenUiComponentBoundary } from './OpenUiComponentBoundary.js';
import { withWorkspaceImages } from './OpenUiImages.js';
import { withScopedOpenUiControls } from './OpenUiControls.js';
import { withResponsiveOpenUiStack } from './OpenUiStack.js';

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
          withScopedOpenUiControls(definition.name,
            withResponsiveOpenUiStack(definition.name, definition.component)))),
      })),
  },
});
