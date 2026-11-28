import { designViewerZoomStyles } from '../../contracts/design-viewer-zoom.js';

export const designViewerNarrowLayout = '(max-width: 760px)';

// The standalone page mirrors the Design canvas and panels without loading renderer assets.
export const designViewerCss = `
:root {
  color-scheme: light;
  --preview-stage: #e9e7e3;
  --preview-stage-light: #f3f1ed;
  --preview-grid-ink: rgb(68 58 79 / 17%);
  --preview-surface: #fff;
  --preview-overlay: #fff;
  --preview-text: #242424;
  --preview-muted: #666;
  --preview-primary: #1b1b1b;
  --preview-primary-hover: #303030;
  --preview-primary-text: #fff;
  --preview-danger: #dc2626;
  --preview-border: color-mix(in srgb, var(--preview-text) 12%, transparent);
  --preview-hover: color-mix(in srgb, var(--preview-text) 6%, transparent);
  --preview-focus: color-mix(in srgb, var(--preview-text) 50%, var(--preview-surface));
  --preview-selection: #3d99ff;
  --preview-selection-bg: color-mix(in srgb, var(--preview-selection) 15%, transparent);
  --preview-shadow: 0 2px 5px #30253c0b, 0 10px 28px #30253c13;
  --preview-edge: 14px;
  --preview-control: 28px;
  --preview-pill: 9999px;
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI',
    'Microsoft YaHei UI', system-ui, sans-serif;
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --preview-stage: #212125;
  --preview-stage-light: #2c2b32;
  --preview-grid-ink: rgb(221 210 242 / 16%);
  --preview-surface: #262626;
  --preview-overlay: #1b1b1b;
  --preview-text: #fff;
  --preview-muted: #9e9e9e;
  --preview-primary: #f1f1f1;
  --preview-primary-hover: #fff;
  --preview-primary-text: #111;
  --preview-danger: #f87171;
  --preview-shadow: 0 2px 5px #0003, 0 10px 28px #0004;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }

body {
  position: relative;
  display: grid;
  place-items: center;
  height: 100vh;
  height: 100dvh;
  margin: 0;
  overflow: hidden;
  color: var(--preview-text);
  background-color: var(--preview-stage);
  background-image:
    radial-gradient(circle, var(--preview-grid-ink) 0.8px, transparent 1px),
    radial-gradient(ellipse at 48% 12%, var(--preview-stage-light), transparent 72%);
  background-size: 24px 24px, 100% 100%;
}

button, select, input { font: inherit; color: inherit; }

.preview-viewer {
  position: absolute;
  inset: 0;
  display: flex;
  gap: 8px;
  padding: var(--preview-edge);
  isolation: isolate;
}

.preview-viewport { position: relative; flex: 1; min-width: 0; min-height: 0; }

#stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
}

#stage[data-tool='hand'] { cursor: grab; }
#stage[data-dragging='true'] { cursor: grabbing; }
#stage:focus { outline: none; }

#fit-area {
  position: absolute;
  inset: min(calc(var(--preview-edge) + var(--preview-control) + 14px), 22vh) clamp(var(--preview-edge), 3vw, 48px);
  pointer-events: none;
}

#artwork {
  position: absolute;
  inset: 0 auto auto 0;
  transform-origin: 0 0;
  user-select: none;
  pointer-events: none;
}

.preview-artboard {
  position: absolute;
  inset: 0 auto auto 0;
  transform-origin: 0 0;
  box-shadow: var(--preview-shadow);
}

.preview-artboard img, #selection-outline { display: block; width: 100%; height: 100%; }

.preview-artboard-title {
  position: absolute;
  max-inline-size: clamp(80px, calc(var(--preview-board-width) * var(--preview-view-scale, 1)), 240px);
  padding: 2px 6px;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  background: var(--preview-surface);
  color: var(--preview-muted);
  font-size: 11px;
  text-align: start;
  white-space: nowrap;
  text-overflow: ellipsis;
  transform-origin: 0 100%;
  transform: translateY(calc(-100% - 4px * var(--preview-view-inverse, 1))) scale(var(--preview-view-inverse, 1));
}

#stage[data-tool='select'] .preview-artboard-title { pointer-events: auto; cursor: pointer; }

#selection-outline {
  position: absolute;
  inset: 0;
  stroke: var(--preview-selection);
  stroke-width: 1.5px;
  fill: none;
}

.preview-top {
  position: absolute;
  z-index: 1;
  inset: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}

.preview-top > * { pointer-events: auto; }
.preview-top:has(.preview-variable-window:not([hidden])) { z-index: 2; }

.preview-corner {
  border: 1px solid var(--preview-border);
  border-radius: var(--preview-pill);
  background: var(--preview-surface);
  box-shadow: 0 1px 2px #0001;
}

.preview-tools {
  display: flex;
  gap: 2px;
  padding: 2px 4px;
}

.preview-tools > button, .preview-panel-toggle {
  display: grid;
  flex: none;
  place-items: center;
  inline-size: var(--preview-control);
  block-size: var(--preview-control);
  padding: 0;
  border: 0;
  border-radius: var(--preview-pill);
  background: transparent;
  color: var(--preview-muted);
  cursor: pointer;
}

.preview-corner button:not(:disabled):hover, .preview-panel-toggle:hover {
  background: var(--preview-hover);
  color: var(--preview-text);
}

.preview-corner button:disabled { opacity: .45; cursor: default; }

${designViewerZoomStyles}

.preview-tools button:is([aria-pressed='true'], [aria-expanded='true']), .preview-top > .preview-panel-toggle[aria-expanded='true'] {
  background: var(--preview-selection-bg);
  color: var(--preview-text);
}

:where(.preview-top) > .preview-panel-toggle {
  border: 1px solid var(--preview-border);
  background: var(--preview-surface);
}

#toggle-properties { margin-inline-start: auto; }

.preview-variable-window {
  position: absolute;
  inset-block-start: calc(100% + 8px);
  inset-inline-start: 0;
  display: flex;
  flex-direction: column;
  inline-size: min(576px, 100%);
  max-block-size: min(410px, calc(100dvh - 2 * var(--preview-edge) - var(--preview-control) - 14px));
  overflow: hidden;
  border: 1px solid var(--preview-border);
  border-radius: 16px;
  background: var(--preview-overlay);
  box-shadow: var(--preview-shadow);
  font-size: 12px;
}

.preview-variable-window-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 8px 12px;
}

#close-variables { inline-size: 24px; block-size: 24px; border-radius: 6px; }

.preview-variable-collections {
  display: flex;
  min-inline-size: 0;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.preview-variable-collections > button {
  flex: none;
  max-inline-size: 168px;
  min-block-size: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--preview-muted);
  cursor: pointer;
}

.preview-variable-collections > button:hover { background: var(--preview-hover); }
.preview-variable-collections > button[aria-pressed='true'] {
  background: var(--preview-selection-bg);
  color: var(--preview-text);
  font-weight: 600;
}

.preview-variable-collections > button:focus-visible { outline-offset: -2px; }
.preview-variable-collections > button > span, .preview-variable-table th[scope='row'] > span > span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-variable-scroll { min-block-size: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.preview-variable-scroll:focus-visible { outline: 2px solid var(--preview-focus); outline-offset: -2px; }

.preview-variable-table {
  --preview-variable-name-width: 160px;
  inline-size: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-variant-numeric: tabular-nums;
}

.preview-variable-table :is(th, td) {
  min-inline-size: 184px;
  padding: 6px 12px;
  text-align: start;
  overflow-wrap: anywhere;
}

.preview-variable-table thead th {
  position: sticky;
  z-index: 2;
  inset-block-start: 0;
  background: color-mix(in srgb, var(--preview-text) 5%, var(--preview-overlay));
  color: var(--preview-muted);
  font-weight: 600;
}

.preview-variable-table th:first-child {
  position: sticky;
  inset-inline-start: 0;
  min-inline-size: var(--preview-variable-name-width);
  max-inline-size: var(--preview-variable-name-width);
}

.preview-variable-table thead th:first-child { z-index: 3; }
.preview-variable-table th[scope='row'] { z-index: 1; font-weight: inherit; }
.preview-variable-table tbody :is(th, td) { background: var(--preview-overlay); }
.preview-variable-table tbody tr:hover > * { background: color-mix(in srgb, var(--preview-text) 4%, var(--preview-overlay)); }
.preview-variable-table th[scope='row'] > span { display: flex; align-items: center; gap: 6px; }
.preview-variable-table td > span { white-space: pre-wrap; }
.preview-variable-table td > input { margin: 0; vertical-align: middle; }

.preview-variable-table th svg, .preview-variable-mode > svg {
  flex: none;
  inline-size: 13px;
  block-size: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: var(--preview-muted);
}

.preview-panel {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  min-inline-size: 0;
  min-block-size: 0;
  border: 1px solid var(--preview-border);
  border-radius: 16px;
  background: var(--preview-surface);
  box-shadow: var(--preview-shadow);
  font-size: 12px;
}

.preview-layers { flex-basis: clamp(154px, 17vw, 228px); }
.preview-properties { flex-basis: clamp(170px, 20vw, 260px); }

.preview-panel-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-block-size: 36px;
  padding: 4px 8px 4px 12px;
}

.preview-panel-header h2 {
  min-inline-size: 0;
  margin: 0;
  font-size: inherit;
  font-weight: 600;
}

.preview-panel-header > .preview-panel-toggle {
  inline-size: 24px;
  block-size: 24px;
  border-radius: 8px;
}

#layer-tree, #layer-properties {
  flex: 1;
  min-block-size: 0;
  margin: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

#layer-tree { padding: 0 7px 8px; }
#layer-tree, #layer-tree ul { list-style: none; }
#layer-tree ul { margin: 0; padding: 0 0 0 10px; }

.preview-layer-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  min-block-size: 26px;
  border-radius: 8px;
}

.preview-layer-row:hover { background: var(--preview-hover); }
.preview-layer-row:has(> [aria-pressed='true']) { background: var(--preview-selection-bg); }

.preview-layer-row button {
  display: flex;
  align-items: center;
  min-inline-size: 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: pointer;
}

.preview-layer-row svg {
  flex: none;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: var(--preview-muted);
}

.preview-layer-toggle { justify-content: center; padding: 0; }
.preview-layer-toggle[aria-expanded='true'] svg { transform: rotate(90deg); }

.preview-layer-select { grid-column: 2; gap: 6px; padding: 0 6px 0 2px; text-align: start; }
.preview-layer-select span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

.preview-properties :is(section, .preview-selected-layer) { padding: 10px 12px; }
.preview-properties section { border-top: 1px solid var(--preview-border); }
.preview-properties h3 { margin: 0; font-size: inherit; font-weight: 600; overflow-wrap: anywhere; }
.preview-properties .preview-selected-layer { padding-top: 0; }
.preview-properties dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 12px;
  align-items: baseline;
  margin: 8px 0 0;
}

.preview-properties dt { color: var(--preview-muted); }
.preview-properties dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.preview-paint { display: flex; align-items: center; gap: 6px; }
.preview-paint-swatch {
  flex: none;
  width: 13px;
  height: 13px;
  border: 1px solid var(--preview-border);
  border-radius: 3px;
}

#preview-board-modes, #preview-board-mode-fields { display: grid; gap: 6px; }

.preview-variable-mode {
  position: relative;
  min-inline-size: 0;
}

.preview-variable-mode select {
  appearance: none;
  inline-size: 100%;
  min-block-size: 26px;
  padding-inline: 8px 26px;
  border: 1px solid var(--preview-border);
  border-radius: 6px;
  background: transparent;
  text-overflow: ellipsis;
}

.preview-variable-mode select:hover:not(:disabled) { background: var(--preview-hover); cursor: pointer; }
.preview-variable-mode select:disabled { opacity: .55; }
.preview-variable-mode > svg {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-end: 8px;
  transform: translateY(-50%);
  pointer-events: none;
}

:is(button, select):focus-visible {
  outline: 2px solid var(--preview-focus);
  outline-offset: 1px;
}

#unlock, #error {
  z-index: 2;
  border: 1px solid var(--preview-border);
  background: var(--preview-overlay);
  box-shadow: var(--preview-shadow);
}

#unlock {
  display: grid;
  gap: 12px;
  inline-size: min(360px, calc(100% - 2 * var(--preview-edge)));
  padding: 20px;
  border-radius: 16px;
}

#password-label {
  font-size: 16px;
  font-weight: 600;
}

.preview-unlock-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

#password, #unlock-button {
  min-block-size: 34px;
  border-radius: 8px;
}

#password {
  min-inline-size: 0;
  padding-inline: 10px;
  border: 1px solid var(--preview-border);
  background: var(--preview-hover);
}

#password:focus {
  border-color: var(--preview-focus);
  outline: none;
}

#unlock-button {
  padding-inline: 12px;
  border: 0;
  background: var(--preview-primary);
  color: var(--preview-primary-text);
  font-weight: 600;
  cursor: pointer;
}

#unlock-button:hover:not(:disabled) { background: var(--preview-primary-hover); }
#unlock-button:disabled { opacity: .55; cursor: default; }
#unlock-error { color: var(--preview-danger); font-size: 12px; }
#error { padding: 8px 12px; border-radius: 8px; }

@media ${designViewerNarrowLayout} {
  .preview-panel-header > .preview-panel-toggle { display: none; }
  .preview-variable-table { --preview-variable-name-width: 128px; }
  .preview-panel {
    position: absolute;
    z-index: 2;
    inset-block: calc(var(--preview-edge) + var(--preview-control) + 14px) var(--preview-edge);
    inline-size: min(260px, calc(100% - 2 * var(--preview-edge)));
  }

  .preview-layers { inset-inline-start: var(--preview-edge); }
  .preview-properties { inset-inline-end: var(--preview-edge); }
}

@media (pointer: coarse) {
  :root { --preview-control: 38px; }
  #password { font-size: 16px; }
}
`;
