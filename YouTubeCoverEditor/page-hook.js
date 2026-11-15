// Runs in the page (MAIN world). Fallback path: when the extension cannot find the
// thumbnail <input type=file> directly, it "arms" a file here. The next time Studio opens
// a file picker for an image input, the picker is skipped and the armed file is used.
(() => {
  if (window.__yceHook) return;
  window.__yceHook = true;

  let pending = null;
  let until = 0;

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__yce !== true) return;
    if (e.data.type === 'arm' && e.data.file instanceof File) {
      pending = e.data.file;
      until = Date.now() + 120000;
    } else if (e.data.type === 'disarm') {
      pending = null;
    }
  });

  const acceptsImage = (el) => {
    const a = (el.accept || '').toLowerCase();
    return !/video|audio|vtt|srt|sbv/.test(a) && (a === '' || /image|jpe?g|png/.test(a));
  };

  const tryInject = (el) => {
    if (!pending || Date.now() > until) return false;
    if (!(el instanceof HTMLInputElement) || el.type !== 'file' || !acceptsImage(el)) return false;
    const dt = new DataTransfer();
    dt.items.add(pending);
    pending = null;
    el.files = dt.files;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    window.postMessage({ __yce: true, type: 'injected' }, location.origin);
    return true;
  };

  const origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function (...args) {
    if (tryInject(this)) return;
    return origClick.apply(this, args);
  };

  const origPicker = HTMLInputElement.prototype.showPicker;
  if (origPicker) {
    HTMLInputElement.prototype.showPicker = function (...args) {
      if (tryInject(this)) return;
      return origPicker.apply(this, args);
    };
  }
})();
