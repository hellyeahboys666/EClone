// Puts the house (the House panel's settings, see public/house-config.js) into
// words, so the clone knows the room it's standing in, and notices when something
// changed since it last spoke, the way a person notices a repainted wall.
import { CATALOG, WALL_STYLES, cleanHouse, phaseFor } from './public/house-config.js';

const VIEWS = { garden: 'a garden with a lawn, trees and a white fence', city: 'city buildings', lake: 'a lake with hills behind it' };
const FLOORS = { oak: 'light oak floorboards', walnut: 'dark walnut floorboards', tile: 'stone tiles', carpet: 'carpet' };
const OUTSIDE = { morning: 'early morning light', day: 'daylight', sunset: 'a sunset', night: 'night, with stars' };

export function describeHouse(house, now = new Date()) {
  const phase = phaseFor(house.timeOfDay, now);
  const lit = house.lights === 'on' || (house.lights === 'auto' && (phase === 'sunset' || phase === 'night'));
  // Left and right are the clone's own: it faces you, so your left is its right.
  const things = house.items ?? [];
  const lines = [
    `You're standing in the middle of a living room with ${walls(house)} and ${FLOORS[house.floor]}, facing the person you're talking to.`,
    `Behind you on your right is a big window${house.curtains ? ' with linen curtains' : ''}, a small plant on the sill, looking out on ${outside(house)}. Outside it's ${OUTSIDE[phase]}.`,
    house.kitchen
      ? 'Behind you on your left, an open doorway leads into a kitchen with white cabinets, a fridge, pendant lights and a bowl of oranges on the counter.'
      : 'Behind you on your left is a closed door.',
    things.length
      ? `Around the room: ${things.slice(0, 40).map((i) => `${itemName(i)} ${where(i)}`).join('; ')}.`
      : 'Apart from that the room is completely empty: no furniture at all.',
    lit ? 'The lamps are on.' : phase === 'night' ? 'The lamps are off, so the room is dark apart from the moonlight.' : 'The lamps are off; the light comes from the window.',
  ];
  return lines.filter(Boolean).join(' ');
}

// What changed between two sets of settings, in words, or [] if nothing did.
export function houseChanges(before, after) {
  if (!before) return [];
  before = cleanHouse(before); // an older save, with the furniture built in, reads the same
  const out = [];
  const swap = (key, words) => before[key] !== after[key] && out.push(words(before[key], after[key]));
  if (walls(before ?? {}) !== walls(after)) out.push(`the walls changed from ${walls(before)} to ${walls(after)}`);
  swap('floor', (a, b) => `the floor changed from ${FLOORS[a]} to ${FLOORS[b]}`);
  if (outside(before) !== outside(after)) out.push(`the view out the window changed from ${outside(before)} to ${outside(after)}`);
  swap('lights', (a, b) => `the lamps were switched from "${a}" to "${b}"`);
  swap('timeOfDay', () => 'the light outside the window changed');
  const things = { kitchen: 'the kitchen through the doorway', curtains: 'the curtains' };
  for (const [key, name] of Object.entries(things)) {
    if (before[key] !== after[key]) out.push(after[key] ? `${name} appeared` : `${name} disappeared`);
  }
  // Everything in the room: added, removed, moved, turned, recolored, resized.
  const old = new Map((before.items ?? []).map((i) => [i.id, i]));
  const now = new Map((after.items ?? []).map((i) => [i.id, i]));
  for (const [id, item] of now) {
    const was = old.get(id);
    if (!was) out.push(`${itemName(item)} appeared ${where(item)}`);
    else {
      if (where(was) !== where(item) || Math.hypot(was.x - item.x, was.z - item.z, was.y - item.y) > 0.6) out.push(`${itemName(was)} was moved; it's now ${where(item)}`);
      const turned = Math.abs((((item.rot - was.rot) % 360) + 540) % 360 - 180);
      if (CATALOG[item.type]?.place === 'floor' && turned >= 40 && !item.type.includes('rug')) out.push(`${itemName(was)} was turned ${turned > 135 ? 'around' : 'to face another way'}`);
      if (was.color !== item.color) out.push(`${itemName(was)} is now ${colorName(item.color)}`);
      if (Math.abs(was.scale - item.scale) > 0.25) out.push(`${itemName(item)} got ${item.scale > was.scale ? 'bigger' : 'smaller'}`);
    }
  }
  for (const [id, item] of old) if (!now.has(id)) out.push(`${itemName(item)} that was ${where(item)} is gone`);
  return out.length > 10 ? [...out.slice(0, 10), `and ${out.length - 10} more changes`] : out;
}

const STYLE_NAMES = Object.fromEntries(WALL_STYLES);

// "sage green walls", "rust red brick walls", "walls covered in your wallpaper picture of ..."
function walls(house) {
  const style = house.wallStyle ?? 'paint';
  if (style === 'image') return `walls covered in a wallpaper picture${house.wallImageLabel ? ` of ${house.wallImageLabel}` : ''}`;
  if (style === 'brick') return 'exposed brick walls';
  if (style === 'panels') return 'wood-panelled walls';
  if (style === 'paint') return `${colorName(house.wallColor)} walls`;
  return `${colorName(house.wallColor)} walls with ${STYLE_NAMES[style].toLowerCase()}`;
}

function outside(house) {
  if (house.outsideImage) return house.outsideLabel || 'a view from a photo';
  return VIEWS[house.view];
}

// "a burnt orange beanbag", "a framed picture of a beach at sunset"
function itemName(item) {
  const def = CATALOG[item.type];
  if (item.type === 'photo') return `a framed picture${item.label ? ` of ${item.label}` : ''}`;
  if (item.type === 'model') return item.label ? withArticle(item.label) : 'a 3D model';
  const tint = def.color && !item.type.startsWith('print');
  const size = item.scale >= 2.2 ? 'huge ' : item.scale >= 1.5 ? 'big ' : item.scale <= 0.5 ? 'tiny ' : '';
  const name = item.label || (size ? def.name.replace(/^(big|giant) /, '') : def.name); // not "a huge giant spider"
  return withArticle(`${size}${tint ? `${colorName(item.color)} ` : ''}${name}`);
}

// Roughly where a thing is, as the clone would say it. It stands in the middle of the
// room (0, 0) facing the camera (+z), so -x is on its right and the back wall behind it.
// The walls are named as you see them: your left wall is on its right.
function where(item) {
  if (CATALOG[item.type]?.place === 'wall') return { back: 'on the wall behind you', left: 'on the wall to your right', right: 'on the wall to your left' }[item.wall ?? 'back'];
  const { x, z } = item;
  const away = Math.hypot(x, z);
  if (item.type.includes('rug') && away < 1.3 * item.scale) return 'on the floor around you';
  if (away < 1.1) return `right next to you (about ${Math.max(0.3, Math.round(away * 10) / 10)} m away)`;
  const ahead = z < -0.8 ? 'behind you' : z > 1.2 ? 'in front of you' : '';
  const side = x < -0.8 ? 'on your right' : x > 0.8 ? 'on your left' : '';
  let spot = '';
  if (Math.abs(x) > 2.6 && (z < -1.8 || z > 3.9)) spot = ', in the corner';
  else if (z < -1.6 && x > -2.5 && x < 0.3) spot = ', by the window';
  else if (z < -1.6 && x > 0.6 && x < 2.3) spot = ', by the kitchen doorway';
  else if (Math.abs(x) > 2.9 || z < -2.1) spot = ', against the wall';
  return `${away < 1.8 ? 'close to you, ' : ''}${[ahead, side].filter(Boolean).join(' ') || 'near you'}${spot}`;
}

function withArticle(words) {
  return /^(a|an|the|my|your)\s/i.test(words) ? words : `${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}`;
}

function list(items) {
  const xs = items.filter(Boolean);
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? 'nothing much';
}

// A plain color name for a #rrggbb value ("sage green", "off-white", "navy blue").
export function colorName(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  let h = 0;
  if (max !== min) {
    h = max === r ? (g - b) / (max - min) + (g < b ? 6 : 0) : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    h *= 60;
  }
  // How colorful it is: pale and greyish colors get neutral names.
  const chroma = max - min;
  if (chroma < 0.12 && l > 0.78) return h >= 20 && h < 70 && chroma > 0.03 ? 'warm off-white' : chroma < 0.03 && l > 0.93 ? 'white' : 'off-white';
  if (chroma < 0.08 || s < 0.1) {
    if (l > 0.9) return 'white';
    if (l > 0.8) return 'off-white';
    if (l > 0.6) return 'light gray';
    if (l > 0.35) return 'gray';
    if (l > 0.15) return 'charcoal';
    return 'black';
  }
  let name;
  if (h < 15 || h >= 345) name = 'red';
  else if (h < 40) name = l < 0.45 ? 'brown' : 'orange';
  else if (h < 65) name = l < 0.4 ? 'olive' : 'yellow';
  else if (h < 160) name = s < 0.35 ? 'sage green' : 'green';
  else if (h < 195) name = 'teal';
  else if (h < 255) name = s < 0.3 ? 'slate blue' : l < 0.3 ? 'navy blue' : 'blue';
  else if (h < 290) name = 'purple';
  else name = 'pink';
  if (name === 'red' && l < 0.45 && s < 0.6) name = 'rust red';
  if (name === 'orange' && chroma < 0.4) name = l > 0.72 ? 'beige' : l > 0.5 ? 'tan' : 'terracotta';
  if (name === 'yellow' && chroma < 0.3 && l > 0.7) name = 'cream';
  if (name === 'beige' || name === 'tan' || name === 'cream') return name;
  const shade = l > 0.75 ? 'pale ' : l > 0.6 ? 'light ' : l < 0.25 && !name.startsWith('navy') ? 'dark ' : '';
  return shade + name;
}
