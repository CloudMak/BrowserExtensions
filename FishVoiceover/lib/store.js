export const DEFAULTS = { apiKey: '', model: 's2.1-pro', voiceId: '', speed: 1, fps: 25 };

export async function getSettings() {
  const s = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...s };
}

export function saveSettings(values) {
  return chrome.storage.local.set(values);
}

// The output folder handle lives in IndexedDB (storage can't hold FileSystemDirectoryHandle).
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('fishvoiceover', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function getDirHandle() {
  const db = await openDb();
  return new Promise((resolve) => {
    const req = db.transaction('kv').objectStore('kv').get('outDir');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export async function setDirHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    if (handle) store.put(handle, 'outDir');
    else store.delete('outDir');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
