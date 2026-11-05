// The house's settings: what each one can be, the defaults, and a cleaner that
// keeps only valid values. Shared by the page (the House panel) and the server
// (which saves them to house.json).

export const HOUSE_FIELDS = [
  { key: 'timeOfDay', label: 'Time of day', type: 'choice', options: [['auto', "Follow this Mac's clock"], ['morning', 'Morning'], ['day', 'Day'], ['sunset', 'Sunset'], ['night', 'Night']] },
  { key: 'lights', label: 'Lamps', type: 'choice', options: [['auto', 'On when it gets dark'], ['on', 'On'], ['off', 'Off']] },
  { key: 'view', label: 'View outside', type: 'choice', options: [['garden', 'Garden'], ['city', 'City'], ['lake', 'Lake']] },
  { key: 'wallColor', label: 'Walls', type: 'color' },
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

export const HOUSE_DEFAULTS = {
  timeOfDay: 'auto',
  lights: 'auto',
  view: 'garden',
  wallColor: '#e6e0d6',
  floor: 'oak',
  sofaColor: '#56677a',
  rugColor: '#a3553f',
  kitchen: true,
  tv: true,
  bookshelf: true,
  plants: true,
  art: true,
  curtains: true,
};

// Keeps known settings with valid values; anything else falls back to the default.
export function cleanHouse(input) {
  const out = { ...HOUSE_DEFAULTS };
  for (const field of HOUSE_FIELDS) {
    const value = input?.[field.key];
    if (field.type === 'choice' && field.options.some(([v]) => v === value)) out[field.key] = value;
    if (field.type === 'color' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) out[field.key] = value.toLowerCase();
    if (field.type === 'toggle' && typeof value === 'boolean') out[field.key] = value;
  }
  return out;
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
