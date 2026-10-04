/* Shared DOM components for sandbox apps. Load ui-base.css and, for icons, ui-icons.js. */
/* global window, document */
(() => {
  let sequence = 0;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  function button({ label, icon, iconOnly = false, variant = 'default', disabled = false, onClick } = {}) {
    const element = node('button', 'sa-button');
    element.type = 'button';
    if (['primary', 'ghost', 'danger'].includes(variant)) element.classList.add(`sa-button--${variant}`);
    element.disabled = disabled;
    if (icon) element.append(window.SetsunaIcons.create(icon));
    if (iconOnly) {
      if (!label) throw new Error('Icon buttons require a label.');
      element.classList.add('sa-button--icon');
      element.setAttribute('aria-label', label);
      element.title = label;
    } else element.append(node('span', '', label));
    if (onClick) element.addEventListener('click', onClick);
    return element;
  }

  function field({ label, name, type = 'text', value = '', required = false, onInput } = {}) {
    const element = node('label', 'sa-field');
    const input = node(type === 'textarea' ? 'textarea' : 'input', 'sa-input');
    if (type !== 'textarea') input.type = type;
    input.name = name;
    input.value = value;
    input.required = required;
    if (onInput) input.addEventListener('input', () => onInput(input.value));
    element.append(node('span', 'sa-label', label), input);
    return { element, input };
  }

  function select({ label, name, options = [], value = '', required = false, onChange } = {}) {
    const element = node('label', 'sa-field');
    const input = node('select', 'sa-input');
    input.name = name;
    input.required = required;
    for (const item of options) {
      const option = node('option', '', item.label);
      option.value = item.value;
      option.disabled = Boolean(item.disabled);
      input.append(option);
    }
    input.value = value;
    if (onChange) input.addEventListener('change', () => onChange(input.value));
    element.append(node('span', 'sa-label', label), input);
    return { element, input };
  }

  function tabs({ items, value, label, onChange } = {}) {
    if (!items?.length || new Set(items.map((item) => item.id)).size !== items.length) {
      throw new Error('Tabs require items with unique IDs.');
    }
    const enabled = items.filter((item) => !item.disabled);
    if (!enabled.length) throw new Error('Tabs require an enabled item.');
    let current = enabled.some((item) => item.id === value) ? value : enabled[0].id;
    const prefix = `sa-tabs-${++sequence}`;
    const element = node('section', 'sa-stack');
    const list = node('div', 'sa-tabs');
    list.setAttribute('role', 'tablist');
    if (label) list.setAttribute('aria-label', label);
    element.append(list);
    const entries = items.map((item, index) => {
      const trigger = button({ label: item.label, disabled: item.disabled });
      trigger.classList.add('sa-tab');
      trigger.id = `${prefix}-tab-${index}`;
      trigger.setAttribute('role', 'tab');
      const panel = node('div', 'sa-tab-panel');
      panel.id = `${prefix}-panel-${index}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', trigger.id);
      panel.tabIndex = 0;
      trigger.setAttribute('aria-controls', panel.id);
      panel.append(item.content);
      list.append(trigger);
      element.append(panel);
      return { item, trigger, panel };
    });
    const update = () => {
      for (const { item, trigger, panel } of entries) {
        const active = item.id === current;
        trigger.setAttribute('aria-selected', String(active));
        trigger.tabIndex = active ? 0 : -1;
        panel.hidden = !active;
      }
    };
    const setValue = (id, focus = false) => {
      const entry = entries.find(({ item }) => item.id === id && !item.disabled);
      if (!entry) return false;
      const changed = current !== id;
      current = id;
      update();
      if (focus) entry.trigger.focus();
      if (changed) onChange?.(id);
      return true;
    };
    for (const { item, trigger } of entries) {
      trigger.addEventListener('click', () => setValue(item.id));
      trigger.addEventListener('keydown', (event) => {
        const index = enabled.findIndex((candidate) => candidate.id === item.id);
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % enabled.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + enabled.length) % enabled.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = enabled.length - 1;
        else return;
        event.preventDefault();
        setValue(enabled[next].id, true);
      });
    }
    update();
    return { element, get value() { return current; }, setValue };
  }

  function dialog({ title, content, closeLabel = 'Close', onClose } = {}) {
    const element = node('dialog', 'sa-dialog');
    const heading = node('h2', 'sa-section-title', title);
    heading.id = `sa-dialog-title-${++sequence}`;
    element.setAttribute('aria-labelledby', heading.id);
    const header = node('header', 'sa-dialog__header');
    const closeButton = button({ label: closeLabel, icon: 'x', iconOnly: true, variant: 'ghost', onClick: () => element.close() });
    header.append(heading, closeButton);
    const body = node('div', 'sa-dialog__body');
    body.append(content);
    element.append(header, body);
    document.body.append(element);
    let opener;
    element.addEventListener('close', () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      onClose?.(element.returnValue);
    });
    return {
      element,
      open(initialFocus) {
        if (element.open) return;
        opener = document.activeElement;
        element.returnValue = '';
        element.showModal();
        if (initialFocus && body.contains(initialFocus)) initialFocus.focus({ preventScroll: true });
      },
      close(value = '') { element.close(value); },
      destroy() { element.close(); element.remove(); },
    };
  }

  window.SetsunaComponents = Object.freeze({ button, field, select, tabs, dialog });
})();
