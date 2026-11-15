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

async function generate(req) {
  const cfg = await getSettings();
  if (!cfg.apiKey) throw new Error("No OpenAI API key. Open extension settings (⚙️).");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: buildMessages(cfg, req),
      response_format: { type: "json_object" }
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI error ${res.status}`);

  const raw = data.choices?.[0]?.message?.content || "{}";
  let variants;
  try { variants = JSON.parse(raw).variants; } catch { variants = [raw]; }
  if (!Array.isArray(variants) || !variants.length) variants = [raw];
  return variants.map(v => String(v).trim()).filter(Boolean);
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
