import { maxDesignPreviewPasswordLength } from '../../contracts/design-publication.js';
import { designViewerIcon as viewerIcon, designViewerZoomJs, designViewerZoomMarkup, designViewerZoomPresets } from '../../contracts/design-viewer-zoom.js';
import { designPreviewAccessHeader, designPreviewUnlockPath } from './design-preview-auth.js';
import { designViewerArtboardsJs } from './design-preview-viewer-artboards.js';
import { designViewerCanvasJs } from './design-preview-viewer-canvas.js';
import { designViewerPanelsJs } from './design-preview-viewer-panels.js';
import { designViewerVariablesJs } from './design-preview-viewer-variables.js';

export type DesignViewerTheme = 'light' | 'dark';

export function designViewerHtml(theme: DesignViewerTheme) {
  const layersIcon = viewerIcon('M4 4h16v16H4zM9 4v16');
  const propertiesIcon = viewerIcon('M4 4h16v16H4zM15 4v16');
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Setsuna Design</title>
    <link rel="stylesheet" href="/viewer.css">
    <script src="/viewer.js" defer></script>
  </head>
  <body>
    <div id="viewer" class="preview-viewer" hidden>
      <aside id="layers-panel" class="preview-panel preview-layers" aria-labelledby="layers-title" hidden>
        <header class="preview-panel-header">
          <h2 id="layers-title"></h2>
          <button id="collapse-layers" type="button" class="preview-panel-toggle"
            aria-controls="layers-panel" aria-expanded="true">${layersIcon}</button>
        </header>
        <ul id="layer-tree"></ul>
      </aside>
      <div class="preview-viewport">
        <main id="stage" tabindex="0" data-tool="select">
          <div id="fit-area" aria-hidden="true"></div>
          <div id="artwork" hidden>
            <svg id="selection-outline" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" hidden>
              <path vector-effect="non-scaling-stroke"></path>
            </svg>
          </div>
        </main>
        <header class="preview-top">
          <button id="toggle-layers" type="button" class="preview-corner preview-panel-toggle"
            aria-controls="layers-panel" aria-expanded="false">${layersIcon}</button>
          <div class="preview-corner preview-tools">
            <button id="select-tool" type="button" aria-pressed="true" aria-keyshortcuts="V">
              ${viewerIcon('M4 4l7 17 2-8 8-2L4 4Z')}
            </button>
            <button id="hand-tool" type="button" aria-pressed="false" aria-keyshortcuts="H">
              ${viewerIcon('M18 11V7a2 2 0 0 0-4 0m0 3V5a2 2 0 0 0-4 0v5-3a2 2 0 0 0-4 0v7l-1-1a2 2 0 0 0-3 3l4 4a4 4 0 0 0 3 1h5a6 6 0 0 0 6-6v-3a2 2 0 0 0-4 0')}
            </button>
            <button id="toggle-variables" type="button" aria-haspopup="dialog" aria-controls="variables-window" aria-expanded="false" hidden>
              ${viewerIcon('M8 21s-4-3-4-9 4-9 4-9M16 3s4 3 4 9-4 9-4 9M15 9l-6 6M9 9l6 6', 17, 1.8)}
            </button>
          </div>
          <button id="toggle-properties" type="button" class="preview-corner preview-panel-toggle"
            aria-controls="properties-panel" aria-expanded="false">${propertiesIcon}</button>
          <div id="variables-window" class="preview-variable-window" role="dialog" hidden>
            <header class="preview-variable-window-header">
              <div id="variable-collections" class="preview-variable-collections" role="group"></div>
              <button id="close-variables" type="button" class="preview-panel-toggle">${viewerIcon('M18 6 6 18M6 6l12 12', 15)}</button>
            </header>
            <div class="preview-variable-scroll" tabindex="0">
              <table id="variable-table" class="preview-variable-table">
                <thead><tr></tr></thead>
                <tbody></tbody>
              </table>
            </div>
          </div>
        </header>
        ${designViewerZoomMarkup}
      </div>
      <aside id="properties-panel" class="preview-panel preview-properties" aria-labelledby="properties-title" hidden>
        <header class="preview-panel-header">
          <h2 id="properties-title"></h2>
          <button id="collapse-properties" type="button" class="preview-panel-toggle"
            aria-controls="properties-panel" aria-expanded="true">${propertiesIcon}</button>
        </header>
        <div id="layer-properties">
          <h3 id="preview-selected-layer" class="preview-selected-layer" hidden></h3>
          <section id="preview-board-modes" aria-labelledby="preview-board-modes-title" hidden>
            <h3 id="preview-board-modes-title"></h3>
            <div id="preview-board-mode-fields"></div>
          </section>
          <div id="preview-property-fields"></div>
        </div>
      </aside>
    </div>
    <form id="unlock" method="post" aria-labelledby="password-label" hidden>
      <label for="password" id="password-label"></label>
      <div class="preview-unlock-field">
        <input type="password" id="password" autocomplete="current-password" maxlength="${maxDesignPreviewPasswordLength}" required>
        <button type="submit" id="unlock-button"></button>
      </div>
      <output id="unlock-error" role="status" hidden></output>
    </form>
    <output id="error" role="status" hidden></output>
  </body>
</html>`;
}

export const designViewerJs = `${designViewerArtboardsJs}
${designViewerCanvasJs}
${designViewerPanelsJs}
${designViewerVariablesJs}
${designViewerZoomJs}
const viewer = document.getElementById('viewer');
const stage = document.getElementById('stage');
const error = document.getElementById('error');
const unlock = document.getElementById('unlock');
const password = document.getElementById('password');
const unlockButton = document.getElementById('unlock-button');
const unlockError = document.getElementById('unlock-error');
const zh = navigator.language.toLowerCase().startsWith('zh');
document.documentElement.lang = zh ? 'zh-CN' : 'en';
for (const [element, zhLabel, enLabel] of [
  [stage, '画板预览', 'Artboard preview'],
  [document.getElementById('select-tool'), '选择 (V)', 'Select (V)'], [document.getElementById('hand-tool'), '抓手 (H)', 'Hand (H)'],
]) {
  element.setAttribute('aria-label', zh ? zhLabel : enLabel);
  if (element.tagName === 'BUTTON') element.title = zh ? zhLabel : enLabel;
}
document.getElementById('password-label').textContent = zh ? '访问密码' : 'Access password';
unlockButton.textContent = zh ? '解锁' : 'Unlock';
let permission = 'Bearer ' + window.location.hash.slice(1);
const canvas = createPreviewCanvas(stage, (board, point) => panels.pick(board, point), (state) => zoom.update(state));
const panels = createPreviewPanels(zh, (board, layer) => {
  canvas.showOutline(board, layer?.outline ?? [], layer?.outlinePath);
  boardModes.select(layer?.kind === 'artboard' ? board : undefined);
});
const zoom = createPreviewZoomControls({
  zoom: zh ? '缩放' : 'Zoom', in: zh ? '放大' : 'Zoom in', out: zh ? '缩小' : 'Zoom out',
  fit: zh ? '适应画布' : 'Fit canvas', selection: zh ? '缩放到选区' : 'Fit selection',
  presets: ${JSON.stringify(designViewerZoomPresets)}.map((percent) => [percent, (zh ? '缩放到 ' : 'Zoom to ') + percent + '%']),
}, canvas);
const variableTable = createPreviewVariableTable(zh, () => panelToggles.dismissOverlay());
const panelToggles = createPreviewPanelToggles(zh, () => variableTable.dismiss(false));
const boardModes = createPreviewBoardModes(zh, applyPreviewVariant, unavailable);

function fetchPreview(path, options = {}) {
  return fetch(path, { ...options, headers: { ...options.headers, Authorization: permission },
    cache: 'no-store', mode: 'same-origin', credentials: 'omit', redirect: 'error' });
}

function unavailable() {
  error.textContent = zh ? '预览不可用' : 'Preview unavailable';
  error.hidden = false;
}

async function applyPreviewVariant(index, base, slot) {
  let frame = base;
  const path = '/api/boards/' + index + (slot === undefined ? '' : '/' + slot);
  if (slot !== undefined) {
    const response = await fetchPreview(path + '.json');
    if (!response.ok) throw new Error('Preview unavailable');
    frame = await response.json();
  }
  const image = await readPreviewArtboardImage(fetchPreview, path + '.png');
  canvas.replaceBoard(index, frame, image);
  panels.replaceBoard(index, frame.layers);
  error.hidden = true;
}

document.addEventListener('keydown', (event) => {
  if (viewer.hidden || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey
    || (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]'))) return;
  const key = event.key.toLowerCase();
  if (key === 'v') canvas.setTool('select');
  else if (key === 'h') canvas.setTool('hand');
  else if (key === 'escape') {
    if (!variableTable.dismiss() && !panelToggles.dismissOverlay()) panels.clear();
  } else if (!zoom.shortcut(event)) return;
  event.preventDefault();
});

unlock.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (unlockButton.disabled) return;
  unlockButton.disabled = true;
  unlockError.hidden = true;
  try {
    const response = await fetchPreview('${designPreviewUnlockPath}', { method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: password.value });
    if (response.status === 400 || response.status === 401) {
      unlockError.textContent = zh ? '密码不正确' : 'Incorrect password';
      unlockError.hidden = false;
      password.select();
      return;
    }
    if (response.status === 429) {
      unlockError.textContent = zh ? '尝试次数过多，请稍后重试' : 'Too many attempts. Try again shortly.';
      unlockError.hidden = false;
      return;
    }
    if (!response.ok) throw new Error('Preview unavailable');
    const { token } = await response.json();
    if (typeof token !== 'string') throw new Error('Preview unavailable');
    permission = 'Bearer ' + token;
    password.value = '';
    unlock.hidden = true;
    await initialize();
  } catch {
    unlockError.textContent = zh ? '预览不可用' : 'Preview unavailable';
    unlockError.hidden = false;
  } finally {
    unlockButton.disabled = false;
  }
});

async function initialize() {
  try {
    const response = await fetchPreview('/api/boards');
    if (response.status === 401 && response.headers.get('${designPreviewAccessHeader}') === 'password') {
      unlock.hidden = false;
      password.focus();
      return;
    }
    if (!response.ok) throw new Error('Preview unavailable');
    const { boards, start, variables: catalog } = await response.json();
    viewer.hidden = false;
    const artboards = canvas.setBoards(boards);
    panels.load(boards, start);
    variableTable.load(catalog);
    boardModes.load(boards, catalog);
    stage.focus({ preventScroll: true });
    if (!await loadPreviewArtboardImages(artboards, fetchPreview)) unavailable();
  } catch {
    unavailable();
  }
}
void initialize();
`;
