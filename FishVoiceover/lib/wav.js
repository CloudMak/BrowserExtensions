// 16-bit PCM WAV encoder for an AudioBuffer.
export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const frames = buffer.length;
  const dataSize = frames * ch * 2;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));

  str(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);

  const chans = [...Array(ch)].map((_, i) => buffer.getChannelData(i));
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

// Cuts leading/trailing silence so each line uses its time slot for speech only.
export function trimSilence(buffer, threshold = 0.01, pad = 0.02) {
  const data = buffer.getChannelData(0);
  let a = 0;
  let b = data.length - 1;
  while (a < b && Math.abs(data[a]) < threshold) a++;
  while (b > a && Math.abs(data[b]) < threshold) b--;
  const p = Math.round(pad * buffer.sampleRate);
  a = Math.max(0, a - p);
  b = Math.min(data.length - 1, b + p);
  const len = Math.max(1, b - a + 1);
  const out = new AudioBuffer({ length: len, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.copyToChannel(buffer.getChannelData(c).subarray(a, a + len), c);
  }
  return out;
}
