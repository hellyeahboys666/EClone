// The twin's weekly schedule: activities like work, school or sleep, each on some
// days between two times. Shared by the server (what the twin is doing right now)
// and the Mind page (where you edit it). Saved in schedule.json.
//
// An activity: { id, name, note, days: ['mon', ...], start: '09:00', end: '17:00',
//   where: 'home' | 'away', busy: true | false, notice: minutes (0 = no announcement) }
// An end before the start runs past midnight (23:00 to 07:00 is an overnight sleep).

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_NAMES = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
export const NOTICE_OPTIONS = [0, 5, 10, 15, 20, 30];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Ready-made activities for the "Add" buttons on the Mind page.
export const PRESETS = [
  { name: 'Work', note: '', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00', where: 'away', busy: true, notice: 10 },
  { name: 'School', note: '', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '08:00', end: '15:00', where: 'away', busy: true, notice: 10 },
  { name: 'Sleep', note: '', days: DAYS, start: '23:00', end: '07:00', where: 'home', busy: true, notice: 0 },
  { name: 'Gym', note: '', days: ['tue', 'thu'], start: '18:00', end: '19:30', where: 'away', busy: true, notice: 5 },
  { name: 'Homework', note: '', days: ['mon', 'tue', 'wed', 'thu'], start: '16:00', end: '18:00', where: 'home', busy: true, notice: 0 },
];

// Keeps valid activities only, with every field in range.
export function cleanSchedule(input) {
  const list = Array.isArray(input?.activities) ? input.activities : [];
  return { activities: list.slice(0, 40).map(cleanActivity).filter(Boolean) };
}

function cleanActivity(a) {
  const name = String(a?.name ?? '').trim().slice(0, 40);
  const days = DAYS.filter((d) => Array.isArray(a?.days) && a.days.includes(d));
  if (!name || !days.length || !TIME.test(a.start) || !TIME.test(a.end) || a.start === a.end) return null;
  return {
    id: typeof a.id === 'string' && /^[a-z0-9]{4,16}$/.test(a.id) ? a.id : Math.random().toString(36).slice(2, 10),
    name,
    note: String(a.note ?? '').trim().slice(0, 200),
    days,
    start: a.start,
    end: a.end,
    where: a.where === 'away' ? 'away' : 'home',
    busy: a.busy !== false,
    notice: NOTICE_OPTIONS.includes(Number(a.notice)) ? Number(a.notice) : 0,
  };
}

// Every time an activity happens from yesterday to two days ahead, as real dates.
export function occurrences(schedule, now = new Date()) {
  const out = [];
  for (let offset = -1; offset <= 2; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    for (const a of schedule.activities) {
      if (!a.days.includes(DAYS[day.getDay()])) continue;
      const start = at(day, a.start);
      let end = at(day, a.end);
      if (end <= start) end = new Date(end.getTime() + 86_400_000); // past midnight
      out.push({ activity: a, start, end, key: `${a.id}|${day.toLocaleDateString('en-CA')}` });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

// What the twin is doing right now (the one that started most recently), or null.
export function currentActivity(schedule, now = new Date()) {
  return occurrences(schedule, now).filter((o) => o.start <= now && now < o.end).at(-1) ?? null;
}

// The next activity that hasn't started yet, or null.
export function nextActivity(schedule, now = new Date()) {
  return occurrences(schedule, now).find((o) => o.start > now) ?? null;
}

// "9:00 AM"
export function clock(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// "Mon–Fri", "Every day", "Tue, Thu"
export function dayList(days) {
  if (days.length === 7) return 'Every day';
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
  if (days.length === 5 && weekdays.every((d) => days.includes(d))) return 'Mon–Fri';
  if (days.length === 2 && days.includes('sat') && days.includes('sun')) return 'Weekends';
  return DAYS.filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join(', ');
}

function at(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}
