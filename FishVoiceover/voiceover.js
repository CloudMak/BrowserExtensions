import { parseInput, formatTc } from './lib/parse.js';
import { tts, mapPageModel } from './lib/fish.js';
import { encodeWav, trimSilence } from './lib/wav.js';
import { getSettings, getDirHandle } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SAMPLE_RATE = 44100;
const MAX_TRIES = 3; // fish.audio requests per line (first try + 2 speed-ups)
const MAX_STRETCH = 1.1; // final squeeze via playback rate if speed-ups weren't enough

let parsed = null;
let busy = false;

init();

async function init() {
  const s = await getSettings();
  $('voice').value = params.get('voice') || s.voiceId;
  $('voiceName').textContent = params.get('voiceName') ? `(${params.get('voiceName')})` : '';
  $('model').value = mapPageModel(params.get('model')) || s.model;
  $('speed').value = parseFloat(params.get('speed')) || s.speed;
  $('fps').value = s.fps;

  $('src').addEventListener('input', debounce(doParse, 250));
  $('fps').addEventListener('change', doParse);
  $('gen').addEventListener('click', generate);
  $('copy').addEventListener('click', copyText);
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  chrome.storage.onChanged.addListener(updateOutLabel);

  await updateOutLabel();
  if (!s.apiKey) showWarn('Add your fish.audio API key in Settings first.');
  $('src').focus();
}

async function updateOutLabel() {
  const dir = await getDirHandle();
  $('outLabel').textContent = `Saves to: ${dir ? dir.name : 'Downloads'}`;
}

function doParse() {
  hideWarn();
  $('done').hidden = true;
  try {
    parsed = parseInput($('src').value, parseFloat($('fps').value) || 25);
  } catch (e) {
    parsed = null;
    showWarn(e.message, true);
  }
  renderSegments();
}

function renderSegments() {
  const tbody = $('segments').querySelector('tbody');
  tbody.innerHTML = '';
  const has = !!parsed?.segments.length;
  $('segments').hidden = !has;
  $('gen').disabled = !has || busy;
  $('copy').disabled = !has;
  if (!has) {
    $('info').textContent = '';
    return;
  }
  const fps = parsed.fps;
  const where =
    parsed.positionFrames != null
      ? ` Drop the WAV at timeline position ${formatTc(parsed.positionFrames / fps, fps)} (where the clip starts).`
      : ' Drop the WAV where the transcribed clip starts.';
  $('info').textContent = `${parsed.segments.length} lines, ${parsed.duration.toFixed(2)} s total.${where}`;

  parsed.segments.forEach((seg, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="num">${i + 1}</td>
      <td class="tc">${formatTc(seg.start, fps)}</td>
      <td class="tc">${(seg.slotEnd - seg.start).toFixed(2)} s</td>
      <td><textarea rows="2"></textarea></td>
      <td class="res"></td>`;
    const ta = tr.querySelector('textarea');
    ta.value = seg.text;
    ta.addEventListener('input', () => (seg.text = ta.value));
    tbody.appendChild(tr);
  });
}

// Copies the lines as "HH:MM:SS:FF  text" (times relative to the clip start, "No speech" removed).
async function copyText() {
  if (!parsed?.segments.length) return;
  const text = parsed.segments.map((s) => `${formatTc(s.start, parsed.fps)}  ${s.text.trim()}`).join('\n');
  await navigator.clipboard.writeText(text);
  $('copy').textContent = 'Copied ✓';
  setTimeout(() => ($('copy').textContent = 'Copy text'), 1500);
}

function setStatus(i, text, cls = '') {
  const cell = $('segments').querySelectorAll('tbody tr')[i]?.querySelector('.res');
  if (cell) {
    cell.textContent = text;
    cell.className = 'res ' + cls;
  }
}

async function generate() {
  if (busy || !parsed?.segments.length) return;

  // Ask for folder permission first, while the click still counts as a user gesture.
  let dir = await getDirHandle();
  if (dir) {
    try {
      let perm = await dir.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await dir.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') dir = null;
    } catch {
      dir = null;
    }
  }

  const settings = await getSettings();
  if (!settings.apiKey) return showWarn('Add your fish.audio API key in Settings first.', true);
  const voiceId = $('voice').value.trim();
  const model = $('model').value;
  const baseSpeed = parseFloat($('speed').value) || 1;

  busy = true;
  $('gen').disabled = true;
  $('gen').textContent = 'Generating…';
  hideWarn();
  $('done').hidden = true;

  try {
    const decoder = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    const placed = [];
    let cursor = 0;
    let overflows = 0;

    for (let i = 0; i < parsed.segments.length; i++) {
      const seg = parsed.segments[i];
      const text = seg.text.trim();
      if (!text) {
        setStatus(i, 'skipped (empty)');
        continue;
      }
      const slot = seg.slotEnd - seg.start;
      let speed = baseSpeed;
      let buf;
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        setStatus(i, attempt === 1 ? 'generating…' : `retry at ${speed}x…`, 'busy');
        const audio = await tts({ apiKey: settings.apiKey, model, voiceId, text, speed });
        buf = trimSilence(await decoder.decodeAudioData(audio));
        if (buf.duration <= slot || speed >= 2) break;
        speed = Math.min(2, Math.round(speed * (buf.duration / slot) * 1.04 * 100) / 100);
      }

      let rate = 1;
      if (buf.duration > slot && buf.duration / slot <= MAX_STRETCH) rate = buf.duration / slot;
      const len = buf.duration / rate;
      const at = Math.max(seg.start, cursor);
      cursor = at + len + 0.05;
      placed.push({ buf, at, rate });

      const late = at - seg.start;
      if (len > slot + 0.01 || late > 0.05) {
        overflows++;
        setStatus(i, `${len.toFixed(2)} s at ${speed}x — ${(len - slot).toFixed(2)} s too long${late > 0.05 ? `, starts ${late.toFixed(2)} s late` : ''}`, 'bad');
      } else {
        setStatus(i, `✓ ${len.toFixed(2)} s at ${speed}x${rate > 1 ? ` (+${Math.round((rate - 1) * 100)}% squeeze)` : ''}`, 'ok');
      }
    }

    const total = Math.max(parsed.duration, cursor);
    const ctx = new OfflineAudioContext(1, Math.ceil(total * SAMPLE_RATE), SAMPLE_RATE);
    for (const p of placed) {
      const src = ctx.createBufferSource();
      src.buffer = p.buf;
      src.playbackRate.value = p.rate;
      src.connect(ctx.destination);
      src.start(p.at);
    }
    const rendered = await ctx.startRendering();
    const blob = encodeWav(rendered);

    const filename = `${safeName(parsed.name)}_voiceover_${stamp()}.wav`;
    const savedTo = await save(blob, filename, dir);

    $('preview').src = URL.createObjectURL(blob);
    $('savedTo').textContent = `Saved: ${savedTo}`;
    $('done').hidden = false;
    if (overflows) {
      showWarn(`${overflows} line(s) didn't fit their slot. Shorten the text in red rows and generate again.`);
    }
  } catch (e) {
    showWarn(e.message || String(e), true);
  } finally {
    busy = false;
    $('gen').textContent = 'Generate';
    $('gen').disabled = !parsed?.segments.length;
  }
}

async function save(blob, filename, dir) {
  if (dir) {
    const fh = await dir.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return `${dir.name}\\${filename}`;
  }
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  return `Downloads\\${filename}`;
}

function safeName(s) {
  return (s || 'voiceover').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function showWarn(msg, error = false) {
  $('warn').textContent = msg;
  $('warn').className = 'warn' + (error ? ' error' : '');
  $('warn').hidden = false;
}

function hideWarn() {
  $('warn').hidden = true;
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
