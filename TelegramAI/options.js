const $ = id => document.getElementById(id);
const FIELDS = ["apiKey", "model", "language", "variants", "contextMessages", "persona", "characters"];
const MODES = ["hello", "ask", "invite", "improve"];
const FALLBACK_MODELS = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"];
const EXCLUDE = /audio|realtime|tts|transcribe|whisper|image|search|embedding|instruct|moderation|codex|dall-e|sora|computer-use|deep-research/;

function fillModels(list, current) {
  const ids = [...new Set([current, ...list].filter(Boolean))];
  $("model").innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join("");
  $("model").value = current || ids[0];
}

async function loadModels(apiKey, current) {
  if (!apiKey) { fillModels(FALLBACK_MODELS, current); $("modelsInfo").textContent = "(default list — add API key and press ↻)"; return; }
  $("modelsInfo").textContent = "(loading…)";
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || res.status);
    const ids = data.data.map(m => m.id)
      .filter(id => (/^gpt-/.test(id) || /^o\d/.test(id)) && !EXCLUDE.test(id))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    fillModels(ids.length ? ids : FALLBACK_MODELS, current);
    $("modelsInfo").textContent = `(${ids.length} available)`;
  } catch (e) {
    fillModels(FALLBACK_MODELS, current);
    $("modelsInfo").textContent = `(couldn't load: ${e.message})`;
  }
}

(async () => {
  const cfg = tgaiMerge(await chrome.storage.local.get(null));
  FIELDS.filter(f => f !== "model").forEach(f => $(f).value = cfg[f]);
  MODES.forEach(m => $("p_" + m).value = cfg.prompts[m]);
  await loadModels(cfg.apiKey, cfg.model);
})();

$("refreshModels").addEventListener("click", () => loadModels($("apiKey").value.trim(), $("model").value));

$("save").addEventListener("click", async () => {
  const data = {};
  FIELDS.forEach(f => data[f] = $(f).value.trim());
  data.variants = Math.min(5, Math.max(1, parseInt(data.variants) || 3));
  data.contextMessages = Math.min(50, Math.max(0, parseInt(data.contextMessages) || 15));
  data.prompts = {};
  // Store only customized prompts, so future default improvements still apply
  MODES.forEach(m => {
    const v = $("p_" + m).value.trim();
    if (v && v !== TGAI_DEFAULTS.prompts[m]) data.prompts[m] = v;
  });
  await chrome.storage.local.set(data);
  $("status").textContent = "Saved ✓";
  setTimeout(() => $("status").textContent = "", 1500);
});
