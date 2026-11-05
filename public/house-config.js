// The house's settings: what each one can be, the defaults, and a cleaner that
// keeps only valid values. Shared by the page (the House panel) and the server
// (which saves them to house.json).
//
// Besides the simple settings below, a house has:
//   wallImage / wallImageLabel      your own picture as wallpaper (wallStyle 'image')
//   outsideImage / outsideLabel     your own picture as the view out of the window
//   items                           things you placed: [{ id, type, x, z, y, wall, rot, scale, color, image, model, label }]
// Pictures and models are uploaded to house-assets/ and referenced as /house-assets/<file>.

export const WALL_STYLES = [
  ['paint', 'Plain paint'], ['stripes', 'Striped wallpaper'], ['dots', 'Polka-dot wallpaper'], ['floral', 'Floral wallpaper'],
  ['brick', 'Exposed brick'], ['panels', 'Wood panelling'], ['image', 'My own picture'],
];

export const HOUSE_FIELDS = [
  { key: 'timeOfDay', label: 'Time of day', type: 'choice', options: [['auto', "Follow this Mac's clock"], ['morning', 'Morning'], ['day', 'Day'], ['sunset', 'Sunset'], ['night', 'Night']] },
  { key: 'lights', label: 'Lamps', type: 'choice', options: [['auto', 'On when it gets dark'], ['on', 'On'], ['off', 'Off']] },
  { key: 'view', label: 'View outside', type: 'choice', options: [['garden', 'Garden'], ['city', 'City'], ['lake', 'Lake']] },
  { key: 'wallColor', label: 'Walls', type: 'color' },
  { key: 'wallStyle', label: 'Wall finish', type: 'choice', options: WALL_STYLES },
  { key: 'floor', label: 'Floor', type: 'choice', options: [['oak', 'Light oak'], ['walnut', 'Walnut'], ['tile', 'Stone tile'], ['carpet', 'Carpet']] },
  { key: 'sofaColor', label: 'Sofa', type: 'color' },
  { key: 'rugColor', label: 'Rug', type: 'color' },
  { key: 'kitchen', label: 'Kitchen through the doorway', type: 'toggle' },
  { key: 'tv', label: 'TV', type: 'toggle' },
  { key: 'bookshelf', label: 'Bookshelf', type: 'toggle' },
  { key: 'plants', label: 'Plants', type: 'toggle' },
  { key: 'art', label: 'Pictures on the walls', type: 'toggle' },
  { key: 'curtains', label: 'Curtains', type: 'toggle' },
];

// Things you can place. `place` is the floor or a wall; `color` is the default for
// things you can recolor; `image` and `model` need an uploaded picture or 3D model.
export const CATALOG = {
  armchair: { name: 'armchair', place: 'floor', color: '#8a6f5a' },
  beanbag: { name: 'beanbag', place: 'floor', color: '#c9772f' },
  'side-table': { name: 'side table', place: 'floor' },
  desk: { name: 'desk with a laptop', place: 'floor' },
  'desk-chair': { name: 'desk chair', place: 'floor', color: '#3a3f4a' },
  'floor-lamp': { name: 'floor lamp', place: 'floor', color: '#efe5d3' },
  'plant-tall': { name: 'tall leafy plant', place: 'floor' },
  'plant-small': { name: 'small potted plant', place: 'floor' },
  cactus: { name: 'cactus', place: 'floor' },
  flowers: { name: 'vase of flowers', place: 'floor', color: '#e0546a' },
  bookcase: { name: 'small bookcase', place: 'floor' },
  guitar: { name: 'guitar on a stand', place: 'floor', color: '#b5652b' },
  telescope: { name: 'telescope', place: 'floor' },
  'rug-round': { name: 'round rug', place: 'floor', color: '#6b8f9e' },
  aquarium: { name: 'fish tank', place: 'floor' },
  speaker: { name: 'speaker', place: 'floor' },
  flatscreen: { name: 'big flatscreen TV', place: 'floor' },
  teddy: { name: 'teddy bear', place: 'floor', color: '#a0703c' },
  spider: { name: 'giant toy spider', place: 'floor', color: '#1f1b1a' },
  photo: { name: 'framed picture', place: 'wall', image: true },
  poster: { name: 'poster', place: 'wall', color: '#d9a441' },
  clock: { name: 'wall clock', place: 'wall' },
  shelf: { name: 'wall shelf', place: 'wall' },
  'string-lights': { name: 'string lights', place: 'wall', color: '#ffd27a' },
  model: { name: '3D model', place: 'floor', model: true },
};

export const MAX_ITEMS = 80;

export const HOUSE_DEFAULTS = {
  timeOfDay: 'auto',
  lights: 'auto',
  view: 'garden',
  wallColor: '#e6e0d6',
  wallStyle: 'paint',
  floor: 'oak',
  sofaColor: '#56677a',
  rugColor: '#a3553f',
  kitchen: true,
  tv: true,
  bookshelf: true,
  plants: true,
  art: true,
  curtains: true,
  wallImage: null,
  wallImageLabel: '',
  outsideImage: null,
  outsideLabel: '',
  items: [],
};

const HEX = /^#[0-9a-f]{6}$/i;
const IMAGE = /^\/house-assets\/[a-z0-9-]{6,40}\.(jpg|png|webp)$/;
const MODEL = /^\/house-assets\/[a-z0-9-]{6,40}\.glb$/;
const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

// Keeps known settings with valid values; anything else falls back to the default.
export function cleanHouse(input) {
  const out = { ...HOUSE_DEFAULTS, items: [] };
  for (const field of HOUSE_FIELDS) {
    const value = input?.[field.key];
    if (field.type === 'choice' && field.options.some(([v]) => v === value)) out[field.key] = value;
    if (field.type === 'color' && typeof value === 'string' && HEX.test(value)) out[field.key] = value.toLowerCase();
    if (field.type === 'toggle' && typeof value === 'boolean') out[field.key] = value;
  }
  out.wallImage = IMAGE.test(input?.wallImage ?? '') ? input.wallImage : null;
  out.wallImageLabel = text(input?.wallImageLabel, 80);
  out.outsideImage = IMAGE.test(input?.outsideImage ?? '') ? input.outsideImage : null;
  out.outsideLabel = text(input?.outsideLabel, 80);
  if (out.wallStyle === 'image' && !out.wallImage) out.wallStyle = 'paint';
  const seen = new Set();
  for (const raw of Array.isArray(input?.items) ? input.items.slice(0, MAX_ITEMS) : []) {
    const item = cleanItem(raw);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      out.items.push(item);
    }
  }
  return out;
}

function cleanItem(raw) {
  const def = CATALOG[raw?.type];
  if (!def) return null;
  const num = (value, lo, hi, fallback) => (Number.isFinite(Number(value)) ? Math.min(hi, Math.max(lo, Number(value))) : fallback);
  const item = {
    id: typeof raw.id === 'string' && /^[a-z0-9]{4,16}$/.test(raw.id) ? raw.id : newItemId(),
    type: raw.type,
    x: num(raw.x, -3.5, 3.5, 0),
    z: num(raw.z, -2.5, 4.5, 1),
    y: num(raw.y, 0.25, 2.5, 1.5),
    rot: num(raw.rot, -360, 360, 0),
    scale: num(raw.scale, 0.3, 3, 1),
    label: text(raw.label, 80),
  };
  if (def.place === 'wall') item.wall = ['back', 'left', 'right'].includes(raw.wall) ? raw.wall : 'back';
  if (def.color) item.color = typeof raw.color === 'string' && HEX.test(raw.color) ? raw.color.toLowerCase() : def.color;
  if (def.image) {
    if (!IMAGE.test(raw.image ?? '')) return null;
    item.image = raw.image;
  }
  if (def.model) {
    if (!MODEL.test(raw.model ?? '')) return null;
    item.model = raw.model;
  }
  return item;
}

export function newItemId() {
  return Math.random().toString(36).slice(2, 10);
}

// What "Follow this Mac's clock" means right now.
export function phaseFor(timeOfDay, date = new Date()) {
  if (timeOfDay !== 'auto') return timeOfDay;
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5.5 && h < 9) return 'morning';
  if (h >= 9 && h < 17) return 'day';
  if (h >= 17 && h < 19.5) return 'sunset';
  return 'night';
}
