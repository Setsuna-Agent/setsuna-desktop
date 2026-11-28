export const designViewerCanvasJs = `
function createPreviewCanvas(stage, onPick, onZoomChange) {
  const fitArea = document.getElementById('fit-area');
  const artwork = document.getElementById('artwork');
  const outline = document.getElementById('selection-outline');
  const selectionPath = outline.querySelector('path');
  const select = document.getElementById('select-tool');
  const hand = document.getElementById('hand-tool');
  const pointers = new Map();
  const maxScale = 8;
  let artboards = [];
  let canvasBounds;
  let selectionBounds;
  let stageOrigin;
  let minScale = 0.02;
  let click;
  let scale = 1;
  let x = 0;
  let y = 0;

  function update() {
    artwork.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
  }

  function zoomChanged() {
    artwork.style.setProperty('--preview-view-scale', String(scale));
    artwork.style.setProperty('--preview-view-inverse', String(1 / scale));
    onZoomChange({ scale, canZoomIn: scale < maxScale, canZoomOut: scale > minScale, canFitSelection: Boolean(selectionBounds) });
  }

  function workArea() {
    const { offsetLeft, offsetTop, clientWidth, clientHeight } = fitArea;
    if (clientWidth >= 48 && clientHeight >= 48) return { x: offsetLeft, y: offsetTop, width: clientWidth, height: clientHeight };
    return { x: 0, y: 0, width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) };
  }

  function fittedScale(bounds, area) {
    const padding = Math.min(32, area.width / 8, area.height / 8);
    return Math.min(1.5, (area.width - 2 * padding) / Math.max(1, bounds.width), (area.height - 2 * padding) / Math.max(1, bounds.height));
  }

  function updateCanvasBounds() {
    const visible = artboards.filter(({ frame }) => !frame.hidden);
    canvasBounds = previewBounds((visible.length ? visible : artboards).flatMap(({ bounds }) =>
      [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height]]));
  }

  function fit(selection = false) {
    const bounds = selection ? selectionBounds : canvasBounds;
    if (!bounds || !canvasBounds) return;
    const area = workArea();
    // Long boards and widely spaced layouts can need a smaller fit than the editor's usual 2% floor.
    minScale = Math.min(0.02, fittedScale(canvasBounds, area));
    scale = Math.max(minScale, fittedScale(bounds, area));
    x = area.x + (area.width - bounds.width * scale) / 2 - bounds.x * scale;
    y = area.y + (area.height - bounds.height * scale) / 2 - bounds.y * scale;
    stageOrigin = stage.getBoundingClientRect();
    update();
    zoomChanged();
  }

  function center() {
    const area = workArea();
    return [area.x + area.width / 2, area.y + area.height / 2];
  }

  function zoomTo(targetScale, from = center(), to = from) {
    if (!canvasBounds) return;
    const next = Math.min(maxScale, Math.max(minScale, targetScale));
    x = to[0] - (from[0] - x) * next / scale;
    y = to[1] - (from[1] - y) * next / scale;
    const changed = scale !== next;
    scale = next;
    update();
    if (changed) zoomChanged();
  }

  function zoom(factor, from, to) {
    zoomTo(scale * factor, from, to);
  }

  function point(event) {
    const { left, top } = stage.getBoundingClientRect();
    return [event.clientX - left, event.clientY - top];
  }

  function setTool(tool) {
    click = undefined;
    stage.dataset.tool = tool;
    select.setAttribute('aria-pressed', String(tool === 'select'));
    hand.setAttribute('aria-pressed', String(tool === 'hand'));
  }

  stage.addEventListener('pointerdown', (event) => {
    if (!canvasBounds || (event.button !== 0 && event.button !== 1) || pointers.size >= 2) return;
    if (event.button === 0 && event.target instanceof Element && event.target.closest('.preview-artboard-title')) return;
    event.preventDefault();
    stage.focus({ preventScroll: true });
    stage.setPointerCapture(event.pointerId);
    const start = point(event);
    click = pointers.size === 0 && event.button === 0 && stage.dataset.tool === 'select'
      ? { id: event.pointerId, start } : undefined;
    pointers.set(event.pointerId, start);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    const position = point(event);
    if (click && distance(click.start, position) < 4) return;
    click = undefined;
    stage.dataset.dragging = 'true';
    const before = [...pointers.values()];
    pointers.set(event.pointerId, position);
    const after = [...pointers.values()];
    if (after.length === 1) zoom(1, before[0], after[0]);
    else zoom(distance(...after) / Math.max(1, distance(...before)), midpoint(...before), midpoint(...after));
  });
  function finish(event, pick = false) {
    if (!pointers.delete(event.pointerId)) return;
    if (!pointers.size) stage.removeAttribute('data-dragging');
    const press = click;
    click = undefined;
    if (!pick || !press || press.id !== event.pointerId) return;
    const position = point(event);
    if (distance(press.start, position) < 4) {
      const world = [(position[0] - x) / scale, (position[1] - y) / scale];
      for (let index = artboards.length - 1; index >= 0; index -= 1) {
        if (artboards[index].frame.hidden) continue;
        const local = artboards[index].local(world);
        if (local.every((value) => value >= 0 && value <= 1)) {
          onPick(index, local);
          return;
        }
      }
      onPick(undefined);
    }
  }
  stage.addEventListener('pointerup', (event) => finish(event, true));
  for (const name of ['pointercancel', 'lostpointercapture']) stage.addEventListener(name, (event) => finish(event));
  stage.addEventListener('wheel', (event) => {
    if (!canvasBounds) return;
    event.preventDefault();
    if (pointers.size) return;
    if (event.ctrlKey || event.metaKey) {
      zoom(Math.exp(-event.deltaY * 0.006), point(event));
    } else {
      x -= event.shiftKey ? event.deltaX || event.deltaY : event.deltaX;
      if (!event.shiftKey) y -= event.deltaY;
      update();
    }
  }, { passive: false });

  select.onclick = () => setTool('select');
  hand.onclick = () => setTool('hand');
  new ResizeObserver(() => {
    if (!canvasBounds || !stageOrigin) return;
    // A docked panel changes the viewport origin. Keep artwork at the same screen position.
    const next = stage.getBoundingClientRect();
    x += stageOrigin.left - next.left;
    y += stageOrigin.top - next.top;
    stageOrigin = next;
    minScale = Math.min(scale, 0.02, fittedScale(canvasBounds, workArea()));
    update();
    zoomChanged();
  }).observe(stage);

  return {
    setTool, zoom, zoomTo, fit,
    setBoards(boards) {
      artboards = createPreviewArtboards(boards, artwork, onPick);
      updateCanvasBounds();
      click = undefined;
      pointers.clear();
      stage.removeAttribute('data-dragging');
      artwork.hidden = !canvasBounds;
      fit();
      return artboards;
    },
    replaceBoard(index, frame, image) {
      const board = artboards[index];
      placePreviewArtboard(board, frame);
      setPreviewArtboardImage(board, image);
      updateCanvasBounds();
      minScale = Math.min(scale, 0.02, fittedScale(canvasBounds, workArea()));
      zoomChanged();
    },
    showOutline(index, points, path) {
      const board = artboards[index];
      selectionBounds = board && !board.frame.hidden && points.length >= 3 ? previewBounds(points.map(board.world)) : undefined;
      outline.toggleAttribute('hidden', !selectionBounds);
      if (selectionBounds) {
        board.element.append(outline);
        selectionPath.setAttribute('d', path || 'M' + points.map((pair) => pair.join(',')).join('L') + 'Z');
      }
      zoomChanged();
    },
  };
}

function midpoint(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
`;
