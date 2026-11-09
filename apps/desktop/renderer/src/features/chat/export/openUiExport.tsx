import { createParser, Renderer, type OpenUIError, type ParseResult } from '@openuidev/react-lang';
import { ThemeProvider } from '@openuidev/react-ui';
import { openUiTheme } from '@setsuna-desktop/renderer-ui/openui-theme';
import { Component, useId, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { defaultUrlTransform } from 'react-markdown';
import { OpenUiFailureContext } from '../generative-ui/OpenUiComponentBoundary.js';
import { OpenUiControlScope } from '../generative-ui/OpenUiControls.js';
import { isCompleteOpenUiPresentation, maxOpenUiCharacters } from '../generative-ui/openUiValidation.js';
import { openUiExportLibrary } from './openUiExportLibrary.js';
import { namespaceMarkdownReferences } from './conversationExportAnchors.js';
import componentStyles from '@openuidev/react-ui/components.css?inline';
import hostStyles from '../generative-ui/openui.css?inline';

const parser = createParser(openUiExportLibrary.toJSONSchema(), openUiExportLibrary.root);
const styles = `${componentStyles}\n${hostStyles}`;
const appThemeVariables = new Set(Object.values(openUiTheme).flatMap((value) =>
  [...value.matchAll(/var\((--app-[\w-]+)/gu)].map((match) => match[1])));

/** Render in the host, then keep only the standalone DOM and its scoped theme tokens. */
export async function renderOpenUiExport(code: string, mode: 'light' | 'dark'): Promise<{ element: HTMLElement; styles: string } | null> {
  if (code.length > maxOpenUiCharacters) return null;
  try {
    if (!isCompleteOpenUiPresentation(parser.parse(code))) return null;
  } catch {
    return null;
  }
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = 'position:fixed;left:-100000px;top:0;width:768px;visibility:hidden;pointer-events:none';
  // Sidebar exports may run before any live OpenUI block has loaded its CSS.
  const sheet = document.createElement('style');
  sheet.textContent = styles;
  const mount = document.createElement('div');
  container.append(sheet, mount);
  document.body.appendChild(container);
  const root = createRoot(mount);
  let finish!: () => void;
  let failed = false;
  const ready = new Promise<void>((resolve) => { finish = resolve; });
  const onFailure = () => { failed = true; finish(); };
  const view = () => <ExportBoundary onFailure={onFailure}>
    <ExportView code={code} mode={mode} onReady={finish} onFailure={onFailure} />
  </ExportBoundary>;
  try {
    flushSync(() => root.render(view()));
    await ready;
    if (failed) return null;
    // The parser's state defaults commit first; charts then need the browser's layout pass.
    await new Promise<void>((resolve) => requestAnimationFrame(() => {
      flushSync(() => root.render(view()));
      resolve();
    }));
    if (failed) return null;
    const rendered = container.querySelector<HTMLElement>('.conversation-openui');
    if (!rendered) return null;
    const element = rendered.cloneNode(true) as HTMLElement;
    const computed = getComputedStyle(rendered);
    for (const name of Array.from(computed)) {
      if (name.startsWith('--openui-') || appThemeVariables.has(name)) {
        element.style.setProperty(name, computed.getPropertyValue(name));
      }
    }
    freezeControls(rendered, element);
    sanitizeSnapshot(element);
    // Each TextContent owns a separate Markdown parser and can reuse footnote labels.
    element.querySelectorAll('.openui-markdown-renderer').forEach((markdown, index) => {
      namespaceMarkdownReferences(markdown, `${element.id}-markdown-${index + 1}`);
    });
    return { element, styles };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}

function ExportView({ code, mode, onReady, onFailure }: {
  code: string; mode: 'light' | 'dark'; onReady: () => void; onFailure: () => void;
}) {
  const scope = `export-openui-${useId().replace(/:/gu, '')}`;
  const parsed = (result: ParseResult | null) => {
    if (result && isCompleteOpenUiPresentation(result)) onReady();
    else onFailure();
  };
  const onError = (errors: OpenUIError[]) => {
    if (errors.some((error) => error.severity !== 'warning')) onFailure();
  };
  return <div className="chat-openui conversation-openui" id={scope}>
    <ThemeProvider mode={mode} lightTheme={openUiTheme} cssSelector={`#${scope}`}>
      <OpenUiFailureContext.Provider value={{ source: code, onRenderError: onFailure }}>
        <OpenUiControlScope.Provider value={scope}>
          <Renderer response={code} library={openUiExportLibrary} isStreaming={false}
            onParseResult={parsed} onError={onError} publishObservability={false} />
        </OpenUiControlScope.Provider>
      </OpenUiFailureContext.Provider>
    </ThemeProvider>
  </div>;
}

class ExportBoundary extends Component<{ onFailure: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function freezeControls(source: HTMLElement, target: HTMLElement): void {
  const originals = source.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  target.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((control, index) => {
    const original = originals[index];
    if (control instanceof HTMLInputElement && original instanceof HTMLInputElement) {
      control.setAttribute('value', original.value);
      control.toggleAttribute('checked', original.checked);
    } else control.textContent = original.value;
  });
  target.querySelectorAll('button, input, textarea, select').forEach((control) => control.setAttribute('disabled', ''));
}

function sanitizeSnapshot(element: HTMLElement): void {
  element.querySelectorAll('script, iframe, object, embed, link, meta, style').forEach((node) => node.remove());
  for (const node of element.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction'
        || ((name === 'href' || name === 'src' || name === 'xlink:href') && !defaultUrlTransform(attribute.value))) {
        node.removeAttribute(attribute.name);
      }
    }
  }
}
