const defaults = { onlyFollowing: true, dates: true, noLoop: true, showHidden: true, hidePublics: false };

chrome.storage.sync.get(defaults, (r) => {
  document.querySelectorAll('input[data-k]').forEach((i) => {
    i.checked = r[i.dataset.k];
    i.addEventListener('change', () => chrome.storage.sync.set({ [i.dataset.k]: i.checked }));
  });
});
