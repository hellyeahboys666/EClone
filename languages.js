// Languages the clone can have a voice for, and working out which one a sentence is
// in, so each sentence is said in the right voice. Writing systems (Chinese, Japanese,
// Korean, Russian, Arabic...) are told apart by their characters; languages that share
// the Latin alphabet, by their common little words. Only the languages that have a
// voice are considered, which keeps the guess reliable.

export const LANGUAGES = [
  { code: 'en', name: 'English', sample: "Hey, it's {name}. Does this sound like me?" },
  { code: 'zh', name: 'Chinese (中文)', sample: '嘿，我是{name}。这听起来像我吗？' },
  { code: 'ja', name: 'Japanese (日本語)', sample: 'やあ、{name}だよ。これ、私の声っぽい？' },
  { code: 'ko', name: 'Korean (한국어)', sample: '안녕, 나 {name}이야. 이거 내 목소리 같아?' },
  { code: 'es', name: 'Spanish (Español)', sample: 'Hola, soy {name}. ¿Suena como yo?' },
  { code: 'fr', name: 'French (Français)', sample: "Salut, c'est {name}. Est-ce que ça sonne comme moi ?" },
  { code: 'de', name: 'German (Deutsch)', sample: 'Hey, ich bin {name}. Klingt das wie ich?' },
  { code: 'pt', name: 'Portuguese (Português)', sample: 'Oi, é o {name}. Parece comigo?' },
  { code: 'it', name: 'Italian (Italiano)', sample: 'Ciao, sono {name}. Sembra la mia voce?' },
  { code: 'nl', name: 'Dutch (Nederlands)', sample: 'Hoi, ik ben {name}. Klinkt dit als mij?' },
  { code: 'pl', name: 'Polish (Polski)', sample: 'Hej, tu {name}. Czy to brzmi jak ja?' },
  { code: 'tr', name: 'Turkish (Türkçe)', sample: 'Selam, ben {name}. Bu bana benziyor mu?' },
  { code: 'id', name: 'Indonesian (Bahasa Indonesia)', sample: 'Hai, ini {name}. Apakah ini terdengar seperti aku?' },
  { code: 'vi', name: 'Vietnamese (Tiếng Việt)', sample: 'Chào, mình là {name}. Nghe có giống mình không?' },
  { code: 'tl', name: 'Filipino (Tagalog)', sample: 'Uy, si {name} ito. Parang ako ba ito?' },
  { code: 'ru', name: 'Russian (Русский)', sample: 'Привет, это {name}. Похоже на меня?' },
  { code: 'uk', name: 'Ukrainian (Українська)', sample: 'Привіт, це {name}. Схоже на мене?' },
  { code: 'el', name: 'Greek (Ελληνικά)', sample: 'Γεια, είμαι ο {name}. Ακούγεται σαν εμένα;' },
  { code: 'ar', name: 'Arabic (العربية)', sample: 'مرحبًا، أنا {name}. هل يبدو هذا مثل صوتي؟' },
  { code: 'he', name: 'Hebrew (עברית)', sample: 'היי, זה {name}. זה נשמע כמוני?' },
  { code: 'hi', name: 'Hindi (हिन्दी)', sample: 'हाय, मैं {name} हूँ। क्या यह मेरी तरह लगता है?' },
  { code: 'th', name: 'Thai (ไทย)', sample: 'หวัดดี นี่ {name} นะ ฟังดูเหมือนเราไหม' },
];
export const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

// Writing systems that point to one language (or a few, told apart below).
const SCRIPTS = [
  ['ja', /[぀-ヿ]/g], // kana: Japanese, even with kanji in between
  ['ko', /[가-힯ᄀ-ᇿ]/g],
  ['zh', /[一-鿿㐀-䶿]/g],
  ['th', /[฀-๿]/g],
  ['hi', /[ऀ-ॿ]/g],
  ['ar', /[؀-ۿ]/g],
  ['he', /[֐-׿]/g],
  ['el', /[Ͱ-Ͽ]/g],
  ['cyrillic', /[Ѐ-ӿ]/g],
];

// Short, common words that give a Latin-alphabet language away.
const WORDS = {
  en: 'the and you that is it to of what i my me but just not was are have this with for so do',
  es: 'el la que de y es en los las un una por con para pero no muy yo tú qué cómo está estoy',
  fr: 'le la les et est un une je tu que qui pas ne mais très avec pour moi toi c’est cest ça suis',
  de: 'der die das und ist nicht ich du ein eine mit auf aber sehr was wie bin auch noch',
  pt: 'o a os as e é um uma que de não com para mas muito eu você está tá isso',
  it: 'il la che di e è un una non per con ma molto io tu sono sei cosa come anche',
  nl: 'de het een en is niet ik je jij dat wat met maar ook van zijn heel',
  pl: 'i w nie to jest się że na z co jak ale tak ja ty czy bardzo',
  tr: 've bir bu ne ben sen değil mi çok ama için gibi var yok',
  id: 'yang dan aku kamu ini itu tidak apa di ke dengan sudah juga saya banget',
  vi: 'là và không có của tôi bạn mình này đó được rất thì',
  tl: 'ang ng sa na ko mo ako ikaw hindi ba po lang talaga yung',
};
const WORD_SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

// The language a sentence is in, out of `candidates` (codes with a voice), or null
// when it can't tell (a short "ok!" is left to the main voice).
export function detectLanguage(text, candidates) {
  const pool = new Set(candidates);
  if (!pool.size) return null;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (!letters) return null;
  // Writing systems first: a sentence that is mostly one script is in that language.
  let best = null;
  for (const [code, re] of SCRIPTS) {
    const n = (text.match(re) ?? []).length;
    if (!n) continue;
    // Japanese mixes kana with kanji (Chinese characters): count both for it.
    const count = code === 'ja' ? n + (text.match(/[一-鿿]/g) ?? []).length : n;
    if (!best || count > best.count) best = { code, count };
  }
  if (best && best.count / letters >= 0.3) {
    if (best.code === 'cyrillic') return pool.has('uk') && /[іїєґ]/i.test(text) ? 'uk' : pool.has('ru') ? 'ru' : pool.has('uk') ? 'uk' : null;
    return pool.has(best.code) ? best.code : null;
  }
  // Latin alphabet: count the little words of each candidate language.
  const words = text.toLowerCase().replace(/[’']/g, '’').match(/[\p{L}’]+/gu) ?? [];
  let top = null;
  let second = 0;
  for (const code of pool) {
    const set = WORD_SETS[code];
    if (!set) continue;
    let score = words.filter((w) => set.has(w) || set.has(w.replace(/’/g, ''))).length;
    if (code === 'vi' && /[ăâđêôơư]/i.test(text)) score += 3; // letters only Vietnamese uses
    if (code === 'es' && /[ñ¿¡]/.test(text)) score += 2;
    if (code === 'de' && /[ß]|\b\w*[äöü]\w*\b/i.test(text)) score += 1;
    if (!top || score > top.score) (second = top?.score ?? 0), (top = { code, score });
    else if (score > second) second = score;
  }
  return top && top.score > 0 && top.score > second ? top.code : null;
}
