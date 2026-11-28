export const designViewerArtboardsJs = `
function createPreviewArtboards(boards, artwork, onSelect) {
  const artboards = [];
  const content = document.createDocumentFragment();
  for (const [index, board] of boards.entries()) {
    const element = document.createElement('div');
    element.className = 'preview-artboard';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'preview-artboard-title';
    title.textContent = board.name;
    title.onclick = () => onSelect(index);
    content.append(element, title);
    const artboard = { index, element, title, original: board };
    placePreviewArtboard(artboard, board);
    artboards.push(artboard);
  }
  artwork.prepend(content);
  return artboards;
}

function placePreviewArtboard(artboard, frame) {
  const { element, title } = artboard;
  const [x, y, logicalWidth, logicalHeight] = frame.layers.bounds;
  const width = logicalWidth || frame.width;
  const height = logicalHeight || frame.height;
  const angle = frame.layers.rotation * Math.PI / 180;
  const flipX = frame.flipX ? -1 : 1;
  const flipY = frame.flipY ? -1 : 1;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [a, b, c, d] = [cos * flipX, sin * flipX, -sin * flipY, cos * flipY];
  // The PNG is board-local. Put it back at the authored origin with the same centered rotation and reflection.
  const left = x + width / 2 - (a * width + c * height) / 2;
  const top = y + height / 2 - (b * width + d * height) / 2;
  const world = ([u, v]) => [left + a * u * width + c * v * height, top + b * u * width + d * v * height];
  const local = ([px, py]) => [(a * (px - left) + b * (py - top)) / width, (c * (px - left) + d * (py - top)) / height];
  const bounds = previewBounds([[0, 0], [1, 0], [1, 1], [0, 1]].map(world));
  Object.assign(artboard, { frame, world, local, bounds });
  element.hidden = title.hidden = Boolean(frame.hidden);
  element.style.width = width + 'px';
  element.style.height = height + 'px';
  element.style.transform = 'matrix(' + [a, b, c, d, left, top].join(',') + ')';
  title.style.left = bounds.x + 'px';
  title.style.top = bounds.y + 'px';
  title.style.setProperty('--preview-board-width', bounds.width + 'px');
}

function setPreviewArtboardImage(artboard, image) {
  image.alt = artboard.original.name;
  if (artboard.image) {
    artboard.image.replaceWith(image);
    URL.revokeObjectURL(artboard.image.src);
  } else artboard.element.prepend(image);
  artboard.image = image;
}

function previewBounds(points) {
  if (!points.length) return;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function loadPreviewArtboardImages(artboards, fetchPreview) {
  let next = 0;
  let failed = false;
  async function load() {
    while (next < artboards.length) {
      const artboard = artboards[next++];
      if (artboard.image) continue;
      try {
        const image = await readPreviewArtboardImage(fetchPreview, '/api/boards/' + artboard.index + '.png');
        // A mode change can finish before the initial queue gets to a given artboard.
        if (artboard.image) URL.revokeObjectURL(image.src);
        else setPreviewArtboardImage(artboard, image);
      } catch {
        if (!artboard.image) failed = true;
      }
    }
  }
  // The full layout can contain hundreds of boards. Limit requests and decoding work in flight.
  await Promise.all(Array.from({ length: Math.min(4, artboards.length) }, load));
  return !failed;
}

async function readPreviewArtboardImage(fetchPreview, path) {
  const response = await fetchPreview(path);
  if (!response.ok) throw new Error('Preview unavailable');
  const image = document.createElement('img');
  image.draggable = false;
  image.decoding = 'async';
  const url = URL.createObjectURL(await response.blob());
  try {
    image.src = url;
    await image.decode();
    return image;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
`;
