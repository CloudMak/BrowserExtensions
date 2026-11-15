// Fetches YouTube still images (cross-origin) so the content script can draw them on canvas
// without tainting it. Tries several URLs in order and returns the first real image.

function toBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'yce-fetch' || !Array.isArray(msg.urls)) return;
  (async () => {
    for (const url of msg.urls) {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) continue;
        const mime = (r.headers.get('content-type') || '').split(';')[0];
        if (!mime.startsWith('image/')) continue;
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length < 1500) continue; // YouTube "no image" placeholders are tiny
        sendResponse({ ok: true, url, mime, b64: toBase64(bytes) });
        return;
      } catch (_) { /* try next */ }
    }
    sendResponse({ ok: false });
  })();
  return true;
});
