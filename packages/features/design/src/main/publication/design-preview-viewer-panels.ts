import { designViewerNarrowLayout } from './design-preview-viewer-style.js';

export const designViewerPanelsJs = `
function createPreviewPanelToggles(zh, onOverlayOpen) {
  const narrow = window.matchMedia('${designViewerNarrowLayout}');
  const panels = [['layers', zh ? '图层' : 'layers'], ['properties', zh ? '属性栏' : 'properties']]
    .map(([name, label]) => ({
      label,
      panel: document.getElementById(name + '-panel'),
      toggle: document.getElementById('toggle-' + name),
      collapse: document.getElementById('collapse-' + name),
      open: false,
    }));
  let overlay;

  function labelButton(button, label, open) {
    const title = (zh ? (open ? '收起' : '展开') : (open ? 'Hide ' : 'Show ')) + label;
    button.setAttribute('aria-label', title);
    button.title = title;
  }

  function render() {
    for (const entry of panels) {
      const open = narrow.matches ? entry === overlay : entry.open;
      entry.panel.hidden = !open;
      entry.toggle.hidden = open && !narrow.matches;
      entry.toggle.setAttribute('aria-expanded', String(open));
      labelButton(entry.toggle, entry.label, open);
    }
  }

  function setOpen(entry, open) {
    if (narrow.matches) {
      overlay = open ? entry : undefined;
      if (open) onOverlayOpen();
    } else entry.open = open;
    render();
    const focus = open && !narrow.matches ? entry.collapse : entry.toggle;
    focus.focus({ preventScroll: true });
  }

  for (const entry of panels) {
    labelButton(entry.collapse, entry.label, true);
    entry.collapse.onclick = () => setOpen(entry, false);
    entry.toggle.onclick = () => setOpen(entry, entry.panel.hidden);
  }
  narrow.addEventListener('change', render);
  render();
  return {
    dismissOverlay() {
      if (!narrow.matches || !overlay) return false;
      setOpen(overlay, false);
      return true;
    },
  };
}

function createPreviewPanels(zh, onSelect) {
  const list = document.getElementById('layer-tree');
  const identity = document.getElementById('preview-selected-layer');
  const inspector = document.getElementById('preview-property-fields');
  const kinds = {
    artboard: ['画板', 'Artboard', 'M5 3v18M19 3v18M3 5h18M3 19h18'],
    frame: ['画框', 'Frame', 'M5 3v18M19 3v18M3 5h18M3 19h18'],
    group: ['编组', 'Group', 'M3 3h5v5H3zM16 3h5v5h-5zM3 16h5v5H3zM16 16h5v5h-5zM9 12h6'],
    component: ['组件', 'Component', 'm12 2 10 10-10 10L2 12zM12 7v10m-5-5h10'],
    instance: ['实例', 'Instance', 'm12 2 10 10-10 10L2 12z'],
    rectangle: ['矩形', 'Rectangle', 'M4 4h16v16H4z'],
    ellipse: ['椭圆', 'Ellipse', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
    text: ['文字', 'Text', 'M4 6V4h16v2m-8-2v16m-3 0h6'],
    image: ['图片', 'Image', 'M3 4h18v16H3zM6 16l5-5 4 4 2-2 4 4'],
    web: ['网页', 'Web', 'M3 4h18v16H3zM3 9h18'],
    script: ['脚本', 'Script', 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18'],
    path: ['路径', 'Path', 'M4 19c7-1 3-15 16-14M4 17v4M20 3v4'],
    polygon: ['多边形', 'Polygon', 'm12 3 9 7-4 11H7L3 10z'],
    svg: ['矢量', 'Vector', 'm12 2 10 10-10 10L2 12z'],
    icon: ['图标', 'Icon', 'M4 4h16v16H4zM9 12h6m-3-3v6'],
  };
  const labels = zh ? {
    layers: '图层', properties: '属性', expand: '展开图层', collapse: '折叠图层',
    transform: '变换', width: '宽度', height: '高度', rotation: '旋转', appearance: '外观', opacity: '不透明度',
    fill: '填充', stroke: '描边', text: '文字', font: '字体', size: '字号', weight: '字重',
  } : {
    layers: 'Layers', properties: 'Properties', expand: 'Expand layer', collapse: 'Collapse layer',
    transform: 'Transform', width: 'Width', height: 'Height', rotation: 'Rotation', appearance: 'Appearance', opacity: 'Opacity',
    fill: 'Fill', stroke: 'Stroke', text: 'Text', font: 'Font', size: 'Font size', weight: 'Font weight',
  };
  document.getElementById('layers-title').textContent = labels.layers;
  document.getElementById('properties-title').textContent = labels.properties;
  const format = new Intl.NumberFormat(zh ? 'zh-CN' : 'en', { maximumFractionDigits: 2 });
  const rows = new Map();
  let roots = [];
  let selected;

  function layerName(layer) { return layer.name || kinds[layer.kind][zh ? 0 : 1]; }

  function selectLayer(layer) {
    rows.get(selected)?.button.setAttribute('aria-pressed', 'false');
    selected = layer;
    const row = rows.get(selected);
    row?.button.setAttribute('aria-pressed', 'true');
    renderProperties(layer);
    onSelect(row?.board, layer);
  }

  function renderLayer(layer, siblings, board, expanded) {
    const item = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'preview-layer-row';
    item.append(row);
    siblings.append(item);
    const button = document.createElement('button');
    const name = document.createElement('span');
    const [, , icon] = kinds[layer.kind];
    button.type = 'button';
    button.className = 'preview-layer-select';
    button.title = name.textContent = layerName(layer);
    button.setAttribute('aria-pressed', 'false');
    button.append(previewPanelIcon(icon), name);
    button.onclick = () => selectLayer(layer);
    let expand;
    let isExpanded;
    if (layer.children.length) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'preview-layer-toggle';
      toggle.append(previewPanelIcon('m9 18 6-6-6-6'));
      row.append(toggle);
      const children = document.createElement('ul');
      item.append(children);
      expand = (open) => {
        if (open && !children.firstChild) {
          for (let index = layer.children.length - 1; index >= 0; index -= 1) renderLayer(layer.children[index], children, board, expanded);
        }
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? labels.collapse : labels.expand);
        toggle.title = open ? labels.collapse : labels.expand;
        children.hidden = !open;
      };
      isExpanded = () => !children.hidden;
      toggle.onclick = () => expand(children.hidden);
      expand(expanded?.has(layer.key) ?? false);
    }
    row.append(button);
    rows.set(layer, { board, button, expand, item, isExpanded });
  }

  function propertiesSection(title, entries) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = title;
    const fields = document.createElement('dl');
    for (const [key, value] of entries) {
      const label = document.createElement('dt');
      const field = document.createElement('dd');
      label.textContent = key;
      field.append(value);
      fields.append(label, field);
    }
    section.append(heading, fields);
    return section;
  }

  function renderProperties(layer) {
    inspector.replaceChildren();
    identity.hidden = !layer;
    identity.textContent = layer ? layerName(layer) : '';
    if (!layer) return;
    const [x, y, width, height] = layer.bounds;
    inspector.append(propertiesSection(labels.transform, [
      ['X', format.format(x)], ['Y', format.format(y)], [labels.width, format.format(width)],
      [labels.height, format.format(height)], [labels.rotation, format.format(layer.rotation) + '°'],
    ]), propertiesSection(labels.appearance, [
      [labels.opacity, format.format(layer.opacity * 100) + '%'],
      ...layer.fills.map((color) => [labels.fill, previewPaintValue(color)]),
      ...layer.strokes.map(({ color, width }) => [labels.stroke, previewPaintValue(color, color.toUpperCase() + ' · ' + format.format(width) + ' px')]),
    ]));
    if (layer.typography) {
      const { family, size, weight } = layer.typography;
      const fields = [[labels.size, format.format(size) + ' px']];
      if (family) fields.unshift([labels.font, family]);
      if (weight !== undefined) fields.push([labels.weight, format.format(weight)]);
      inspector.append(propertiesSection(labels.text, fields));
    }
  }

  return {
    load(boards, start) {
      selectLayer(undefined);
      roots = boards.map(({ layers }) => layers);
      rows.clear();
      list.replaceChildren();
      for (let index = roots.length - 1; index >= 0; index -= 1) renderLayer(roots[index], list, index);
      rows.get(roots[start])?.expand?.(true);
    },
    replaceBoard(board, root) {
      const previous = rows.get(roots[board]).item;
      const restoreSelection = rows.get(selected)?.board === board;
      const expanded = new Set();
      for (const [layer, row] of rows) {
        if (row.board !== board) continue;
        if (row.isExpanded?.()) expanded.add(layer.key);
        rows.delete(layer);
      }
      roots[board] = root;
      const fragment = document.createDocumentFragment();
      renderLayer(root, fragment, board, expanded);
      previous.replaceWith(fragment);
      if (restoreSelection) {
        const match = [...rows].find(([layer, row]) => row.board === board && layer.key === selected.key);
        selectLayer(match?.[0] ?? root);
      }
    },
    pick(board, point) {
      const root = roots[board];
      const path = root && (point ? previewLayerHit(root, point) : [root]);
      if (path) for (const ancestor of path.slice(0, -1)) rows.get(ancestor).expand?.(true);
      const layer = path?.at(-1);
      selectLayer(layer);
      rows.get(layer)?.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    clear() { selectLayer(undefined); },
  };
}

function previewPaintValue(color, description = color.toUpperCase()) {
  const value = document.createElement('span');
  const swatch = document.createElement('span');
  value.className = 'preview-paint';
  swatch.className = 'preview-paint-swatch';
  swatch.style.backgroundColor = color;
  value.append(swatch, description);
  return value;
}

function previewPanelIcon(data) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', data);
  svg.append(path);
  return svg;
}

function previewLayerHit(layer, point) {
  // A non-clipping parent can have visible children outside its own outline.
  for (let index = layer.children.length - 1; index >= 0; index -= 1) {
    const child = previewLayerHit(layer.children[index], point);
    if (child) return [layer, ...child];
  }
  if (layer.pickable === false) return;
  const [x, y] = point;
  const outline = layer.outline;
  let inside = false;
  for (let index = 0, last = outline.length - 1; index < outline.length; last = index, index += 1) {
    const [ax, ay] = outline[last];
    const [bx, by] = outline[index];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? [layer] : undefined;
}
`;
