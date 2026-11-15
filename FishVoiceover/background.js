// Opens the voiceover window, either from the button on fish.audio or the toolbar icon.
function openVoiceover(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  chrome.windows.create({
    url: chrome.runtime.getURL('voiceover.html' + (q.toString() ? '?' + q : '')),
    type: 'popup',
    width: 980,
    height: 820
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'open-voiceover') {
    openVoiceover({ voice: msg.voiceId, voiceName: msg.voiceName, model: msg.model, speed: msg.speed });
  }
});

chrome.action.onClicked.addListener(() => openVoiceover());
