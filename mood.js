// The twin's mood: one feeling at a time, with an intensity from 0 to 10. Like a
// person's, a feeling comes from what just happened, lingers after it, and fades
// back to the twin's usual self. It's saved in memory/mood.json, so it carries over
// between conversations and restarts.
//
// The brain says how the twin feels at the start of each reply, in a hidden tag
// like [mood: annoyed 6 | they brushed off my point]. The server takes the tag off
// before the reply is shown or spoken.
import { formatTime, loadJson, saveJson } from './memory.js';

export const HALF_LIFE_HOURS = 2; // an 8/10 feeling is a 4 two hours later, and gone in about five
const FADED = 1.5; // below this the feeling has worn off
const MENTION_HOURS = 24; // a worn-off feeling is still mentioned for this long

// The feelings the twin can report. The page maps each one to a facial expression.
export const FEELINGS = [
  'calm', 'happy', 'amused', 'excited', 'proud', 'grateful', 'curious', 'surprised', 'confused',
  'skeptical', 'bored', 'tired', 'nervous', 'worried', 'sympathetic', 'embarrassed', 'annoyed', 'angry', 'hurt', 'sad',
  'delighted', 'startled', 'scared', 'disgusted', 'relieved',
];

export function createMood({ file }) {
  let state = null; // { feeling, intensity, reason, since, at }

  async function load() {
    state = await loadJson(file, null);
  }

  // How strong the feeling is now, after fading since it was last felt.
  function level(now = Date.now()) {
    if (!state) return 0;
    return state.intensity * 0.5 ** ((now - state.at) / 3_600_000 / HALF_LIFE_HOURS);
  }

  async function set({ feeling, intensity, reason }) {
    const now = Date.now();
    const continuing = state && state.feeling === feeling && level(now) >= FADED;
    state = { feeling, intensity, reason, since: continuing ? state.since : now, at: now };
    await saveJson(file, state);
  }

  // For the brain: how the twin feels right now, in plain words.
  function describe() {
    const now = Date.now();
    const usual = "Right now you're calm, your usual self.";
    if (!state || state.feeling === 'calm') return usual;
    const because = state.reason ? ` (${state.reason})` : '';
    const strength = level(now);
    if (strength < FADED) {
      if (now - state.at > MENTION_HOURS * 3_600_000) return usual;
      return `${usual} Earlier, on ${formatTime(state.at)}, you felt ${state.feeling}${because}, but it has worn off.`;
    }
    const rounded = Math.round(strength);
    const fading = rounded < state.intensity ? `, down from ${state.intensity}/10 on ${formatTime(state.at)}` : '';
    const since = state.since < state.at ? ` You've felt this way since ${formatTime(state.since)}.` : '';
    return `Right now you feel ${state.feeling}, about ${rounded}/10${fading}${because}.${since}`;
  }

  // The feeling as it stands now, rounded, for replies that didn't report one.
  function current() {
    const strength = Math.round(level());
    return state && strength >= FADED ? { feeling: state.feeling, intensity: strength } : { feeling: 'calm', intensity: 0 };
  }

  // For the page: enough to fade the avatar's expression by itself.
  function snapshot() {
    return { ...(state ?? { feeling: 'calm', intensity: 0, at: Date.now() }), halfLifeHours: HALF_LIFE_HOURS };
  }

  // Back to calm (from the Mind page).
  async function reset() {
    const now = Date.now();
    state = { feeling: 'calm', intensity: 0, since: now, at: now };
    await saveJson(file, state);
  }

  return { load, set, describe, current, snapshot, reset };
}

// The tag as it appears at the start of a reply, also used to show the brain how it
// felt in earlier replies.
export function moodTag({ feeling, intensity, reason }) {
  return `[mood: ${feeling} ${intensity}${reason ? ` | ${reason}` : ''}]`;
}

// Reads the tag loosely ("annoyed 6", "Annoyed 6/10", "calm 0-10", "a bit annoyed, 6"),
// because any [mood ...] at the start must be hidden even if it's oddly written.
function parseTag(text) {
  const m = text.match(/^\[\s*mood\b([^\]]*)\]\s*/i);
  if (!m) return null;
  const [main, ...why] = m[1].replace(/^\s*:/, '').split('|');
  const words = main.toLowerCase().match(/[a-z]+/g) ?? [];
  const feeling = words.find((w) => FEELINGS.includes(w)) ?? words[0] ?? 'calm';
  const number = main.match(/\d+(?:\.\d+)?/);
  const intensity = number ? Math.min(10, Math.max(0, Math.round(Number(number[0])))) : 3;
  const reason = why.join('|').trim().slice(0, 200);
  return { mood: { feeling, intensity, ...(reason && { reason }) }, rest: text.slice(m[0].length) };
}

// Splits a mood tag off the start of a saved reply (replies saved while a tag
// slipped through), so it's never shown or fed back to the brain as plain text.
export function splitMoodTag(text) {
  const tag = parseTag(text.trimStart());
  return tag ? { mood: tag.mood, text: tag.rest.trimStart() } : { mood: null, text };
}

// Reads a reply as it streams in and takes a mood tag off the front, if there is
// one. push() returns the text that's safe to show; end() returns whatever was
// still held back when the reply finished.
export function createTagReader(onMood) {
  let head = '';
  let decided = false;
  let afterTag = false; // drop the space between the tag and the reply

  function decide(text) {
    decided = true;
    const tag = parseTag(text);
    if (!tag) return text;
    onMood(tag.mood);
    afterTag = true;
    return trim(tag.rest);
  }

  function trim(text) {
    if (!afterTag) return text;
    const rest = text.trimStart();
    if (rest) afterTag = false;
    return rest;
  }

  return {
    push(text) {
      if (decided) return trim(text);
      head += text;
      const start = head.trimStart();
      if (!start) return '';
      if (start[0] !== '[') return decide(start);
      // Hold the text back until the tag closes (or clearly isn't one).
      if (!start.includes(']') && start.length < 300) return '';
      return decide(start);
    },
    end() {
      if (decided) return '';
      const start = head.trimStart();
      // A reply cut off in the middle of its tag has nothing to show yet.
      if (/^\[\s*mood\b/i.test(start) && !start.includes(']')) return '';
      return decide(start);
    },
  };
}
