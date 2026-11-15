// Turns Kdenlive input into voiceover segments on the output timeline.
// Accepts either:
//  1) a timeline clip copied with Ctrl+C in Kdenlive (<kdenlive-scene> XML with kdenlive:speech word timings), or
//  2) text copied from the Speech Editor ("00:00:02:12 text" lines, "No speech" lines allowed).
// Returns { name, duration, positionFrames, fps, segments: [{ start, slotEnd, text }] } in seconds.

const NO_SPEECH = /^\s*no speech\s*$/i;
const GAP = 0.1; // keep this much silence before the next line

export function parseInput(raw, fps = 25) {
  const src = (raw || '').trim();
  if (!src) return null;
  const result = src.startsWith('<') ? parseKdenliveXml(src) : parseTimecodedText(src, fps);
  finalizeSlots(result);
  return result;
}

function finalizeSlots(r) {
  r.segments.sort((a, b) => a.start - b.start);
  r.segments.forEach((s, i) => {
    const next = r.segments[i + 1];
    const limit = next ? next.start - GAP : r.duration;
    s.slotEnd = Math.max(s.start + 0.3, limit);
  });
}

function parseKdenliveXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Could not read the Kdenlive XML.');
  const scene = doc.documentElement;
  const fps = parseFloat(scene.getAttribute('fps')) || 25;

  // Bin clips: kdenlive:id -> transcript HTML and file name
  const bin = {};
  for (const el of doc.getElementsByTagName('*')) {
    if (el.tagName !== 'chain' && el.tagName !== 'producer') continue;
    const props = {};
    for (const p of el.children) if (p.tagName === 'property') props[p.getAttribute('name')] = p.textContent;
    const id = props['kdenlive:id'];
    if (id) {
      bin[id] = {
        speech: props['kdenlive:speech'] || '',
        name: (props['resource'] || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
      };
    }
  }

  // Timeline clips (audio + video halves of one clip share binid/position/in — keep one)
  const seen = new Set();
  const clips = [];
  for (const c of scene.children) {
    if (c.tagName !== 'clip') continue;
    const clip = {
      binId: c.getAttribute('binid'),
      position: +c.getAttribute('position') || 0,
      inF: +c.getAttribute('in') || 0,
      outF: +c.getAttribute('out') || 0,
      speed: parseFloat(c.getAttribute('speed')) || 1
    };
    const key = `${clip.binId}|${clip.position}|${clip.inF}`;
    if (!seen.has(key)) {
      seen.add(key);
      clips.push(clip);
    }
  }
  if (!clips.length) throw new Error('No clips found in the pasted XML.');

  const minPos = Math.min(...clips.map((c) => c.position));
  let duration = (+scene.getAttribute('duration') || 0) / fps;
  const segments = [];
  const missing = [];

  for (const clip of clips) {
    const info = bin[clip.binId];
    const clipLen = (clip.outF - clip.inF + 1) / fps / Math.abs(clip.speed);
    const clipStart = (clip.position - minPos) / fps;
    duration = Math.max(duration, clipStart + clipLen);
    if (!info?.speech) {
      missing.push(info?.name || `bin ${clip.binId}`);
      continue;
    }
    const inSec = clip.inF / fps;
    const outSec = (clip.outF + 1) / fps;
    for (const para of speechParagraphs(info.speech)) {
      // keep only words inside the part of the source the clip uses
      const words = para.filter((w) => {
        const mid = (w.a + w.b) / 2;
        return mid >= inSec && mid < outSec;
      });
      if (!words.length) continue;
      const text = words.map((w) => w.text).join(' ').replace(/\s+([,.!?;:…])/g, '$1').trim();
      if (!text || NO_SPEECH.test(text)) continue;
      segments.push({ start: clipStart + (words[0].a - inSec) / Math.abs(clip.speed), text });
    }
  }
  if (!segments.length) {
    throw new Error(
      missing.length
        ? `No transcript in the clip (${missing.join(', ')}). Run Transcribe in View → Speech Editor first.`
        : 'No speech found inside the clip range.'
    );
  }

  return {
    name: bin[clips[0].binId]?.name || 'voiceover',
    duration,
    fps,
    positionFrames: minPos,
    segments
  };
}

// kdenlive:speech is Qt rich text: <p><a href="binid#start:end"> word</a> ...</p>
function speechParagraphs(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const p of doc.querySelectorAll('p')) {
    const words = [];
    for (const a of p.querySelectorAll('a[href]')) {
      const m = a.getAttribute('href').match(/#([\d.]+):([\d.]+)/);
      const text = a.textContent.trim();
      if (!m || !text || NO_SPEECH.test(text)) continue;
      words.push({ a: parseFloat(m[1]), b: parseFloat(m[2]), text });
    }
    if (words.length) out.push(words);
  }
  return out;
}

// Lines like "00:00:11:15 text", "00:11.58 text", "00:00:10 text".
const TC_LINE = /^\s*((?:\d+:){1,3}\d+(?:[.,]\d+)?)\s+(.*)$/;

function tcToSeconds(tc, fps) {
  const parts = tc.replace(',', '.').split(':');
  let frames = 0;
  if (parts.length === 4) frames = parseFloat(parts.pop());
  const nums = parts.map(parseFloat);
  let sec = 0;
  for (const n of nums) sec = sec * 60 + n;
  return sec + frames / fps;
}

function parseTimecodedText(text, fps) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(TC_LINE);
    if (m) rows.push({ start: tcToSeconds(m[1], fps), text: m[2].trim() });
    else if (line.trim() && rows.length) rows[rows.length - 1].text += ' ' + line.trim();
  }
  if (!rows.length) throw new Error('No timecodes found. Paste a clip copied from the timeline or text from the Speech Editor.');

  rows.sort((a, b) => a.start - b.start);
  const speech = rows.filter((r) => r.text && !NO_SPEECH.test(r.text));
  const last = rows[rows.length - 1];
  const lastIsSpeech = !NO_SPEECH.test(last.text);
  // estimate the tail of the last spoken line (~14 chars per second)
  const duration = lastIsSpeech ? last.start + Math.max(1, last.text.length / 14) : last.start + 0.5;

  return {
    name: 'voiceover',
    duration,
    fps,
    positionFrames: null,
    segments: speech.map((r) => ({ start: r.start, text: r.text }))
  };
}

export function formatTc(sec, fps = 25) {
  const totalFrames = Math.round(sec * fps);
  const f = totalFrames % fps;
  const s = Math.floor(totalFrames / fps);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}
