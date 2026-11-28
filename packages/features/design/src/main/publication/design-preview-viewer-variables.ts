export const designViewerVariablesJs = `
function createPreviewVariableTable(zh, onOpen) {
  const trigger = document.getElementById('toggle-variables');
  const panel = document.getElementById('variables-window');
  const close = document.getElementById('close-variables');
  const collections = document.getElementById('variable-collections');
  const table = document.getElementById('variable-table');
  const headerRow = table.querySelector('thead tr');
  const tableBody = table.querySelector('tbody');
  const label = zh ? '变量' : 'Variables';
  trigger.title = label;
  trigger.setAttribute('aria-label', label);
  panel.setAttribute('aria-label', label);
  close.title = zh ? '关闭' : 'Close';
  close.setAttribute('aria-label', close.title);
  collections.setAttribute('aria-label', zh ? '变量集合' : 'Variable collections');
  const icons = {
    color: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
    number: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
    string: 'M4 7V4h16v3M9 20h6M12 4v16',
    boolean: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 9 2 2 4-4',
  };
  let catalog;
  let entriesByCollection;
  let tabs;
  let active;

  function column(name) {
    const header = document.createElement('th');
    header.scope = 'col';
    header.textContent = name;
    return header;
  }

  function selectCollection(index) {
    if (active === index) return;
    tabs[active]?.setAttribute('aria-pressed', 'false');
    tabs[index].setAttribute('aria-pressed', 'true');
    active = index;
    const { name, modes } = catalog.collections[index];
    table.setAttribute('aria-label', name);
    headerRow.replaceChildren(column(zh ? '名称' : 'Name'), ...modes.map(column));
    // Each column compares that collection's mode with the other collections at their defaults, as in Design.
    const resolvers = modes.map((_, mode) => previewVariableResolver(catalog.entries, index, mode));
    const rows = document.createDocumentFragment();
    for (const entryIndex of entriesByCollection[index]) {
      const entry = catalog.entries[entryIndex];
      const row = document.createElement('tr');
      const heading = document.createElement('th');
      const title = document.createElement('span');
      const nameText = document.createElement('span');
      heading.scope = 'row';
      heading.title = nameText.textContent = entry.name;
      title.append(previewPanelIcon(icons[entry.kind]), nameText);
      heading.append(title);
      row.append(heading);
      for (const [mode, resolve] of resolvers.entries()) {
        const cell = row.insertCell();
        const value = resolve(entryIndex);
        if (entry.kind === 'color') cell.append(previewPaintValue(value));
        else if (entry.kind === 'boolean') {
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.disabled = true;
          checkbox.checked = value;
          checkbox.setAttribute('aria-label', entry.name + ' · ' + modes[mode]);
          cell.append(checkbox);
        } else {
          const field = document.createElement('span');
          field.textContent = String(value);
          cell.append(field);
        }
      }
      rows.append(row);
    }
    tableBody.replaceChildren(rows);
    table.parentElement.scrollTop = table.parentElement.scrollLeft = 0;
  }

  function dismiss(focus = true) {
    if (panel.hidden) return false;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus({ preventScroll: true });
    return true;
  }

  trigger.onclick = () => {
    if (dismiss() || !catalog) return;
    onOpen();
    if (active === undefined) selectCollection(0);
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    tabs[active].focus({ preventScroll: true });
  };
  close.onclick = () => dismiss();

  return {
    dismiss,
    load(variables) {
      if (!variables?.collections.length) return;
      catalog = variables;
      entriesByCollection = variables.collections.map(() => []);
      variables.entries.forEach(({ collection }, index) => entriesByCollection[collection].push(index));
      tabs = variables.collections.map(({ name }, index) => {
        const tab = document.createElement('button');
        const text = document.createElement('span');
        tab.type = 'button';
        tab.title = text.textContent = name;
        tab.setAttribute('aria-pressed', 'false');
        tab.onclick = () => selectCollection(index);
        tab.append(text);
        return tab;
      });
      collections.replaceChildren(...tabs);
      trigger.hidden = false;
    },
  };
}

function createPreviewBoardModes(zh, apply, unavailable) {
  const section = document.getElementById('preview-board-modes');
  const controls = document.getElementById('preview-board-mode-fields');
  document.getElementById('preview-board-modes-title').textContent = zh ? '变量模式' : 'Variable mode';
  let states = [];
  let choices = [];
  let fields = [];
  let selected;

  function update() {
    const state = states[selected];
    for (const { collection, select } of fields) {
      select.value = String((state.pending ?? state.modes)[collection]);
      select.disabled = Boolean(state.pending);
    }
  }

  async function change(index, collection, mode) {
    const state = states[index];
    if (state.pending || mode === state.modes[collection]) return;
    const modes = [...state.modes];
    modes[collection] = mode;
    const slot = previewVariantSlot(state.board.modes, modes);
    state.pending = modes;
    update();
    try {
      if (slot !== state.slot) await apply(index, state.board, slot === state.original ? undefined : slot);
      state.modes = modes;
      state.slot = slot;
    } catch {
      unavailable();
    } finally {
      state.pending = undefined;
      if (index === selected) update();
    }
  }

  return {
    select(index) {
      if (index === selected) return;
      selected = index;
      fields = [];
      controls.replaceChildren();
      section.hidden = !states[index] || !choices.length;
      if (section.hidden) return;
      for (const { collection, name, modes } of choices) {
        const field = document.createElement('div');
        const select = document.createElement('select');
        field.className = 'preview-variable-mode';
        select.setAttribute('aria-label', name);
        modes.forEach((mode, index) => {
          const option = document.createElement('option');
          option.textContent = name + ' · ' + mode;
          option.value = String(index);
          select.append(option);
        });
        select.onchange = () => change(index, collection, Number(select.value));
        field.append(select, previewPanelIcon('m6 9 6 6 6-6'));
        controls.append(field);
        fields.push({ collection, select });
      }
      update();
    },
    load(boards, variables) {
      if (!variables?.collections.length) return;
      choices = variables.collections.flatMap(({ name, modes }, collection) => modes.length > 1 ? [{ collection, name, modes }] : []);
      states = boards.map((board) => {
        const modes = board.modes.initial;
        const original = previewVariantSlot(board.modes, modes);
        return { board, modes, original, slot: original };
      });
    },
  };
}

function previewVariantSlot(plan, modes) {
  return plan.axes.reduce((slot, axis) => slot * (Math.max(...axis.modes) + 1) + axis.modes[modes[axis.collection]], 0);
}

function previewVariableResolver(entries, collection, mode) {
  const resolved = new Map();
  return (index) => {
    const path = new Map();
    let current = index;
    while (!resolved.has(current) && !path.has(current)) {
      const entry = entries[current];
      const { value, alias } = entry.cells[entry.collection === collection ? mode : 0];
      path.set(current, value);
      if (entries[alias]?.kind !== entry.kind) {
        resolved.set(current, value);
        break;
      }
      current = alias;
    }
    // Match the editor's alias fallback when a cycle is reached.
    const fallback = resolved.get(current) ?? path.get(current);
    const cyclic = !resolved.has(current);
    let inCycle = false;
    for (const [key, local] of path) {
      inCycle ||= cyclic && key === current;
      resolved.set(key, inCycle ? local : fallback);
    }
    return resolved.get(index);
  };
}
`;
