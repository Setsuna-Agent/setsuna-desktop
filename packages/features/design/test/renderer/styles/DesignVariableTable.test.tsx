// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UiProvider } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { applyDesignEdits } from '../../../src/contracts/apply-design-edits.js';
import { designDocumentCodec, designDocumentVersion } from '../../../src/contracts/index.js';
import { emptyDesignLibraryResources } from '../../../src/renderer/components/design-library-resources.js';
import { DesignStyleContext } from '../../../src/renderer/styles/DesignStyleSelect.js';
import { DesignVariableTable } from '../../../src/renderer/styles/DesignVariableTable.js';

afterEach(cleanup);

it('edits a mode cell without overwriting the base color or another mode', async () => {
  const initial = designDocumentCodec.parse({ schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: [], nodes: {},
    variableCollections: { default: { defaultModeName: 'Light', modes: { dark: 'Dark', dim: 'Dim' } } },
    styles: { surface: { name: 'Surface', kind: 'color', color: '#fafafa', modeValues: { dark: '#262626', dim: '#454545' } } },
  });
  let saved = initial;
  function Matrix() {
    const [document, setDocument] = useState(initial);
    return <DesignStyleContext.Provider value={{ styles: document.styles }}>
      <DesignVariableTable document={document} resources={emptyDesignLibraryResources} disabled={false}
        selectedCollection="draft" onSelectCollection={() => {}} onPreviewStyle={() => {}}
        translate={(key) => key} onCommit={async (edits) => {
          saved = applyDesignEdits(document, edits);
          setDocument(saved);
          return true;
        }} />
    </DesignStyleContext.Provider>;
  }
  render(<UiProvider locale="en-US"><Matrix /></UiProvider>);
  const opacity = screen.getByRole('spinbutton', { name: 'feature.design.opacity · Surface · Dark' });
  opacity.focus();
  fireEvent.change(opacity, { target: { value: '60' } });
  fireEvent.keyDown(opacity, { key: 'Enter' });
  await waitFor(() => expect(saved.styles?.surface).toMatchObject({
    color: '#fafafa', modeValues: { dark: '#26262699', dim: '#454545' },
  }));
});
