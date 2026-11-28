// Standalone document resources shared by the HTML export and LAN preview.
export const designViewerZoomPresets = [50, 100, 200] as const;
export type DesignViewerZoomLabels = Readonly<{
  zoom: string;
  out: string;
  in: string;
  fit: string;
  selection?: string;
  presets: readonly (readonly [percent: number, text: string])[];
}>;

export function designViewerIcon(path: string, size = 14, strokeWidth = 2) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}

export const designViewerZoomMarkup = `<div id="zoom-controls" class="preview-zoom" role="group">
  <button id="zoom-out" type="button" disabled>${designViewerIcon('M5 12h14')}</button>
  <button id="zoom-level" type="button" aria-haspopup="menu" aria-controls="zoom-menu" aria-expanded="false" disabled>—</button>
  <button id="zoom-in" type="button" disabled>${designViewerIcon('M5 12h14m-7-7v14')}</button>
  <div id="zoom-menu" class="preview-zoom-menu" role="menu" hidden></div>
</div>`;

export const designViewerZoomStyles = `
.preview-zoom {
  position: absolute;
  z-index: 1;
  inset: auto 0 0 auto;
  display: flex;
  gap: 2px;
  padding: 2px 4px;
  border: 1px solid var(--preview-border);
  border-radius: var(--preview-pill);
  background: var(--preview-surface);
  box-shadow: 0 1px 2px #0001;
}

.preview-zoom > button {
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
  font: inherit;
  cursor: pointer;
}

.preview-zoom button:not(:disabled):hover { background: var(--preview-hover); color: var(--preview-text); }
.preview-zoom button:disabled { opacity: .45; cursor: default; }

.preview-zoom > #zoom-level {
  inline-size: auto;
  min-inline-size: 48px;
  padding-inline: 8px;
  color: var(--preview-text);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

#zoom-level[aria-expanded='true'] { background: var(--preview-hover); }

.preview-zoom-menu {
  position: absolute;
  inset-block-end: calc(100% + 4px);
  inset-inline-end: 0;
  display: grid;
  inline-size: min(168px, calc(100vw - 2 * var(--preview-edge)));
  max-block-size: calc(100dvh - var(--preview-control) - 3 * var(--preview-edge));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  padding: 4px;
  border: 1px solid var(--preview-border);
  border-radius: 16px;
  background: var(--preview-overlay);
  box-shadow: var(--preview-shadow);
  font-size: 12px;
}

.preview-zoom-menu[hidden] { display: none; }

.preview-zoom-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-block-size: 28px;
  padding: 2px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--preview-text);
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.preview-zoom-menu button:is(:focus-visible, [aria-checked='true']):not(:disabled) {
  outline: none;
  background: var(--preview-hover);
}

.preview-zoom-menu hr {
  inline-size: auto;
  margin: 5px 8px;
  border: 0;
  border-top: 1px solid var(--preview-border);
}

.preview-zoom-menu kbd {
  display: grid;
  place-items: center;
  min-inline-size: 18px;
  min-block-size: 18px;
  padding-inline: 3px;
  border-radius: 4px;
  background: var(--preview-hover);
  color: var(--preview-muted);
  font: inherit;
  font-size: 10px;
}
`;

export const designViewerZoomJs = `
function createPreviewZoomControls(labels, canvas) {
  const controls = document.getElementById('zoom-controls');
  const decrease = document.getElementById('zoom-out');
  const increase = document.getElementById('zoom-in');
  const level = document.getElementById('zoom-level');
  const menu = document.getElementById('zoom-menu');
  controls.setAttribute('aria-label', labels.zoom);
  menu.setAttribute('aria-label', labels.zoom);
  decrease.setAttribute('aria-label', labels.out);
  increase.setAttribute('aria-label', labels.in);
  decrease.title = labels.out + ' (-)';
  increase.title = labels.in + ' (⇧=)';
  const actions = new Map();

  function close(restoreFocus) {
    menu.hidden = true;
    level.setAttribute('aria-expanded', 'false');
    if (restoreFocus) level.focus();
  }

  function run(action) {
    const entry = actions.get(action);
    if (!entry || entry.button.disabled) return;
    entry.apply();
    if (!menu.hidden) close(true);
  }

  function addAction(id, text, apply, shortcut, preset) {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.setAttribute('role', preset === undefined ? 'menuitem' : 'menuitemradio');
    button.textContent = text;
    if (shortcut) {
      const key = document.createElement('kbd');
      key.textContent = shortcut;
      key.setAttribute('aria-hidden', 'true');
      button.append(key);
    }
    button.onclick = () => run(id);
    actions.set(id, { button, apply, preset });
    menu.append(button);
  }

  addAction('in', labels.in, () => canvas.zoom(1.25), '⇧=');
  addAction('out', labels.out, () => canvas.zoom(0.8), '-');
  addAction('fit', labels.fit, () => canvas.fit(), '⇧1');
  if (labels.selection) addAction('selection', labels.selection, () => canvas.fit(true), '⇧2');
  const divider = document.createElement('hr');
  divider.setAttribute('role', 'separator');
  menu.append(divider);
  for (const [percent, text] of labels.presets) {
    addAction(String(percent), text, () => canvas.zoomTo(percent / 100), undefined, percent);
  }

  const available = () => [...actions.values()].map(({ button }) => button).filter((button) => !button.disabled);
  function open(last = false) {
    menu.hidden = false;
    level.setAttribute('aria-expanded', 'true');
    available().at(last ? -1 : 0)?.focus();
  }
  level.onclick = () => { if (menu.hidden) open(); else close(true); };
  level.onkeydown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open(event.key === 'ArrowUp');
  };
  decrease.onclick = () => run('out');
  increase.onclick = () => run('in');
  menu.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    const options = available();
    const current = options.indexOf(document.activeElement);
    if (key === 'Home') options[0]?.focus();
    else if (key === 'End') options.at(-1)?.focus();
    else {
      const step = key === 'ArrowDown' ? 1 : -1;
      options[(current + step + options.length) % options.length]?.focus();
    }
  });
  for (const name of ['pointerdown', 'focusin']) document.addEventListener(name, (event) => {
    if (!menu.hidden && !controls.contains(event.target)) close(false);
  });

  return {
    update({ scale, canZoomIn, canZoomOut, canFitSelection }) {
      const percent = scale < 0.01 ? Number((scale * 100).toPrecision(2)) : Math.round(scale * 100);
      level.textContent = percent + '%';
      level.setAttribute('aria-label', labels.zoom + ' ' + percent + '%');
      level.disabled = false;
      increase.disabled = actions.get('in').button.disabled = !canZoomIn;
      decrease.disabled = actions.get('out').button.disabled = !canZoomOut;
      if (labels.selection) actions.get('selection').button.disabled = !canFitSelection;
      for (const { button, preset } of actions.values()) {
        if (preset !== undefined) button.setAttribute('aria-checked', String(scale === preset / 100));
      }
    },
    shortcut(event) {
      if (event.key === '+' || event.key === '=') run('in');
      else if (event.key === '-') run('out');
      else if (labels.selection && event.shiftKey && event.code === 'Digit2') run(actions.get('selection').button.disabled ? 'fit' : 'selection');
      else if (event.key === '0' || event.shiftKey && event.code === 'Digit1') run('fit');
      else return false;
      return true;
    },
  };
}
`;
