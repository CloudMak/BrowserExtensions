// fish.audio REST API: POST /v1/tts (Bearer key, `model` header, prosody.speed 0.5–2.0).
export async function tts({ apiKey, model, voiceId, text, speed = 1 }) {
  const body = {
    text,
    format: 'wav',
    normalize: true,
    latency: 'normal',
    prosody: { speed: Math.min(2, Math.max(0.5, speed)) }
  };
  if (voiceId) body.reference_id = voiceId;

  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      model
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const hint =
      res.status === 401 ? ' (check the API key in Settings)' :
      res.status === 402 ? ' (no API credit for this model — add credit or use s2.1-pro-free)' : '';
    throw new Error(`fish.audio ${res.status}${hint}: ${detail.slice(0, 200)}`);
  }
  return res.arrayBuffer();
}

export function mapPageModel(name) {
  const n = (name || '').toLowerCase();
  if (/drama\s*3/.test(n)) return 'drama-3';
  if (/s2\.1/.test(n)) return /free/.test(n) ? 's2.1-pro-free' : 's2.1-pro';
  if (/s2/.test(n)) return 's2-pro';
  if (/\bs1\b/.test(n)) return 's1';
  return '';
}
