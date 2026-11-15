import { getSettings, saveSettings, getDirHandle, setDirHandle, DEFAULTS } from './lib/store.js';

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await getSettings();
  for (const k of Object.keys(DEFAULTS)) $(k).value = s[k];
  await showFolder();
}

async function showFolder() {
  const dir = await getDirHandle();
  $('folder').textContent = dir ? dir.name : 'Downloads (default)';
}

$('pick').addEventListener('click', async () => {
  try {
    const dir = await window.showDirectoryPicker({ id: 'fishvoiceover', mode: 'readwrite' });
    await setDirHandle(dir);
    await showFolder();
  } catch (e) {
    if (e.name !== 'AbortError') alert(e.message);
  }
});

$('reset').addEventListener('click', async () => {
  await setDirHandle(null);
  await showFolder();
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    voiceId: $('voiceId').value.trim(),
    speed: parseFloat($('speed').value) || 1,
    fps: parseInt($('fps').value, 10) || 25
  });
  $('saved').hidden = false;
  setTimeout(() => ($('saved').hidden = true), 1500);
});

load();
