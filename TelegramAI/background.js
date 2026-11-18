importScripts("defaults.js");

const HELLO_ANGLES = [
  "a playful observation", "an unexpected curious question", "a light self-ironic joke",
  "a bold confident statement", "a mini story in one line", "an intriguing 'random fact' hook",
  "a funny hypothetical situation", "a warm, simple but original greeting", "a light challenge or game",
  "a reference to the time of day or season"
];

async function getSettings() {
  return tgaiMerge(await chrome.storage.local.get(null));
}

function buildMessages(cfg, req) {
  const tone = TGAI_TONES.find(t => t.name === req.tone);
  const lang = cfg.language === "auto"
    ? (req.useContext
        ? "Use the same language as the chat history (or the draft). If unclear, use Russian."
        : "Use the language of the draft or extra instruction if any; otherwise Russian.")
    : `Write in ${cfg.language}.`;

  const system = [
    "You write Telegram messages on behalf of the user.",
    `About the user / style: ${cfg.persona}`,
    lang,
    req.style
      ? `VOICE: write in the recognizable manner of ${req.style} — their typical vocabulary, rhythm, attitude, worldview and signature turns of phrase. Make the style clearly noticeable. Do not mention or sign as ${req.style}.`
      : "",
    tone ? `TONE: ${tone.name} — ${tone.desc} Make this tone unmistakable in every variant.` : "",
    req.words ? `LENGTH: every variant must contain EXACTLY ${req.words} words. Count the words before answering.` : "",
    "Sound like a real person texting: natural, no clichés, no hashtags, no quotes around the message.",
    "If the user gives an EXTRA INSTRUCTION, it has the highest priority: follow it exactly, even if it conflicts with the default task wording.",
    `Return JSON: {"variants": ["...", "..."]} with exactly ${cfg.variants} clearly different variants.`
  ].filter(Boolean).join("\n");

  const parts = [];
  if (req.useContext) {
    const history = (req.history || []).map(m => `${m.own ? "Me" : "Them"}: ${m.text}`).join("\n") || "(no messages yet)";
    parts.push(`Chat: ${req.chatTitle || "unknown"}`, `Recent messages:\n${history}`);
  } else if (req.mode !== "improve") {
    const angle = HELLO_ANGLES[Math.floor(Math.random() * HELLO_ANGLES.length)];
    parts.push(`Ignore any previous conversation — write from scratch, completely original. Suggested angle: ${angle}.`);
  }

  if (req.draft) parts.push(`DRAFT to improve:\n"""${req.draft}"""`);
  parts.push(`Task: ${cfg.prompts[req.mode] || cfg.prompts.hello}`);
  if (req.avoid?.length) parts.push(`Do not repeat or paraphrase these earlier suggestions:\n- ${req.avoid.join("\n- ")}`);
  if (req.extra) parts.push(`EXTRA INSTRUCTION (highest priority): ${req.extra}`);

  return [{ role: "system", content: system }, { role: "user", content: parts.join("\n\n") }];
}

const countWords = s => s.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;

async function chat(cfg, messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, response_format: { type: "json_object" } })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI error ${res.status}`);
  const raw = data.choices?.[0]?.message?.content || "{}";
  let variants;
  try { variants = JSON.parse(raw).variants; } catch { variants = [raw]; }
  if (!Array.isArray(variants) || !variants.length) variants = [raw];
  return { raw, variants: variants.map(v => String(v).trim()).filter(Boolean) };
}

async function generate(req) {
  const cfg = await getSettings();
  if (!cfg.apiKey) throw new Error("No OpenAI API key. Open extension settings (⚙️).");

  const messages = buildMessages(cfg, req);
  let { raw, variants } = await chat(cfg, messages);

  // Word target: one corrective pass if any variant misses the count
  const n = req.words;
  if (n) {
    const tol = Math.max(1, Math.round(n * 0.1));
    const counts = variants.map(countWords);
    if (counts.some(c => Math.abs(c - n) > tol)) {
      try {
        ({ variants } = await chat(cfg, [
          ...messages,
          { role: "assistant", content: raw },
          { role: "user", content: `Word counts are ${counts.join(", ")}, but each variant must have exactly ${n} words. Rewrite every variant to exactly ${n} words, keeping its idea, tone and language. Same JSON format.` }
        ]));
      } catch {}
    }
  }
  return variants;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "tgai-generate") {
    generate(msg.payload)
      .then(variants => sendResponse({ ok: true, variants }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "tgai-characters") {
    getSettings().then(cfg => sendResponse(cfg.characters.split("\n").map(s => s.trim()).filter(Boolean)));
    return true;
  }
  if (msg.type === "tgai-options") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
