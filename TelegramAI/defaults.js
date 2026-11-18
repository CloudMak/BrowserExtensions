// Shared defaults (loaded by background.js and options.js)
const TGAI_DEFAULTS = {
  apiKey: "",
  model: "gpt-6.1-terra",
  language: "auto",           // auto | Russian | English | ...
  variants: 3,
  contextMessages: 15,
  persona: "I'm Maksim. I write casually, friendly, short, no emojis overload.",
  characters: [
    "Elon Musk",
    "Alex Lesley",
    "Steve Jobs",
    "Tony Robbins",
    "Jordan Peterson",
    "Gary Vaynerchuk",
    "Keanu Reeves",
    "Jason Statham"
  ].join("\n"),
  prompts: {
    hello: "Write an opening message to say hello. It must NOT be generic ('Hi, how are you' is forbidden). Hook the person with something light, curious or playful that makes them want to reply.",
    ask: "Write a message that asks the person an interesting, open question that is easy and pleasant to answer and keeps the conversation going.",
    invite: "Write a message inviting the person to something (meet, call, event, activity). Concrete, low-pressure, easy to say yes to.",
    improve: "Rewrite the draft into a clearly better message: more engaging, confident, vivid and natural. Stronger hook, better word choice, no filler, no awkward phrasing, correct grammar. Keep the core intent and the language, but rephrase and restructure freely — a result that looks almost like the draft is a failure. Make variants progressively bolder: first polished, then more charismatic, then the most creative."
  }
};

// Message tones (shown in the 🎨 tone picker)
const TGAI_TONES = [
  ["Twitter Style", "Short, bold and witty, ending with a punchline."],
  ["Corporate Bullshit", "Maximum corporate jargon and buzzwords, minimum concrete substance."],
  ["Alpha / Dominant", "Confident and directive, no excuses, no hedging, no apologies."],
  ["Diplomatic", "Polite and tactful, smooth wording, never a blunt refusal."],
  ["Passive Aggressive", "Polite on the surface, with a clearly unpleasant undertone."],
  ["Sarcastic", "Irony, mockery and biting remarks."],
  ["Intellectual Snob", "Complex sentences and rare words, showing off intellectual superiority."],
  ["Philosophical", "Deep and abstract, with philosophical generalizations."],
  ["Flirty", "Playful, with hints and light provocation."],
  ["Mysterious", "Enigmatic, understated, leaves things unsaid, intriguing."],
  ["Comedian", "Jokes, unexpected comparisons, absurd humor."],
  ["Manipulative", "Applies pressure through emotions, guilt or social expectations."],
  ["Lawyer", "Legally careful, full of caveats, reservations and clarifications."],
  ["Politician", "Many words, evasive, avoids giving a direct answer."],
  ["Motivational Guru", "Grandiose and inspiring, with loud bold claims."],
  ["Gen Z / Brainrot", "Memes, slang and internet culture."],
  ["Brutally Honest", "Extremely direct, no softening at all."],
  ["Aristocratic", "Haughty, elegant and restrained."],
  ["Absurdist", "Ridiculous, surreal and unexpected."],
  ["Minimalist", "Maximum meaning with minimum words."]
].map(([name, desc]) => ({ name, desc }));

// Old default prompts that should be replaced by the new defaults if still stored unchanged
const TGAI_LEGACY_PROMPTS = {
  hello: ["Write a fresh, interesting opening message to say hello. Not generic, not 'Hi, how are you'. Hook the person with something light and specific to the chat if possible."],
  improve: ["Improve the draft: make it clearer, more natural and engaging. Keep the meaning, the language and roughly the length. Fix grammar."]
};

function tgaiMerge(stored) {
  const prompts = { ...TGAI_DEFAULTS.prompts };
  for (const [k, v] of Object.entries(stored.prompts || {})) {
    if (v && !(TGAI_LEGACY_PROMPTS[k] || []).includes(v)) prompts[k] = v;
  }
  return { ...TGAI_DEFAULTS, ...stored, prompts };
}
