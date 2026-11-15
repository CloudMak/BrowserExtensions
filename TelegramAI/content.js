(() => {
  const INPUT_SEL = "#editable-message-text";
  const MODES = [
    { id: "hello", label: "👋 Hello" },
    { id: "ask", label: "❓ Ask" },
    { id: "invite", label: "📩 Invite" },
    { id: "improve", label: "✏️ Improve" }
  ];

  let bar, results, extra, styleSel, ctxBtn, lastMode = "hello";
  let ui = { useContext: true, style: "" };
  const recent = []; // earlier suggestions, to avoid repeats

  // ---------- Telegram DOM helpers ----------
  const getInput = () => document.querySelector(INPUT_SEL);
  const getComposer = () => getInput()?.closest(".Composer");

  function getChatTitle() {
    const h = document.querySelector(".MiddleHeader .fullName, .MiddleHeader .title h3");
    return h ? h.innerText.trim() : "";
  }

  function getHistory(limit) {
    return [...document.querySelectorAll(".messages-container .Message")].slice(-limit).map(n => {
      const tc = n.querySelector(".text-content");
      if (!tc) return null;
      const c = tc.cloneNode(true);
      c.querySelectorAll(".MessageMeta, .Reactions, .reactions").forEach(e => e.remove());
      const text = c.innerText.trim();
      return text ? { own: n.classList.contains("own"), text } : null;
    }).filter(Boolean);
  }

  function getDraft() {
    const i = getInput();
    return i ? i.innerText.replace(/\n{2,}/g, "\n").trim() : "";
  }

  function setDraft(text) {
    const i = getInput();
    if (!i) return;
    i.focus();
    document.execCommand("selectAll");
    document.execCommand("insertText", false, text);
  }

  // ---------- UI ----------
  const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const saveUi = () => chrome.storage.local.set({ ui });

  async function build() {
    bar = document.createElement("div");
    bar.className = "tgai-bar";
    bar.innerHTML = `
      ${MODES.map(m => `<button type="button" class="tgai-chip" data-mode="${m.id}">${m.label}</button>`).join("")}
      <button type="button" class="tgai-chip tgai-toggle" data-act="ctx" title="Use previous messages as context"></button>
      <select class="tgai-chip tgai-style" title="Write in the style of…"></select>
      <input class="tgai-extra" placeholder="Extra instruction…">
      <button type="button" class="tgai-chip tgai-icon" data-act="settings" title="Settings">⚙️</button>`;

    results = document.createElement("div");
    results.className = "tgai-results";
    document.body.append(results, bar);

    extra = bar.querySelector(".tgai-extra");
    styleSel = bar.querySelector(".tgai-style");
    ctxBtn = bar.querySelector(".tgai-toggle");

    for (const el of [bar, results]) {
      ["mousedown", "pointerdown", "keydown", "keyup", "keypress", "paste"].forEach(ev =>
        el.addEventListener(ev, e => e.stopPropagation()));
      el.addEventListener("click", onClick);
    }
    bar.querySelectorAll("button").forEach(b => b.addEventListener("mousedown", e => e.preventDefault()));
    extra.addEventListener("keydown", e => { if (e.key === "Enter") run(lastMode); });
    styleSel.addEventListener("change", () => { ui.style = styleSel.value; saveUi(); });

    ui = { ...ui, ...((await chrome.storage.local.get("ui")).ui || {}) };
    await loadCharacters();
    renderCtx();
  }

  async function loadCharacters() {
    const chars = (await chrome.runtime.sendMessage({ type: "tgai-characters" })) || [];
    styleSel.innerHTML = `<option value="">🎭 My style</option>` +
      chars.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    styleSel.value = chars.includes(ui.style) ? ui.style : "";
  }

  function renderCtx() {
    ctxBtn.textContent = ui.useContext ? "📜 Context: on" : "🆕 From scratch";
    ctxBtn.classList.toggle("tgai-active", ui.useContext);
  }

  function onClick(e) {
    e.stopPropagation();
    const t = e.target.closest("button, .tgai-variant");
    if (!t) return;
    if (t.dataset.mode) run(t.dataset.mode);
    else if (t.dataset.act === "ctx") { ui.useContext = !ui.useContext; saveUi(); renderCtx(); }
    else if (t.dataset.act === "settings") chrome.runtime.sendMessage({ type: "tgai-options" });
    else if (t.dataset.act === "again") run(lastMode);
    else if (t.dataset.act === "close") hideResults();
    else if (t.classList.contains("tgai-variant")) { setDraft(t.dataset.text); hideResults(); }
  }

  function showResults(html) {
    results.innerHTML = `<button type="button" class="tgai-close" data-act="close" title="Close">✕</button>${html}`;
    results.classList.add("tgai-open");
    position();
  }
  function hideResults() { results?.classList.remove("tgai-open"); }

  // Keep bar above the composer and push messages up so nothing is covered
  let building = false;
  function position() {
    const composer = getComposer();
    const list = document.querySelector(".MessageList");
    if (!composer) {
      if (bar) bar.style.display = "none";
      document.documentElement.style.removeProperty("--tgai-pad");
      hideResults();
      return;
    }
    if (!bar) { if (!building) { building = true; build().finally(() => { building = false; }); } return; }

    const r = composer.getBoundingClientRect();
    bar.style.display = "flex";
    bar.style.left = r.left + "px";
    bar.style.width = r.width + "px";
    bar.style.bottom = (window.innerHeight - r.top + 6) + "px";

    const b = bar.getBoundingClientRect();
    results.style.left = r.left + "px";
    results.style.width = r.width + "px";
    results.style.bottom = (window.innerHeight - b.top + 6) + "px";

    if (list) {
      const pad = Math.ceil(list.getBoundingClientRect().bottom - b.top + 8);
      document.documentElement.style.setProperty("--tgai-pad", pad + "px");
    }
  }

  async function run(mode) {
    if (!bar) return;
    lastMode = mode;
    bar.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("tgai-active", b.dataset.mode === mode));

    const draft = getDraft();
    if (mode === "improve" && !draft) { showResults(`<div class="tgai-error">Type a message first, then Improve.</div>`); return; }

    showResults(`<div class="tgai-loading">Generating…</div>`);
    const { contextMessages = 15 } = await chrome.storage.local.get("contextMessages");
    const payload = {
      mode,
      draft: mode === "improve" ? draft : "",
      extra: extra.value.trim(),
      style: styleSel.value,
      useContext: ui.useContext,
      chatTitle: ui.useContext ? getChatTitle() : "",
      history: ui.useContext ? getHistory(contextMessages) : [],
      avoid: mode === "improve" ? [] : recent.slice(-10)
    };

    let res;
    try { res = await chrome.runtime.sendMessage({ type: "tgai-generate", payload }); }
    catch { res = { ok: false, error: "Extension was reloaded — refresh the page." }; }

    if (!res?.ok) { showResults(`<div class="tgai-error">${esc(res?.error || "Unknown error")}</div>`); return; }
    if (mode !== "improve") recent.push(...res.variants);
    showResults(
      res.variants.map(v => `<div class="tgai-variant" data-text="${esc(v)}">${esc(v).replace(/\n/g, "<br>")}</div>`).join("") +
      `<button type="button" class="tgai-chip tgai-again" data-act="again">↻ Regenerate</button>`
    );
  }

  chrome.storage.onChanged.addListener(ch => { if (ch.characters && styleSel) loadCharacters(); });
  setInterval(position, 300);
  window.addEventListener("resize", position);
  window.addEventListener("hashchange", hideResults);
})();
