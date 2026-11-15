const defaults = { onlyFollowing: true, dates: true, noLoop: true, showHidden: true, hidePublics: false };

chrome.storage.sync.get(defaults, (r) => {
  document.querySelectorAll('input[data-k]').forEach((i) => {
    i.checked = r[i.dataset.k];
    i.addEventListener('change', () => chrome.storage.sync.set({ [i.dataset.k]: i.checked }));
  });
});

// ---------- Export / import ----------
const LOCAL_KEYS = ['hidden', 'hiddenMedia', 'userGroups', 'loadStats'];
const msg = (t) => { document.getElementById('msg').textContent = t; };

document.getElementById('export').addEventListener('click', async () => {
  const local = await chrome.storage.local.get(LOCAL_KEYS);
  const settings = await chrome.storage.sync.get(defaults);
  const data = {
    app: 'ig-optimizer',
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings,
    local
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ig-optimizer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  msg(`Exported ${(local.hidden || []).length} hidden posts, ${Object.keys(local.userGroups || {}).length} grouped authors.`);
});

document.getElementById('import').addEventListener('click', () => document.getElementById('file').click());

document.getElementById('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    // Accept app backups and raw { l, s } console dumps
    const local = data.local || data.l;
    const settings = data.settings || data.s;
    if (!local || typeof local !== 'object') throw new Error('not an Ig Optimizer backup');
    const clean = {};
    for (const k of LOCAL_KEYS) if (k in local) clean[k] = local[k];
    await chrome.storage.local.set(clean);
    if (settings) {
      const s = {};
      for (const k in defaults) if (typeof settings[k] === 'boolean') s[k] = settings[k];
      await chrome.storage.sync.set(s);
      document.querySelectorAll('input[data-k]').forEach((i) => { if (i.dataset.k in s) i.checked = s[i.dataset.k]; });
    }
    msg(`Imported ${(clean.hidden || []).length} hidden posts, ${Object.keys(clean.userGroups || {}).length} grouped authors.`);
  } catch (err) {
    msg(`Import failed: ${err.message}`);
  }
});
