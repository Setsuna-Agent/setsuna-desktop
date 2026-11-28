import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designViewerZoomJs, designViewerZoomMarkup, designViewerZoomPresets, designViewerZoomStyles,
  type DesignViewerZoomLabels } from '../../contracts/design-viewer-zoom.js';
import type { Bounds } from '../design-geometry.js';
import { escapeDesignMarkup as escapeHtml } from './design-svg-markup.js';

export const designHtmlPreviewDismiss = 'setsuna:design-html-preview-dismiss';

const viewerStyles = `
html, body { overflow:hidden; }
#setsuna-export-viewer {
  position:fixed; inset:0; overflow:clip;
  color-scheme:light dark;
  --preview-edge:14px;
  --preview-control:28px;
  --preview-pill:999px;
  --preview-text:light-dark(#242424,#fff);
  --preview-muted:light-dark(#666,#9e9e9e);
  --preview-surface:light-dark(#fff,#262626);
  --preview-overlay:light-dark(#fff,#1b1b1b);
  --preview-border:color-mix(in srgb,var(--preview-text) 12%,transparent);
  --preview-hover:color-mix(in srgb,var(--preview-text) 6%,transparent);
  --preview-shadow:0 2px 5px light-dark(#30253c0b,#0003),0 10px 28px light-dark(#30253c13,#0004);
  background:radial-gradient(circle,light-dark(#c9c9cb,#44464a) .75px,transparent 1px) 0 0/16px 16px light-dark(#f3f3f4,#202124);
}
#setsuna-export-viewport {
  position:absolute; inset:0; overflow:clip; padding:16px 16px 56px;
  touch-action:pinch-zoom;
}
#setsuna-export-viewport:focus { outline:none; }
#setsuna-export-viewport[data-tool='hand'] { cursor:grab; user-select:none; }
#setsuna-export-viewport[data-dragging] { cursor:grabbing; user-select:none; }
#setsuna-export-stage { position:absolute; inset:0 auto auto 0; transform-origin:0 0; }
${designViewerZoomStyles}
#setsuna-export-viewer > .preview-zoom {
  inset:auto var(--preview-edge) var(--preview-edge) auto;
  font:12px/1.4 system-ui,sans-serif;
}
`;

// The same viewer runs in the export preview and in the saved, offline HTML.
const viewerScript = `(() => {
  ${designViewerZoomJs}
  const viewport = document.getElementById('setsuna-export-viewport');
  const stage = document.getElementById('setsuna-export-stage');
  const { width, height, responsive } = stage.dataset;
  const padding = getComputedStyle(viewport);
  const left = parseFloat(padding.paddingLeft);
  const top = parseFloat(padding.paddingTop);
  const horizontalPadding = left + parseFloat(padding.paddingRight);
  const verticalPadding = top + parseFloat(padding.paddingBottom);
  const embedded = document.currentScript?.hasAttribute('nonce') && window.parent !== window;
  const maxScale = 4;
  let areaWidth, areaHeight, widthAt100, heightAt100;
  let fitScale = 1;
  let scale = 1;
  let x = 0, y = 0;
  let fitted = true;
  let tool = viewport.dataset.tool;
  let space = false;
  let drag;
  const labels = JSON.parse(document.getElementById('setsuna-export-viewer').dataset.zoomLabels);
  const zoomControls = createPreviewZoomControls(labels, { fit, zoom: zoomBy, zoomTo });

  function draw() {
    stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
  }
  function minimumScale() {
    return Math.min(0.05, fitScale, scale);
  }
  function update() {
    draw();
    zoomControls.update({ scale, canZoomIn: scale < maxScale, canZoomOut: scale > minimumScale() });
  }
  function fit() {
    fitted = true;
    scale = fitScale;
    x = left + (areaWidth - widthAt100 * scale) / 2;
    y = top + (areaHeight - heightAt100 * scale) / 2;
    update();
  }
  function layout() {
    areaWidth = Math.max(1, viewport.clientWidth - horizontalPadding);
    areaHeight = Math.max(1, viewport.clientHeight - verticalPadding);
    if (responsive) stage.style.width = areaWidth + 'px';
    widthAt100 = responsive ? Math.max(areaWidth, stage.scrollWidth) : Number(width);
    heightAt100 = responsive ? Math.max(1, stage.scrollHeight) : Number(height);
    fitScale = Math.min(1, areaWidth / widthAt100, areaHeight / heightAt100);
    if (fitted) fit();
    else update();
  }
  function zoomTo(target, anchor = { x: left + areaWidth / 2, y: top + areaHeight / 2 }) {
    const next = Math.max(minimumScale(), Math.min(maxScale, target));
    if (next === scale) return;
    // Keep the point under the cursor fixed as the canvas scale changes.
    x = anchor.x - (anchor.x - x) * next / scale;
    y = anchor.y - (anchor.y - y) * next / scale;
    scale = next;
    fitted = false;
    update();
  }
  function zoomBy(factor, anchor) {
    zoomTo(scale * factor, anchor);
  }
  function pan(deltaX, deltaY) {
    if (!deltaX && !deltaY) return;
    fitted = false;
    x += deltaX;
    y += deltaY;
    draw();
  }

  function updateTool() {
    viewport.dataset.tool = space ? 'hand' : tool;
  }
  function finishPan(event) {
    if (!drag || (event && drag.id !== event.pointerId)) return;
    const { id } = drag;
    drag = undefined;
    delete viewport.dataset.dragging;
    if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  }

  viewport.addEventListener('pointerdown', (event) => {
    const primaryPan = event.button === 0 && (space || tool === 'hand' || event.pointerType === 'touch');
    if (drag || (!primaryPan && event.button !== 1)) return;
    event.preventDefault();
    viewport.focus({ preventScroll: true });
    viewport.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.dataset.dragging = 'true';
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    pan(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, finishPan);
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (drag) return;
    if (event.ctrlKey || event.metaKey) {
      const rect = viewport.getBoundingClientRect();
      zoomBy(Math.exp(-event.deltaY * 0.006), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    } else if (event.shiftKey) pan(-(event.deltaX || event.deltaY), 0);
    else pan(-event.deltaX, -event.deltaY);
  }, { passive: false });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey
      || event.target.closest?.('select,input,textarea,[contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (event.code === 'Space' && !event.target.closest?.('button')) {
      space = true;
      updateTool();
    } else if (!event.shiftKey && (key === 'h' || key === 'v')) {
      finishPan();
      tool = key === 'h' ? 'hand' : 'select';
      updateTool();
    } else if (event.key === 'Escape' && drag) finishPan();
    else if (event.key === 'Escape' && embedded) window.parent.postMessage(${JSON.stringify(designHtmlPreviewDismiss)}, '*');
    else if (!zoomControls.shortcut(event)) return;
    event.preventDefault();
  });
  document.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') return;
    space = false;
    updateTool();
  });
  window.addEventListener('blur', () => {
    finishPan();
    space = false;
    updateTool();
  });
  const observer = new ResizeObserver(() => layout());
  observer.observe(viewport);
  if (responsive) observer.observe(stage);
  layout();
})();`;
const viewerScriptTag = `<script>${viewerScript}</script>`;

export function designHtmlViewer(content: string, bounds: Bounds, responsive: boolean, t: RendererTranslate) {
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const labels: DesignViewerZoomLabels = {
    zoom: t('feature.design.zoom'), out: t('feature.design.zoomOut'), in: t('feature.design.zoomIn'), fit: t('feature.design.fit'),
    presets: designViewerZoomPresets.map((percent) => [percent, t('feature.design.zoomTo', { percent })]),
  };
  return { css: viewerStyles, body: `<div id="setsuna-export-viewer" data-zoom-labels="${escapeHtml(JSON.stringify(labels))}">
  <main id="setsuna-export-viewport" tabindex="0" data-tool="hand">
    <div id="setsuna-export-stage" data-width="${width}" data-height="${height}"${responsive ? ' data-responsive="true"' : ''}
      style="width:${width}px">${content}</div>
  </main>
  ${designViewerZoomMarkup}
</div>
${viewerScriptTag}` };
}

export function designHtmlPreviewDocument(html: string) {
  const interactive = html.startsWith('<!doctype html>\n<html>\n<head>') && html.includes(viewerScriptTag);
  const nonce = interactive ? crypto.randomUUID() : '';
  const script = interactive ? `; script-src 'nonce-${nonce}'` : '';
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'${script}">`;
  const srcDoc = html.replace('<head>', '<head>' + policy);
  // Only the built-in viewer script receives the nonce in the opaque preview frame.
  return interactive ? { srcDoc: srcDoc.replace(viewerScriptTag, () => `<script nonce="${nonce}">${viewerScript}</script>`), sandbox: 'allow-scripts' }
    : { srcDoc, sandbox: '' };
}
