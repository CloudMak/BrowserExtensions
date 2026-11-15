# Fish Voiceover for Kdenlive

Voices over a Kdenlive transcript with the fish.audio API, keeps every line at its original timeline position, and saves one WAV you drop onto the timeline.

## Install
1. `chrome://extensions` → **Developer mode** on → **Load unpacked** → this folder.
2. Right-click the extension icon → **Options**: paste your fish.audio API key (fish.audio → **Developer** → **API Keys**), optionally pick an output folder (default: Downloads).

## Use
1. In Kdenlive, transcribe the clip (**View → Speech Editor** → **Transcribe**).
2. Select the clip on the timeline and press **Ctrl+C** (copies XML with word timings, in/out points and position).
   Timecoded text (`00:00:11:15 text` lines) works too. **Copy text** in the window turns pasted XML into that form.
3. On fish.audio **Text to Speech**, choose the voice, then click **Kdenlive Voiceover** (next to **Generate Speech**).
   The window picks up the page's voice and model.
4. Paste, edit lines if needed (e.g. translate), click **Generate**.
5. Drop the WAV on the timeline at the position shown in the window (where the clip starts).

## How fitting works
- Each line may use the time until the next line starts (minus 0.1 s).
- Leading/trailing silence of each TTS result is trimmed.
- Too long → regenerated with a higher `prosody.speed` (up to 2 retries), then squeezed up to 10% by playback rate.
- Still too long → the row turns red and following lines are pushed later; shorten that text and generate again.

## Files
- `content.js` — injects the button on fish.audio, reads the selected voice/model/speed.
- `voiceover.html/js` — paste, parse, generate, mix, save.
- `lib/parse.js` — Kdenlive XML / Speech Editor text → segments.
- `lib/fish.js` — `POST https://api.fish.audio/v1/tts`.
- `lib/wav.js` — silence trim + WAV encoder.
- `options.html/js` — API key, defaults, output folder.
