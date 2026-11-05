// Puts the house (the House panel's settings, see public/house-config.js) into
// words, so the twin knows the room it's standing in, and notices when something
// changed since it last spoke, the way a person notices a repainted wall.
import { CATALOG, WALL_STYLES, phaseFor } from './public/house-config.js';

const VIEWS = { garden: 'a garden with a lawn, trees and a white fence', city: 'city buildings', lake: 'a lake with hills behind it' };
const FLOORS = { oak: 'light oak floorboards', walnut: 'dark walnut floorboards', tile: 'stone tiles', carpet: 'carpet' };
const OUTSIDE = { morning: 'early morning light', day: 'daylight', sunset: 'a sunset', night: 'night, with stars' };

export function describeHouse(house, now = new Date()) {
  const phase = phaseFor(house.timeOfDay, now);
  const lit = house.lights === 'on' || (house.lights === 'auto' && (phase === 'sunset' || phase === 'night'));
  const lines = [
    `You're standing in the middle of a living room with ${walls(house)} and ${FLOORS[house.floor]}, on a ${colorName(house.rugColor)} patterned rug.`,
    `Behind you on the left is a big window${house.curtains ? ' with linen curtains' : ''}, a small plant on the sill, looking out on ${outside(house)}. Outside it's ${OUTSIDE[phase]}.`,
    house.kitchen
      ? 'Behind you on the right, an open doorway leads into a kitchen with white cabinets, a fridge, pendant lights and a bowl of oranges on the counter.'
      : 'Behind you on the right is a closed door.',
    `To your left, along the side wall: ${list([house.tv && 'a TV on a low wooden console', house.bookshelf && 'a tall bookshelf full of books', 'a floor lamp in the corner'])}.`,
    `To your right: a ${colorName(house.sofaColor)} sofa with pillows, a coffee table with a couple of books and a mug, and a side table with a lamp${house.art ? ', with two framed abstract prints above the sofa' : ''}.`,
    [house.plants && 'A tall leafy plant stands in the back corner.', house.art && 'An abstract print hangs on the back wall.'].filter(Boolean).join(' '),
    house.items?.length ? `Things that were added to the room: ${list(house.items.slice(0, 30).map((i) => `${itemName(i)} ${where(i)}`))}.` : '',
    lit ? 'The lamps are on.' : phase === 'night' ? 'The lamps are off, so the room is dark apart from the moonlight.' : 'The lamps are off; the light comes from the window.',
  ];
  return lines.filter(Boolean).join(' ');
}

// What changed between two sets of settings, in words, or [] if nothing did.
export function houseChanges(before, after) {
  if (!before) return [];
  const out = [];
  const swap = (key, words) => before[key] !== after[key] && out.push(words(before[key], after[key]));
  if (walls(before ?? {}) !== walls(after)) out.push(`the walls changed from ${walls(before)} to ${walls(after)}`);
  swap('floor', (a, b) => `the floor changed from ${FLOORS[a]} to ${FLOORS[b]}`);
  swap('sofaColor', (a, b) => `the sofa changed from ${colorName(a)} to ${colorName(b)}`);
  swap('rugColor', (a, b) => `the rug changed from ${colorName(a)} to ${colorName(b)}`);
  if (outside(before) !== outside(after)) out.push(`the view out the window changed from ${outside(before)} to ${outside(after)}`);
  swap('lights', (a, b) => `the lamps were switched from "${a}" to "${b}"`);
  swap('timeOfDay', () => 'the light outside the window changed');
  const things = { kitchen: 'the kitchen through the doorway', tv: 'the TV', bookshelf: 'the bookshelf', plants: 'the plants', art: 'the pictures on the walls', curtains: 'the curtains' };
  for (const [key, name] of Object.entries(things)) {
    if (before[key] !== after[key]) out.push(after[key] ? `${name} appeared` : `${name} disappeared`);
  }
  // Things placed with Decorate: added, removed, moved, recolored, resized.
  const old = new Map((before.items ?? []).map((i) => [i.id, i]));
  const now = new Map((after.items ?? []).map((i) => [i.id, i]));
  for (const [id, item] of now) {
    const was = old.get(id);
    if (!was) out.push(`${itemName(item)} appeared ${where(item)}`);
    else {
      if (where(was) !== where(item) || Math.hypot(was.x - item.x, was.z - item.z, was.y - item.y) > 0.6) out.push(`${itemName(was)} was moved; it's now ${where(item)}`);
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
  const size = item.scale >= 2.2 ? 'huge ' : item.scale >= 1.5 ? 'big ' : item.scale <= 0.5 ? 'tiny ' : '';
  const name = item.label || (size ? def.name.replace(/^(big|giant) /, '') : def.name); // not "a huge giant spider"
  return withArticle(`${size}${def.color ? `${colorName(item.color)} ` : ''}${name}`);
}

// Roughly where a placed thing is, as you'd say it.
function where(item) {
  if (CATALOG[item.type]?.place === 'wall') return `on the ${item.wall ?? 'back'} wall`;
  const { x, z } = item;
  // You stand in the middle of the room (0, 0): close things are worth saying so.
  const away = Math.hypot(x, z);
  if (away < 1.1) return `right next to you (about ${Math.max(0.3, Math.round(away * 10) / 10)} m away)`;
  if (away < 1.8) return 'close to you'
    + (z < -0.5 ? ', behind you' : x < 0 ? ', on your right' : ', on your left');
  if (z < -1.6 && x > -2.5 && x < 0.3) return 'by the window';
  if (z < -1.6 && x > 0.6 && x < 2.3) return 'by the kitchen doorway';
  const side = x < -1.6 ? 'on the left' : x > 1.6 ? 'on the right' : '';
  const depth = z < -1.2 ? 'at the back' : z > 2.2 ? 'at the front of the room' : '';
  return [depth, side].filter(Boolean).join(' ') || 'in the middle of the room';
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
