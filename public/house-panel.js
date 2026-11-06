// The House panel, in two tabs:
//   Look      time of day, lamps, colors, floor, wall finish (patterns or your own
//             picture as wallpaper), your own picture as the view, what's shown
//   Decorate  everything in the room, the furniture it started with included: add things
//             from a catalog (or your own photos and 3D models), drag anything around,
//             and turn, resize, recolor or remove the selected one
// Every change shows up in the 3D house right away and is saved to house.json a moment
// later. A few seconds after you stop changing things, the twin says what it thinks
// (onSettled).
import { CATALOG, HOUSE_DEFAULTS, HOUSE_FIELDS, cleanHouse, newItemId, startingFurniture } from './house-config.js';

export function createHousePanel({ button, panel, initial, stage, onChange, onSettled }) {
  let settings = cleanHouse(initial);
  let tab = 'look';
  let selected = null; // id of the selected placed thing
  let removed = null; // the last thing removed, so it can be put back: { item, index }
  let saveTimer;
  let rebuildTimer;
  let settleTimer;
  const status = h('p', { class: 'house-status' });

  // ---- Small DOM helper -------------------------------------------------------
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'class') el.className = value;
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
    return el;
  }
  const row = (label, input, cls = '') => h('div', { class: `house-row ${cls}` }, h('label', { htmlFor: input.id }, label), input);

  function render() {
    panel.replaceChildren(
      h('div', { class: 'house-head' }, h('h2', {}, 'House'), h('button', { type: 'button', class: 'house-close', onclick: () => toggle(false) }, 'Close')),
      h('div', { class: 'house-tabs', role: 'tablist' },
        ['look', 'decorate'].map((t) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === t), onclick: () => { tab = t; render(); syncDecorating(); } }, t === 'look' ? 'Look' : 'Decorate'))),
      tab === 'look' ? lookView() : decorateView(),
      status,
    );
  }

  // ---- Look -------------------------------------------------------------------
  function lookView() {
    const form = h('form', { onsubmit: (e) => e.preventDefault() });
    for (const field of HOUSE_FIELDS) {
      const id = `house-${field.key}`;
      let input;
      if (field.type === 'choice') {
        input = h('select', { id });
        for (const [value, text] of field.options) input.add(new Option(text, value, false, settings[field.key] === value));
        input.addEventListener('change', async () => {
          if (field.key === 'wallStyle' && input.value === 'image' && !settings.wallImage) {
            // Your own wallpaper: pick the picture first.
            const url = await uploadPicture('wallpaper');
            if (!url) return render();
            update({ wallImage: url, wallImageLabel: settings.wallImageLabel || '', wallStyle: 'image' });
            return render();
          }
          update({ [field.key]: input.value });
        });
      } else if (field.type === 'color') {
        input = h('input', { id, type: 'color', value: settings[field.key], oninput: () => update({ [field.key]: input.value }) });
      } else {
        input = h('input', { id, type: 'checkbox', checked: settings[field.key], onchange: () => update({ [field.key]: input.checked }) });
        form.append(h('div', { class: 'house-row house-toggle' }, input, h('label', { htmlFor: id }, field.label)));
        continue;
      }
      form.append(row(field.label, input));
      if (field.key === 'wallStyle' && settings.wallStyle === 'image') form.append(pictureControls('wallImage', 'wallImageLabel', 'Wallpaper picture'));
      if (field.key === 'view') form.append(pictureControls('outsideImage', 'outsideLabel', 'Window view'));
    }
    return h('div', {}, form,
      h('button', { type: 'button', class: 'house-reset', onclick: () => {
        if (!confirm('Reset the house, including everything you added?')) return;
        settings = cleanHouse(HOUSE_DEFAULTS);
        selected = null;
        render();
        changed();
      } }, 'Reset to default'));
  }

  // "Use my own picture" for the wallpaper or the view, with a description the twin reads.
  function pictureControls(imageKey, labelKey, title) {
    const label = h('input', { type: 'text', value: settings[labelKey], placeholder: 'What it shows (for the twin)', 'aria-label': `${title}: what it shows`, onchange: () => update({ [labelKey]: label.value }) });
    const describe = h('button', { type: 'button', class: 'small', onclick: async () => {
      label.value = await describePicture(settings[imageKey]) ?? label.value;
      update({ [labelKey]: label.value });
    } }, 'Describe it for me');
    const pick = h('button', { type: 'button', class: 'small', onclick: async () => {
      const url = await uploadPicture(title);
      if (url) {
        update({ [imageKey]: url, [labelKey]: '' });
        render();
      }
    } }, settings[imageKey] ? 'Change picture' : 'Use my own picture');
    const remove = settings[imageKey] && imageKey === 'outsideImage'
      ? h('button', { type: 'button', class: 'small', onclick: () => { update({ outsideImage: null, outsideLabel: '' }); render(); } }, 'Back to the drawn view')
      : null;
    return h('div', { class: 'house-picture' },
      h('div', { class: 'row-buttons' }, pick, remove),
      settings[imageKey] ? h('div', { class: 'stack' }, h('img', { src: settings[imageKey], alt: '', class: 'thumb' }), label, describe) : null);
  }

  // ---- Decorate ---------------------------------------------------------------
  function decorateView() {
    const adds = Object.entries(CATALOG)
      .filter(([, def]) => !def.image && !def.model)
      .map(([type, def]) => h('button', { type: 'button', class: 'small', onclick: () => addItem({ type }) }, capitalize(def.name)));
    const own = [
      h('button', { type: 'button', class: 'small', onclick: async () => {
        const url = await uploadPicture('photo');
        if (url) addItem({ type: 'photo', image: url });
      } }, 'Photo…'),
      h('button', { type: 'button', class: 'small', onclick: async () => {
        const url = await uploadModel();
        if (url) addItem({ type: 'model', model: url });
      } }, '3D model (.glb)…'),
    ];
    const item = settings.items.find((i) => i.id === selected);
    const missing = startingFurniture().filter((s) => !settings.items.some((i) => i.id === s.id));
    // What you're working on stays pinned at the top while you scroll the catalog.
    const pinned = item
      ? itemEditor(item)
      : removed
        ? h('div', { class: 'card pinned editor-head' },
            h('span', {}, `Removed the ${removed.name}.`),
            h('button', { type: 'button', class: 'small', onclick: undoRemove }, 'Undo'))
        : null;
    return h('div', { class: 'stack' },
      pinned,
      h('p', { class: 'house-help' }, 'Everything in the room can be moved, the sofa, TV, rug and pictures too: click a thing, then drag it. Wall things slide along any wall. Drag empty space to look around, scroll to zoom, right-drag to slide.'),
      h('div', { class: 'row-buttons' },
        h('button', { type: 'button', class: 'small', onclick: () => stage.view('room') }, 'See the whole room'),
        h('button', { type: 'button', class: 'small', onclick: () => stage.view('twin') }, 'Back to the twin')),
      h('div', { class: 'catalog' }, adds, own),
      item ? null : h('p', { class: 'house-help' }, settings.items.length ? `${settings.items.length} things in the room. Click one to change or remove it.` : 'The room is empty.'),
      missing.length
        ? h('button', { type: 'button', class: 'house-reset', onclick: () => {
            update({ items: [...settings.items, ...missing] });
            render();
          } }, 'Put the original furniture back')
        : null,
      settings.items.length
        ? h('button', { type: 'button', class: 'house-reset', onclick: () => {
            if (!confirm(`Take all ${settings.items.length} things out of the room, furniture included?`)) return;
            update({ items: [] });
            selected = null;
            render();
          } }, 'Empty the room')
        : null,
    );
  }

  function itemEditor(item) {
    const def = CATALOG[item.type];
    const patch = (changes, rebuild = true) => {
      update({ items: settings.items.map((i) => (i.id === item.id ? { ...i, ...changes } : i)) }, rebuild);
    };
    const turn = (by) => patch({ rot: (settings.items.find((i) => i.id === item.id)?.rot ?? 0) + by });
    const size = h('input', { type: 'range', id: 'house-item-size', min: 0.3, max: 3, step: 0.05, value: item.scale, oninput: () => patch({ scale: Number(size.value) }) });
    const parts = [
      h('div', { class: 'editor-head' },
        h('strong', {}, item.label && item.type !== 'poster' ? item.label : capitalize(def.name)),
        h('button', { type: 'button', class: 'small danger', title: 'Remove it (Delete key)', onclick: removeSelected }, 'Remove'),
        h('button', { type: 'button', class: 'small', title: 'Done with it (Esc)', 'aria-label': 'Deselect', onclick: deselect }, '✕')),
      def.place === 'floor'
        ? h('div', { class: 'row-buttons' }, h('span', { class: 'house-help' }, 'Turn'),
            h('button', { type: 'button', class: 'small', 'aria-label': 'Turn left', onclick: () => turn(-45) }, '⟲'),
            h('button', { type: 'button', class: 'small', 'aria-label': 'Turn right', onclick: () => turn(45) }, '⟳'))
        : h('p', { class: 'house-help' }, `On the ${item.wall} wall. Drag it to move it, even onto another wall.`),
      row('Size', size),
    ];
    if (def.color) {
      const color = h('input', { type: 'color', id: 'house-item-color', value: item.color, oninput: () => patch({ color: color.value }) });
      parts.push(row('Color', color));
    }
    if (item.type === 'photo' || item.type === 'model' || item.type === 'poster') {
      const label = h('input', { type: 'text', value: item.label, placeholder: item.type === 'photo' ? 'What the picture shows' : item.type === 'poster' ? 'What the poster is of' : 'What it is', 'aria-label': 'What it is', onchange: () => patch({ label: label.value }, false) });
      parts.push(label);
      if (item.type === 'photo') {
        parts.push(h('button', { type: 'button', class: 'small', onclick: async () => {
          const text = await describePicture(item.image);
          if (text) {
            patch({ label: text }, false);
            render();
          }
        } }, 'Describe it for me'));
      }
    }
    return h('div', { class: 'card stack pinned' }, parts);
  }

  function removeSelected() {
    const index = settings.items.findIndex((i) => i.id === selected);
    if (index < 0) return;
    const item = settings.items[index];
    const def = CATALOG[item.type];
    removed = { item, index, name: item.label && item.type !== 'poster' ? item.label : def.name };
    update({ items: settings.items.filter((i) => i.id !== item.id) });
    selected = null;
    stage.select(null);
    render();
  }

  function undoRemove() {
    if (!removed) return;
    const items = [...settings.items];
    items.splice(Math.min(removed.index, items.length), 0, removed.item);
    const id = removed.item.id;
    removed = null;
    update({ items });
    selected = id;
    setTimeout(() => stage.select(id), 200); // once the house is rebuilt
    render();
  }

  function deselect() {
    selected = null;
    stage.select(null);
    render();
  }

  // Delete (or Backspace) removes the selected thing, Esc lets go of it, and
  // Cmd/Ctrl+Z puts back the last one removed, while you're decorating.
  document.addEventListener('keydown', (event) => {
    if (panel.hidden || tab !== 'decorate') return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault();
      removeSelected();
    } else if (event.key === 'Escape' && selected) {
      deselect();
    } else if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey) && removed) {
      event.preventDefault();
      undoRemove();
    }
  });

  function addItem({ type, image, model }) {
    const def = CATALOG[type];
    // New things start somewhere free: floor things off to the sides (never between
    // you and the twin), wall things on bare stretches of wall (not over the window).
    const round = (v) => Math.round(v * 100) / 100;
    const count = settings.items.filter((i) => CATALOG[i.type].place === def.place).length;
    const wallSpots = [{ wall: 'right', z: -1.8, y: 1.7 }, { wall: 'left', z: 2.8, y: 1.6 }, { wall: 'back', x: -0.15, y: 2.25 }, { wall: 'right', z: 2.0, y: 1.7 }, { wall: 'left', z: -2.3, y: 1.9 }];
    const side = count % 2 ? 1 : -1;
    const item = def.place === 'wall'
      ? { id: newItemId(), type, x: 0, z: 0, rot: 0, scale: 1, ...wallSpots[count % wallSpots.length] }
      : { id: newItemId(), type, x: round(side * (1.3 + Math.random() * 0.8)), z: round(-1.2 + Math.random() * 1.6), y: 1.5, rot: 0, scale: 1 };
    if (image) item.image = image;
    if (model) item.model = model;
    if (def.color) item.color = def.color;
    update({ items: [...settings.items, item] });
    selected = item.id;
    setTimeout(() => stage.select(item.id), 200); // once the house is rebuilt
    render();
  }

  // ---- Uploads ----------------------------------------------------------------
  function chooseFile(accept) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept });
      input.addEventListener('change', () => resolve(input.files[0] ?? null));
      input.click();
    });
  }

  // Pictures are shrunk to at most 2048 px before uploading.
  async function uploadPicture(what) {
    const file = await chooseFile('image/*');
    if (!file) return null;
    status.textContent = `Uploading the ${what.toLowerCase()}…`;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const canvas = h('canvas', { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
      return await upload(blob, 'image/jpeg');
    } catch (err) {
      status.textContent = `Couldn't use that picture: ${err.message}`;
      return null;
    }
  }

  async function uploadModel() {
    const file = await chooseFile('.glb,model/gltf-binary');
    if (!file) return null;
    if (file.size > 40e6) {
      status.textContent = 'That model is too big (40 MB at most).';
      return null;
    }
    status.textContent = 'Uploading the model…';
    return upload(file, 'model/gltf-binary').catch((err) => {
      status.textContent = `Couldn't upload: ${err.message}`;
      return null;
    });
  }

  async function upload(body, type) {
    const res = await fetch('/api/house-asset', { method: 'POST', headers: { 'Content-Type': type }, body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `server error ${res.status}`);
    status.textContent = 'Uploaded.';
    return data.url;
  }

  async function describePicture(url) {
    status.textContent = 'Looking at the picture…';
    const res = await fetch('/api/describe-picture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const data = await res.json().catch(() => ({}));
    status.textContent = res.ok ? 'Described.' : data.error ?? `Couldn't describe it (${res.status}).`;
    return res.ok ? data.description : null;
  }

  // ---- Changes, saving, and the twin's reaction ------------------------------
  function update(changes, rebuild = true) {
    settings = cleanHouse({ ...settings, ...changes });
    changed(rebuild);
  }

  // `sudden`: something just landed right by the twin, so it reacts almost at once
  // (the way you'd jump), instead of waiting until you've finished decorating.
  function changed(rebuild = true, sudden = false) {
    if (rebuild) {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => onChange(settings), 120); // color pickers send many changes
    }
    clearTimeout(saveTimer);
    status.textContent = 'Saving…';
    saveTimer = setTimeout(save, 600);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, sudden ? 1200 : 5000); // otherwise the twin reacts once you've paused
  }

  async function save() {
    try {
      const res = await fetch('/api/house', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      if (!res.ok) throw new Error(`server error ${res.status}`);
      status.textContent = 'Saved.';
    } catch (err) {
      status.textContent = `Couldn't save: ${err.message}. The change is shown but will be lost on reload.`;
    }
  }

  async function settle() {
    clearTimeout(settleTimer);
    settleTimer = null;
    await saveNow();
    onSettled?.();
  }

  async function saveNow() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    await save();
  }

  function syncDecorating() {
    stage.setDecorating(!panel.hidden && tab === 'decorate', {
      onSelect: (id) => {
        selected = id;
        if (id) removed = null;
        render();
      },
      onMove: (id, where) => {
        settings = cleanHouse({ ...settings, items: settings.items.map((i) => (i.id === id ? { ...i, ...where } : i)) });
        const item = settings.items.find((i) => i.id === id);
        const nearTwin = item && CATALOG[item.type].place === 'floor' && Math.hypot(item.x, item.z) < 1.2; // it stands at (0, 0)
        changed(false, nearTwin); // already where it was dropped; no rebuild needed
      },
    });
  }

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    syncDecorating();
    if (!open && settleTimer) settle(); // closing the panel: react right away
  }

  button.addEventListener('click', () => toggle());
  render();
  return { settings: () => settings };
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
