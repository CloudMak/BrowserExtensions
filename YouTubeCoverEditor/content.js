// YouTube Cover Editor — content script for studio.youtube.com
// Finds YouTube's auto-generated stills in the Thumbnail block, lets you put a title on one,
// and pushes the result into Studio's thumbnail uploader.
(() => {
  'use strict';
  if (window.__yceLoaded) return;
  window.__yceLoaded = true;

  const LAND = [1280, 720];
  const PORT = [1080, 1920];
  const outSize = (frame) => (frame && frame.rect.w / frame.rect.h < 1 ? PORT : LAND);
  const MAX_BYTES = 2 * 1024 * 1024 - 64 * 1024;
  const STORAGE_KEY = 'yceStyle';

  // ---------- fonts ----------
  const RANGE_LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
  const RANGE_CYR = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
  const FONTS = [
    { id: 'montserrat', label: 'Montserrat Black', family: 'YCE Montserrat', weight: '900' },
    { id: 'rubik', label: 'Rubik ExtraBold', family: 'YCE Rubik', weight: '800' },
    { id: 'oswald', label: 'Oswald Bold (узкий)', family: 'YCE Oswald', weight: '700' },
    { id: 'russo', label: 'Russo One', family: 'YCE Russo', weight: '400' },
    { id: 'unbounded', label: 'Unbounded ExtraBold', family: 'YCE Unbounded', weight: '800' },
    { id: 'impact', label: 'Impact (системный)', family: 'Impact', weight: '400', system: true },
    { id: 'arialblack', label: 'Arial Black (системный)', family: 'Arial Black', weight: '900', system: true },
  ];
  let fontsReady = null;
  function loadFonts() {
    if (fontsReady) return fontsReady;
    fontsReady = Promise.all(FONTS.filter((f) => !f.system).flatMap((f) =>
      [['latin', RANGE_LATIN], ['cyrillic', RANGE_CYR]].map(async ([subset, range]) => {
        try {
          const buf = await (await fetch(chrome.runtime.getURL(`fonts/${f.id}-${subset}.woff2`))).arrayBuffer();
          const face = new FontFace(f.family, buf, { weight: f.weight, unicodeRange: range });
          await face.load();
          document.fonts.add(face);
        } catch (e) {
          console.warn('[YCE] font load failed', f.id, subset, e);
        }
      })
    ));
    return fontsReady;
  }
  const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
  const fontString = (s) => {
    const f = fontById(s.font);
    return `${f.weight} ${s.size}px "${f.family}", Impact, "Arial Black", sans-serif`;
  };

  // ---------- style state ----------
  const DEFAULTS = {
    font: 'montserrat', size: 110, color: '#ffffff', uppercase: true,
    strokeColor: '#000000', strokeWidth: 8, shadow: true,
    bgMode: 'none', bgColor: '#e11d48', bgOpacity: 100, padding: 22,
    align: 'center', maxWidth: 90, lineHeight: 105, dim: 0,
    x: 0.5, y: 0.8,
  };
  let style = { ...DEFAULTS };
  const loadStyle = () => new Promise((res) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (r) => {
        style = { ...DEFAULTS, ...(r && r[STORAGE_KEY]) };
        res();
      });
    } catch (_) { res(); }
  });
  let saveTimer = 0;
  const saveStyle = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { chrome.storage.local.set({ [STORAGE_KEY]: style }); } catch (_) {}
    }, 300);
  };

  // ---------- DOM helper (no innerHTML: Studio enforces Trusted Types) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  // ---------- context & candidate detection ----------
  const THUMB_HINT = /thumbnail|still/i;
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const DIALOG_SEL = 'tp-yt-paper-dialog, ytcp-dialog, [role="dialog"]';
  function getScope() {
    if (/\/video\/[\w-]+\//.test(location.pathname)) return document.body;
    if ([...document.querySelectorAll('ytcp-uploads-dialog, ' + DIALOG_SEL)].some(visible)) return document.body;
    return null;
  }
  // true if the element is not hidden behind a modal backdrop / another layer
  function onTop(el, x, y) {
    const r = el.getBoundingClientRect();
    if (x == null) {
      x = r.left + r.width / 2; y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true;
    }
    const top = document.elementFromPoint(x, y);
    if (!top) return false;
    if (host && (top === host || host.contains(top))) return true;
    for (let a = el, i = 0; a && i < 4; a = a.parentElement, i++) if (a.contains(top)) return true;
    return false;
  }
  function inThumbArea(el) {
    for (let n = el, i = 0; n && i < 12; n = n.parentElement, i++) {
      if (THUMB_HINT.test(n.tagName) || THUMB_HINT.test(n.id || '') ||
          (typeof n.className === 'string' && THUMB_HINT.test(n.className))) return true;
    }
    return false;
  }
  function srcOf(el) {
    if (el.tagName === 'IMG') return el.currentSrc || el.src || '';
    const m = (el.style.backgroundImage || '').match(/url\(["']?(.*?)["']?\)/);
    return m ? m[1] : '';
  }
  let candidates = [];
  function scan() {
    const scope = getScope();
    if (!scope) { candidates = []; updateFab(); return; }
    const found = [];
    const seen = new Set();
    for (const el of scope.querySelectorAll('img, [style*="background-image"]')) {
      if (host && host.contains(el)) continue;
      const src = srcOf(el);
      if (!src || /^data:image\/(gif|svg)/.test(src) || src.endsWith('.svg')) continue;
      if (!/ytimg\.com|googleusercontent\.com|ggpht\.com|^blob:|^data:image/.test(src)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) continue;
      const ar = r.width / r.height;
      if (!((ar >= 0.45 && ar <= 0.75) || (ar >= 1.45 && ar <= 1.95))) continue;
      if (el.tagName === 'IMG' && el.naturalWidth && el.naturalWidth < 80) continue;
      if (!inThumbArea(el) && !el.closest(DIALOG_SEL)) continue;
      if (!onTop(el)) continue;
      if (seen.has(src)) continue;
      seen.add(src);
      found.push(el);
    }
    if (found.length !== candidates.length) console.debug('[YCE] stills found:', found.length, found);
    candidates = found;
    updateFab();
  }
  let scanTimer = 0;
  const scheduleScan = () => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = 0; scan(); }, 400);
  };

  // ---------- image loading ----------
  function hiResUrls(src) {
    const out = [];
    const m = src.match(/^(https:\/\/i\d*\.ytimg\.com\/vi(?:_webp)?)(\/[\w-]+\/)(?:maxres|sd|hq|mq)?([\w]+)\.(jpg|webp)(\?.*)?$/);
    if (m) {
      const [, base, id, name, ext, q = ''] = m;
      out.push(`${base}${id}maxres${name}.${ext}${q}`);
      out.push(`https://i.ytimg.com/vi${id}maxres${name}.jpg`);
      for (const p of ['sd', 'hq']) out.push(`${base}${id}${p}${name}.${ext}${q}`);
    }
    out.push(src);
    return [...new Set(out)];
  }
  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  async function loadBitmap(el) {
    const src = srcOf(el);
    if (/^(blob:|data:)/.test(src)) {
      if (el.tagName === 'IMG' && el.complete && el.naturalWidth) return createImageBitmap(el);
      const blob = await (await fetch(src)).blob();
      return createImageBitmap(blob);
    }
    const r = el.getBoundingClientRect();
    const urls = r.height > r.width ? [src] : hiResUrls(src); // vertical stills: hi-res variants are different crops
    const res = await chrome.runtime.sendMessage({ type: 'yce-fetch', urls });
    if (!res || !res.ok) throw new Error('Не удалось загрузить кадр');
    return createImageBitmap(b64ToBlob(res.b64, res.mime));
  }

  // Trim letterbox/pillarbox black bars so 4:3 "hq" stills become clean 16:9 frames.
  function contentRect(bmp) {
    const w = bmp.width, hgt = bmp.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, w, hgt).data;
    const dark = (x0, y0, dx, dy, n) => {
      let sum = 0, max = 0;
      for (let i = 0; i < n; i++) {
        const x = x0 + dx * i, y = y0 + dy * i, p = (y * w + x) * 4;
        const l = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        sum += l; if (l > max) max = l;
      }
      return sum / n < 18 && max < 45;
    };
    let top = 0, bottom = hgt - 1, left = 0, right = w - 1;
    while (top < hgt / 3 && dark(0, top, 1, 0, w)) top++;
    while (bottom > (hgt * 2) / 3 && dark(0, bottom, 1, 0, w)) bottom--;
    while (left < w / 3 && dark(left, top, 0, 1, bottom - top + 1)) left++;
    while (right > (w * 2) / 3 && dark(right, top, 0, 1, bottom - top + 1)) right--;
    // a limit hit means a dark scene, not a bar: don't trim that axis
    if (top >= hgt / 3 || bottom <= (hgt * 2) / 3) { top = 0; bottom = hgt - 1; }
    if (left >= w / 3 || right <= (w * 2) / 3) { left = 0; right = w - 1; }
    const r = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    // ignore 1-2px noise borders
    if (r.y < hgt * 0.02) { r.h += r.y; r.y = 0; }
    if (bottom > hgt * 0.98) r.h = hgt - r.y;
    if (r.x < w * 0.02) { r.w += r.x; r.x = 0; }
    if (right > w * 0.98) r.w = w - r.x;
    return r;
  }

  // Studio shows stills with object-fit: cover. If the tile's shape differs from the image
  // (vertical Shorts frames inside a 4:3 image with a blurred fill), crop to what the tile shows.
  function frameRect(bmp, shownAr) {
    const ar = bmp.width / bmp.height;
    if (shownAr && Math.abs(Math.log(shownAr / ar)) > 0.12) {
      if (shownAr < ar) {
        const w = Math.round(bmp.height * shownAr);
        return { x: Math.round((bmp.width - w) / 2), y: 0, w, h: bmp.height };
      }
      const hh = Math.round(bmp.width / shownAr);
      return { x: 0, y: Math.round((bmp.height - hh) / 2), w: bmp.width, h: hh };
    }
    return contentRect(bmp);
  }

  // ---------- rendering ----------
  function wrapLines(ctx, text, maxW) {
    const lines = [];
    for (const para of text.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const test = line + ' ' + words[i];
        if (ctx.measureText(test).width <= maxW) line = test;
        else { lines.push(line); line = words[i]; }
      }
      lines.push(line);
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  function computeLayout(ctx, s, text) {
    const OUT_W = ctx.canvas.width, OUT_H = ctx.canvas.height;
    ctx.font = fontString(s);
    const pad = s.bgMode === 'none' ? 0 : s.padding;
    const maxW = (OUT_W * s.maxWidth) / 100 - pad * 2;
    const t = s.uppercase ? text.toUpperCase() : text;
    const lines = wrapLines(ctx, t, maxW);
    const widths = lines.map((l) => ctx.measureText(l).width);
    const lineH = (s.size * s.lineHeight) / 100;
    const blockW = Math.max(0, ...widths);
    const blockH = lines.length * lineH;
    const m = ctx.measureText('HЖ');
    const capOffset = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    const margin = 24 + pad;
    let cx = s.x * OUT_W, cy = s.y * OUT_H;
    cx = Math.min(Math.max(cx, margin + blockW / 2), OUT_W - margin - blockW / 2);
    cy = Math.min(Math.max(cy, margin + blockH / 2), OUT_H - margin - blockH / 2);
    return { lines, widths, lineH, blockW, blockH, capOffset, pad, cx, cy, bx: cx - blockW / 2, by: cy - blockH / 2 };
  }

  function hexA(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function lineX(L, s, i) {
    if (s.align === 'left') return L.bx;
    if (s.align === 'right') return L.bx + L.blockW - L.widths[i];
    return L.cx - L.widths[i] / 2;
  }

  function render(ctx, frame, s, text, opts = {}) {
    const OUT_W = ctx.canvas.width, OUT_H = ctx.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, OUT_W, OUT_H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    if (frame) {
      const { bmp, rect } = frame;
      const ar = rect.w / rect.h / (OUT_W / OUT_H);
      const cover = Math.max(OUT_W / rect.w, OUT_H / rect.h);
      if (ar < 0.75 || ar > 1.33) {
        // vertical / square source: blurred fill + contained frame
        ctx.save();
        ctx.filter = 'blur(28px) brightness(0.7)';
        const dw = rect.w * cover, dh = rect.h * cover;
        ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);
        ctx.restore();
        const fit = Math.min(OUT_W / rect.w, OUT_H / rect.h);
        const fw = rect.w * fit, fh = rect.h * fit;
        ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, (OUT_W - fw) / 2, (OUT_H - fh) / 2, fw, fh);
      } else {
        ctx.imageSmoothingQuality = 'high';
        const dw = rect.w * cover, dh = rect.h * cover;
        ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);
      }
    }
    if (s.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${s.dim / 100})`;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }

    const L = computeLayout(ctx, s, text || '');
    if (L.lines.length) {
      // background
      if (s.bgMode !== 'none') {
        ctx.fillStyle = hexA(s.bgColor, s.bgOpacity / 100);
        ctx.beginPath();
        const p = L.pad;
        if (s.bgMode === 'box') {
          ctx.roundRect(L.bx - p, L.by - p * 0.6, L.blockW + p * 2, L.blockH + p * 1.2, Math.min(18, p));
        } else if (s.bgMode === 'lines') {
          L.lines.forEach((l, i) => {
            if (!l) return;
            const y = L.by + i * L.lineH;
            ctx.roundRect(lineX(L, s, i) - p, y - p * 0.2, L.widths[i] + p * 2, L.lineH + p * 0.4, Math.min(10, p));
          });
        } else if (s.bgMode === 'band') {
          ctx.rect(0, L.by - p * 0.6, OUT_W, L.blockH + p * 1.2);
        }
        ctx.fill();
      }

      ctx.font = fontString(s);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      const baseY = (i) => L.by + i * L.lineH + L.lineH / 2 + L.capOffset;
      const withShadow = () => {
        if (!s.shadow) return;
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = Math.max(8, s.size * 0.15);
        ctx.shadowOffsetX = ctx.shadowOffsetY = Math.max(3, s.size * 0.05);
      };
      const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0; };

      if (s.strokeWidth > 0) {
        ctx.save();
        withShadow();
        ctx.strokeStyle = s.strokeColor;
        ctx.lineWidth = s.strokeWidth * 2;
        L.lines.forEach((l, i) => l && ctx.strokeText(l, lineX(L, s, i), baseY(i)));
        ctx.restore();
        noShadow();
      } else {
        withShadow();
      }
      ctx.fillStyle = s.color;
      L.lines.forEach((l, i) => l && ctx.fillText(l, lineX(L, s, i), baseY(i)));
      noShadow();
    }

    if (opts.guides && opts.dragging) {
      ctx.strokeStyle = 'rgba(56,189,248,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      if (Math.abs(s.x - 0.5) < 0.001) { ctx.beginPath(); ctx.moveTo(OUT_W / 2, 0); ctx.lineTo(OUT_W / 2, OUT_H); ctx.stroke(); }
      if (Math.abs(s.y - 0.5) < 0.001) { ctx.beginPath(); ctx.moveTo(0, OUT_H / 2); ctx.lineTo(OUT_W, OUT_H / 2); ctx.stroke(); }
    }
    ctx.restore();
    return L;
  }

  async function exportJpeg(frame, s, text) {
    await loadFonts();
    const c = document.createElement('canvas');
    [c.width, c.height] = outSize(frame);
    render(c.getContext('2d'), frame, s, text);
    for (const q of [0.92, 0.85, 0.78, 0.7, 0.6]) {
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error('Не удалось уложиться в 2 МБ');
  }

  // ---------- Studio integration ----------
  function readTitle() {
    const scope = getScope() || document;
    const sels = [
      '#title-textarea #textbox',
      'ytcp-video-title #textbox',
      '#title-textarea [contenteditable="true"]',
      '#textbox[contenteditable="true"]',
    ];
    for (const sel of sels) {
      const el = scope.querySelector(sel) || document.querySelector(sel);
      if (el && el.innerText.trim()) return el.innerText.trim();
    }
    return '';
  }
  function findThumbInput() {
    const scope = getScope() || document;
    const ok = (i) => {
      const a = (i.accept || '').toLowerCase();
      return /image|jpe?g|png/.test(a) && !/video/.test(a);
    };
    return [...scope.querySelectorAll('input[type="file"]')].find(ok) ||
      [...document.querySelectorAll('input[type="file"]')].find(ok) || null;
  }
  function applyToStudio(blob) {
    const file = new File([blob], 'thumbnail.jpg', { type: 'image/jpeg', lastModified: Date.now() });
    const input = findThumbInput();
    if (input) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'direct';
    }
    window.postMessage({ __yce: true, type: 'arm', file }, location.origin);
    return 'armed';
  }
  function closePicker(dlg) {
    if (!dlg || dlg.querySelector('input[type="file"]')) return;
    const btn = dlg.querySelector('#cancel-button, [id*="cancel" i]') ||
      [...dlg.querySelectorAll('button, ytcp-button, tp-yt-paper-button')]
        .find((b) => /^(cancel|отмена)$/i.test((b.textContent || '').trim()));
    if (btn) setTimeout(() => (btn.querySelector('button') || btn).click(), 150);
  }
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__yce === true && e.data.type === 'injected') {
      toast('Обложка с текстом загружена в YouTube');
    }
  });

  // ---------- UI ----------
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: Roboto, "Segoe UI", Arial, sans-serif; }
  .badge { position: fixed; z-index: 2147483646; display: none; padding: 5px 9px; border: 0; border-radius: 6px;
    background: #ff0033; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.35); }
  .badge:hover { background: #e0002d; }
  .fab { position: fixed; left: 16px; bottom: 16px; z-index: 2147483645; display: none; padding: 10px 14px; border: 0;
    border-radius: 999px; background: #ff0033; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
    box-shadow: 0 4px 14px rgba(0,0,0,.35); }
  .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647; display: none;
    max-width: 560px; padding: 12px 16px; border-radius: 8px; background: #212121; color: #fff; font-size: 14px;
    box-shadow: 0 6px 20px rgba(0,0,0,.4); }
  .overlay { position: fixed; inset: 0; z-index: 2147483646; display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,.6); }
  .modal { display: flex; gap: 18px; max-width: 96vw; max-height: 94vh; padding: 18px; border-radius: 12px;
    background: #1f1f1f; color: #eee; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
  .left { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  canvas.preview { width: min(720px, 58vw); aspect-ratio: 16/9; border-radius: 8px; cursor: grab; background: #000; display: block; }
  canvas.preview.drag { cursor: grabbing; }
  canvas.preview.portrait { width: auto; height: min(80vh, 760px); aspect-ratio: 9/16; }
  .strip img.portrait { width: 68px; aspect-ratio: 9/16; }
  .hint { font-size: 12px; color: #9e9e9e; }
  .strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
  .strip img { width: 120px; aspect-ratio: 16/9; object-fit: cover; border-radius: 6px; cursor: pointer;
    border: 2px solid transparent; opacity: .75; flex: none; }
  .strip img.sel { border-color: #3ea6ff; opacity: 1; }
  .panel { width: 300px; display: flex; flex-direction: column; gap: 8px; max-height: calc(94vh - 36px); min-height: 0; }
  .controls { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 6px; }
  .panel h3 { margin: 0 0 2px; font-size: 16px; font-weight: 600; }
  label.f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #bbb; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row > * { flex: 1; }
  textarea, select, input[type=number] { width: 100%; padding: 7px 8px; border: 1px solid #3a3a3a; border-radius: 6px;
    background: #2b2b2b; color: #fff; font-size: 14px; }
  textarea { resize: vertical; min-height: 64px; }
  input[type=color] { width: 40px; height: 30px; flex: none; padding: 0; border: 1px solid #3a3a3a; border-radius: 6px; background: none; }
  input[type=range] { accent-color: #3ea6ff; }
  .val { flex: none; width: 40px; text-align: right; font-size: 12px; color: #ddd; }
  .chk { display: flex; gap: 6px; align-items: center; font-size: 13px; color: #ddd; flex: none; }
  .seg { display: flex; gap: 4px; }
  .seg button { flex: 1; padding: 6px 0; border: 1px solid #3a3a3a; border-radius: 6px; background: #2b2b2b;
    color: #ddd; font-size: 12px; cursor: pointer; }
  .seg button.on { background: #3ea6ff; border-color: #3ea6ff; color: #0f0f0f; font-weight: 600; }
  .actions { display: flex; gap: 8px; margin-top: 6px; }
  .btn { flex: 1; padding: 10px 6px; border: 0; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .btn.primary { background: #3ea6ff; color: #0f0f0f; }
  .btn.ghost { background: #333; color: #eee; }
  .btn:disabled { opacity: .5; cursor: default; }
  `;

  let host, root, badge, fab, toastEl, overlay;
  let hoverEl = null;

  function mountUI() {
    host = h('div', { id: 'yce-host' });
    root = host.attachShadow({ mode: 'open' });
    root.append(h('style', { text: CSS }));
    badge = h('button', { class: 'badge', text: '🏷 Текст', onclick: (e) => { e.stopPropagation(); openEditor(hoverEl); } });
    fab = h('button', { class: 'fab', text: '🏷 Обложка с текстом', onclick: () => openEditor(null) });
    toastEl = h('div', { class: 'toast' });
    overlay = h('div', { class: 'overlay' });
    root.append(badge, fab, toastEl, overlay);
    document.documentElement.append(host);
  }

  let toastTimer = 0;
  function toast(msg, ms = 4000) {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, ms);
  }

  function updateFab() {
    if (!fab) return;
    fab.style.display = candidates.length && overlay.style.display !== 'flex' ? 'block' : 'none';
  }

  let moveRaf = 0;
  document.addEventListener('mousemove', (e) => {
    if (moveRaf) return;
    const { clientX: x, clientY: y } = e;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      if (!badge || overlay.style.display === 'flex') return;
      const br = badge.getBoundingClientRect();
      if (badge.style.display === 'block' && x >= br.left && x <= br.right && y >= br.top && y <= br.bottom) return;
      const hit = candidates.find((el) => {
        const r = el.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && onTop(el, x, y);
      });
      if (hit) {
        hoverEl = hit;
        const r = hit.getBoundingClientRect();
        badge.style.display = 'block';
        badge.style.left = `${r.left + 6}px`;
        badge.style.top = `${r.top + 6}px`;
      } else {
        badge.style.display = 'none';
      }
    });
  }, { passive: true });

  // ---------- editor ----------
  async function openEditor(startEl) {
    scan();
    const startDlg = startEl && startEl.closest(DIALOG_SEL);
    const list = candidates.filter((el) => !startDlg || startDlg.contains(el));
    if (startEl && !list.includes(startEl)) list.unshift(startEl);
    if (!list.length) { toast('Не нашёл кадров YouTube в блоке Thumbnail. Дождитесь, пока они появятся.'); return; }
    badge.style.display = 'none';

    await loadStyle();
    loadFonts();
    let text = readTitle();
    let frame = null;
    let dragging = false;
    const frameCache = new Map();

    const canvas = h('canvas', { class: 'preview', width: LAND[0], height: LAND[1] });
    const ctx = canvas.getContext('2d');
    const redraw = () => render(ctx, frame, style, text, { guides: true, dragging });

    const pickFrame = async (el, imgEl) => {
      strip.querySelectorAll('img').forEach((i) => i.classList.toggle('sel', i === imgEl));
      try {
        if (!frameCache.has(el)) {
          const bmp = await loadBitmap(el);
          const er = el.getBoundingClientRect();
          frameCache.set(el, { bmp, rect: frameRect(bmp, er.width / er.height) });
        }
        frame = frameCache.get(el);
        const [w, hh] = outSize(frame);
        if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
        canvas.classList.toggle('portrait', hh > w);
        redraw();
      } catch (err) {
        toast(String(err.message || err));
      }
    };

    const strip = h('div', { class: 'strip' });
    list.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const img = h('img', { src: srcOf(el), title: `Кадр ${i + 1}`, class: r.height > r.width ? 'portrait' : null });
      img.addEventListener('click', () => pickFrame(el, img));
      strip.append(img);
    });

    // controls
    const set = (k, v) => { style[k] = v; saveStyle(); redraw(); };
    const range = (k, min, max, step = 1, suffix = '') => {
      const val = h('span', { class: 'val', text: style[k] + suffix });
      const inp = h('input', { type: 'range', min, max, step, value: style[k] });
      inp.addEventListener('input', () => { val.textContent = inp.value + suffix; set(k, +inp.value); });
      return h('div', { class: 'row' }, inp, val);
    };
    const color = (k) => {
      const inp = h('input', { type: 'color', value: style[k] });
      inp.addEventListener('input', () => set(k, inp.value));
      return inp;
    };
    const check = (k, label) => {
      const inp = h('input', { type: 'checkbox' });
      inp.checked = !!style[k];
      inp.addEventListener('change', () => set(k, inp.checked));
      return h('label', { class: 'chk' }, inp, label);
    };
    const seg = (items, isOn, onPick) => {
      const wrap = h('div', { class: 'seg' });
      const btns = items.map(([label, v]) => {
        const b = h('button', { type: 'button', text: label });
        b.addEventListener('click', () => { onPick(v); btns.forEach((x, j) => x.classList.toggle('on', isOn(items[j][1]))); });
        return b;
      });
      btns.forEach((b, j) => b.classList.toggle('on', isOn(items[j][1])));
      wrap.append(...btns);
      return wrap;
    };
    const field = (label, ...kids) => h('label', { class: 'f' }, label, ...kids);

    const ta = h('textarea', { rows: 3 });
    ta.value = text;
    ta.addEventListener('input', () => { text = ta.value; redraw(); });

    const fontSel = h('select');
    FONTS.forEach((f) => fontSel.append(h('option', { value: f.id, text: f.label })));
    fontSel.value = style.font;
    fontSel.addEventListener('change', () => set('font', fontSel.value));

    const bgSel = h('select');
    [['none', 'Нет'], ['box', 'Плашка'], ['lines', 'Плашка по строкам'], ['band', 'Полоса во всю ширину']]
      .forEach(([v, t]) => bgSel.append(h('option', { value: v, text: t })));
    bgSel.value = style.bgMode;
    bgSel.addEventListener('change', () => set('bgMode', bgSel.value));

    const applyBtn = h('button', { class: 'btn primary', text: 'Применить' });
    const dlBtn = h('button', { class: 'btn ghost', text: 'Скачать' });
    const cancelBtn = h('button', { class: 'btn ghost', text: 'Отмена' });

    const controls = h('div', { class: 'controls' },
      field('Текст', ta),
      field('Шрифт', fontSel),
      field('Размер', range('size', 30, 240)),
      h('div', { class: 'row' }, field('Цвет текста', color('color')), check('uppercase', 'ЗАГЛАВНЫЕ'), check('shadow', 'Тень')),
      field('Обводка', h('div', { class: 'row' }, color('strokeColor'), range('strokeWidth', 0, 30))),
      field('Фон под текстом', bgSel),
      h('div', { class: 'row' }, color('bgColor'), field('Прозрачность фона', range('bgOpacity', 10, 100, 5, '%'))),
      field('Отступ фона', range('padding', 0, 80)),
      field('Ширина текста', range('maxWidth', 30, 100, 1, '%')),
      field('Межстрочный', range('lineHeight', 80, 150, 1, '%')),
      field('Выравнивание', seg([['Слева', 'left'], ['Центр', 'center'], ['Справа', 'right']], (v) => style.align === v, (v) => set('align', v))),
      field('Позиция', seg([['Верх', 0.18], ['Центр', 0.5], ['Низ', 0.82]], () => false, (v) => { style.x = 0.5; style.y = v; saveStyle(); redraw(); })),
      field('Затемнить кадр', range('dim', 0, 70, 5, '%')),
    );
    const panel = h('div', { class: 'panel' },
      h('h3', { text: 'Текст на обложку' }),
      controls,
      h('div', { class: 'actions' }, applyBtn, dlBtn, cancelBtn),
    );

    const left = h('div', { class: 'left' },
      canvas,
      h('div', { class: 'hint', text: 'Перетаскивайте текст мышью. Ctrl+Enter — применить, Esc — закрыть.' }),
      strip,
    );

    // drag
    let dragStart = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      dragging = true;
      canvas.classList.add('drag');
      dragStart = { px: e.clientX, py: e.clientY, x: style.x, y: style.y };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragStart) return;
      const r = canvas.getBoundingClientRect();
      let x = dragStart.x + (e.clientX - dragStart.px) / r.width;
      let y = dragStart.y + (e.clientY - dragStart.py) / r.height;
      x = Math.min(1, Math.max(0, x)); y = Math.min(1, Math.max(0, y));
      if (Math.abs(x - 0.5) < 0.015) x = 0.5;
      if (Math.abs(y - 0.5) < 0.015) y = 0.5;
      style.x = x; style.y = y;
      redraw();
    });
    const endDrag = () => {
      if (!dragStart) return;
      // store the clamped (actually rendered) position so presets/drags stay consistent
      const L = computeLayout(ctx, style, text);
      style.x = L.cx / canvas.width; style.y = L.cy / canvas.height;
      dragStart = null; dragging = false;
      canvas.classList.remove('drag');
      saveStyle(); redraw();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    const close = () => {
      overlay.style.display = 'none';
      overlay.replaceChildren();
      editorKeyHandler = null;
      updateFab();
    };
    const doApply = async () => {
      if (!frame) { toast('Выберите кадр'); return; }
      applyBtn.disabled = true;
      try {
        const blob = await exportJpeg(frame, style, text);
        const mode = applyToStudio(blob);
        close();
        closePicker(startDlg);
        if (mode === 'direct') toast('Обложка с текстом загружена в YouTube');
        else toast('Нажмите «Upload file» в блоке Thumbnail — картинка подставится сама, без выбора файла.', 9000);
      } catch (err) {
        toast(String(err.message || err));
      } finally {
        applyBtn.disabled = false;
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopImmediatePropagation(); doApply(); }
    };
    applyBtn.addEventListener('click', doApply);
    cancelBtn.addEventListener('click', close);
    dlBtn.addEventListener('click', async () => {
      if (!frame) return;
      const blob = await exportJpeg(frame, style, text);
      const a = h('a', { href: URL.createObjectURL(blob), download: 'thumbnail.jpg' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    overlay.replaceChildren(h('div', { class: 'modal' }, left, panel));
    overlay.style.display = 'flex';
    updateFab();
    editorKeyHandler = onKey;

    redraw();
    const startIdx = Math.max(0, list.indexOf(startEl));
    await pickFrame(list[startIdx], strip.children[startIdx]);
    await loadFonts();
    redraw();
    ta.focus();
  }

  // ---------- boot ----------
  mountUI();
  // Studio's modal dialogs (iron-overlay) trap focus and keys at document level and pull focus
  // back into the dialog. Window-capture runs first, so events from our UI never reach them.
  let editorKeyHandler = null;
  const shield = (e) => {
    if (e.type === 'keydown' && editorKeyHandler) editorKeyHandler(e);
    if (e.composedPath().includes(host)) e.stopImmediatePropagation();
  };
  for (const t of ['focus', 'focusin', 'focusout', 'blur', 'keydown', 'keyup', 'keypress'])
    window.addEventListener(t, shield, true);
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'],
  });
  window.addEventListener('resize', scheduleScan);
  setInterval(scan, 2000);
  scan();
})();
