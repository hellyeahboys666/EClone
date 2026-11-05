// The House panel: a settings form built from HOUSE_FIELDS. Every change shows up
// in the 3D house right away and is saved to the server (house.json) a moment later.
import { HOUSE_DEFAULTS, HOUSE_FIELDS, cleanHouse } from './house-config.js';

export function createHousePanel({ button, panel, initial, onChange }) {
  let settings = cleanHouse(initial);
  let saveTimer;
  const status = document.createElement('p');
  status.className = 'house-status';

  function render() {
    panel.replaceChildren();
    const head = document.createElement('div');
    head.className = 'house-head';
    head.innerHTML = '<h2>House</h2>';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'house-close';
    close.textContent = 'Close';
    close.addEventListener('click', () => toggle(false));
    head.append(close);
    panel.append(head);

    const form = document.createElement('form');
    form.addEventListener('submit', (e) => e.preventDefault());
    for (const field of HOUSE_FIELDS) {
      const id = `house-${field.key}`;
      const row = document.createElement('div');
      row.className = `house-row house-${field.type}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = field.label;
      let input;
      if (field.type === 'choice') {
        input = document.createElement('select');
        for (const [value, text] of field.options) input.add(new Option(text, value, false, settings[field.key] === value));
        input.addEventListener('change', () => update(field.key, input.value));
      } else if (field.type === 'color') {
        input = document.createElement('input');
        input.type = 'color';
        input.value = settings[field.key];
        input.addEventListener('input', () => update(field.key, input.value));
      } else {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = settings[field.key];
        input.addEventListener('change', () => update(field.key, input.checked));
      }
      input.id = id;
      if (field.type === 'toggle') row.append(input, label);
      else row.append(label, input);
      form.append(row);
    }
    panel.append(form);

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'house-reset';
    reset.textContent = 'Reset to default';
    reset.addEventListener('click', () => {
      settings = { ...HOUSE_DEFAULTS };
      render();
      changed();
    });
    panel.append(reset, status);
  }

  // Color pickers send many changes while dragging, so rebuilding and saving wait a beat.
  let rebuildTimer;
  function update(key, value) {
    settings = cleanHouse({ ...settings, [key]: value });
    changed();
  }

  function changed() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => onChange(settings), 120);
    clearTimeout(saveTimer);
    status.textContent = 'Saving…';
    saveTimer = setTimeout(save, 600);
  }

  async function save() {
    try {
      const res = await fetch('/api/house', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(`server error ${res.status}`);
      status.textContent = 'Saved.';
    } catch (err) {
      status.textContent = `Couldn't save: ${err.message}. The change is shown but will be lost on reload.`;
    }
  }

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  button.addEventListener('click', () => toggle());
  render();
  return { settings: () => settings };
}
