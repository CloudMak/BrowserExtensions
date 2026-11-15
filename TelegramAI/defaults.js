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
