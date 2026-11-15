// Adds a "Kdenlive Voiceover" button next to fish.audio's "Generate Speech" button.
(() => {
  const BTN_ID = 'fvo-kdenlive-btn';

  function findGenerateButton() {
    return [...document.querySelectorAll('button')].find(
      (b) => b.id !== BTN_ID && /Generate Speech/i.test(b.textContent)
    );
  }

  // Reads the voice, model and speed currently selected in the page's Settings panel.
  function readPageSettings() {
    const label = [...document.querySelectorAll('span')].find(
      (e) => e.children.length === 0 && e.textContent.trim() === 'Voice'
    );
    let box = label;
    for (let i = 0; i < 3 && box; i++) box = box.parentElement;
    if (!box) return {};
    const img = box.querySelector('img[src*="coverimage/"]');
    const voiceId = (img?.src.match(/coverimage\/([a-z0-9]+)/i) || [])[1] || '';
    const lines = box.innerText.split('\n').map((s) => s.trim());
    const after = (key) => {
      const i = lines.indexOf(key);
      return i >= 0 ? lines[i + 1] || '' : '';
    };
    return {
      voiceId,
      voiceName: after('Voice'),
      model: after('Model'),
      speed: after('Speed').replace(/x$/i, '')
    };
  }

  function inject() {
    if (document.getElementById(BTN_ID)) return;
    const gen = findGenerateButton();
    if (!gen?.parentElement) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'fvo-btn';
    btn.textContent = 'Kdenlive Voiceover';
    btn.title = 'Voice over a Kdenlive transcript, keeping timeline positions';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'open-voiceover', ...readPageSettings() });
    });
    gen.parentElement.insertBefore(btn, gen);
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      inject();
    });
  }).observe(document.body, { childList: true, subtree: true });
  inject();
})();
