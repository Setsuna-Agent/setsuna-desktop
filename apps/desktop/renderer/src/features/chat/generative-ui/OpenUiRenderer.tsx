import { Renderer, type OpenUIError, type ParseResult } from '@openuidev/react-lang';
import { ThemeProvider } from '@openuidev/react-ui';
import { openUiTheme } from '@setsuna-desktop/renderer-ui/openui-theme';
import { useCallback, useId, useMemo, useState } from 'react';
import { useResolvedThemeMode } from '../../../shared/preferences/useThemeTransition.js';
import { MarkdownCodeBlock } from '../markdown/MarkdownCodeBlock.js';
import type { OpenUiBlockProps } from './OpenUiBlock.js';
import { presentationLibrary } from './openUiLibrary.js';
import { OpenUiFailureContext } from './OpenUiComponentBoundary.js';
import { OpenUiControlScope } from './OpenUiControls.js';
import '@openuidev/react-ui/components.css';
import './openui.css';

const maxOpenUiCharacters = 100_000;

export default function OpenUiRenderer({ code, streaming }: OpenUiBlockProps) {
  const mode = useResolvedThemeMode();
  const scope = `openui-${useId().replace(/:/g, '')}`;
  const [invalidSource, setInvalidSource] = useState<string | null>(null);
  const failureContext = useMemo(() => ({ source: code, onRenderError: setInvalidSource }), [code]);
  const onParseResult = useCallback((result: ParseResult | null) => {
    if (!result) return;
    const invalid = (!result.root && !result.rootExpression)
      || result.meta.incomplete || result.meta.unresolved.length > 0
      || result.meta.errors.some((error) => error.severity !== 'warning')
      || result.queryStatements.length > 0 || result.mutationStatements.length > 0;
    // Parsing and rendering report independently. A successful parse must not
    // erase a render failure for the same source; a source change retries it.
    if (invalid) setInvalidSource(code);
  }, [code]);
  const onError = useCallback((errors: OpenUIError[]) => {
    if (errors.some((error) => error.severity !== 'warning')) setInvalidSource(code);
  }, [code]);

  if (code.length > maxOpenUiCharacters || (!streaming && invalidSource === code)) {
    return <MarkdownCodeBlock code={code} language="openui" />;
  }

  return (
    <div className="chat-openui" id={scope} aria-busy={streaming} onSubmit={(event) => event.preventDefault()}>
      <ThemeProvider mode={mode} lightTheme={openUiTheme} cssSelector={`#${scope}`}>
        {/* No toolProvider/onAction: the DSL has no route to Agent tools or host mutations. */}
        <OpenUiFailureContext.Provider value={failureContext}>
          <OpenUiControlScope.Provider value={scope}>
            <Renderer
              response={code}
              library={presentationLibrary}
              isStreaming={streaming}
              onParseResult={onParseResult}
              onError={onError}
              publishObservability={false}
            />
          </OpenUiControlScope.Provider>
        </OpenUiFailureContext.Provider>
      </ThemeProvider>
    </div>
  );
}
