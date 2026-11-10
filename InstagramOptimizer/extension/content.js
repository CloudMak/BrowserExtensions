// Labels of suggested / sponsored blocks (EN + RU Instagram UI)
const LABEL = /^(suggested for you|suggested posts|suggested reels|suggested threads|sponsored|рекомендации для вас|рекомендуем вам|рекомендуемые публикации|рекомендуемые reels|реклама|спонсорский контент)$/i;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IG_EPOCH = 1314220021721; // Instagram ID epoch, ms
const CODE_RE = /\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/;
const USER_RE = /^\/([A-Za-z0-9._]+)\/$/;

const root = document.documentElement;
const opts = { onlyFollowing: true, dates: true, noLoop: true, showHidden: true, hidePublics: false };
const GROUPS = [{ id: 'publics', name: 'Publics' }, { id: 'friends', name: 'Friends' }];
let hidden = new Set();
let hiddenMedia = {}; // postCode -> image file names blocked from download
let userGroups = {}; // username -> group id
const expanded = new Set(); // hidden posts expanded in this tab
let lastUserAction = 0;

const isHome = () => location.pathname === '/';
const fmt = (d) => d.toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

// Post date from shortcode: the top 41 bits of the media ID are ms since the Instagram epoch
function codeDate(code) {
  let id = 0n;
  for (const c of code.slice(0, 11)) {
    const i = ALPHA.indexOf(c);
    if (i < 0) return null;
    id = id * 64n + BigInt(i);
  }
  const d = new Date(Number(id >> 23n) + IG_EPOCH);
  return isNaN(d) ? null : d;
}

function postCode(article) {
  for (const a of article.querySelectorAll('a[href]')) {
    const m = a.getAttribute('href').match(CODE_RE);
    if (m) return m[1];
  }
  const m = location.pathname.match(CODE_RE);
  return m ? m[1] : null;
}

function postAuthor(article) {
  for (const a of article.querySelectorAll('a[href]')) {
    const m = a.getAttribute('href').match(USER_RE);
    if (m && a.textContent.trim()) return m[1];
  }
  return '';
}

// ---------- Following only ----------
function redirect() {
  if (isHome() && new URLSearchParams(location.search).get('variant') !== 'following') {
    location.replace('/?variant=following');
  }
}

// Feed list = lowest common ancestor of the feed posts
function feedRoot() {
  const arts = document.querySelectorAll('main article');
  if (arts.length < 2) return null;
  let el = arts[0].parentElement;
  while (el && !el.contains(arts[arts.length - 1])) el = el.parentElement;
  return el;
}

// Non-post block inside the feed (e.g. "Suggested for you" carousel): the feed item that holds it
function feedBlock(el, root) {
  if (!root || !root.contains(el)) return null;
  while (el.parentElement && el.parentElement !== root) el = el.parentElement;
  return el.querySelector('article') ? null : el;
}

function scanSuggested() {
  if (!isHome()) return;
  const main = document.querySelector('main');
  if (!main) return;
  const root = feedRoot();
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (!t || t.length > 40 || !LABEL.test(t)) continue;
    const el = n.parentElement;
    if (!el || el.closest('[data-igo-hidden]') || el.closest('.igo-bar')) continue;
    const target = el.closest('article') || feedBlock(el, root);
    if (target) target.setAttribute('data-igo-hidden', '');
  }
}

// ---------- Groups ----------
function setGroup(user, group) {
  if (group) userGroups[user] = group; else delete userGroups[user];
  chrome.storage.local.set({ userGroups });
  run();
}

function groupSelect(user) {
  const sel = document.createElement('select');
  sel.className = 'igo-group';
  sel.dataset.user = user;
  sel.title = `Group for @${user}`;
  sel.add(new Option('No group', ''));
  for (const g of GROUPS) sel.add(new Option(g.name, g.id));
  syncSelect(sel);
  // Keep Instagram's own click/key handlers away from the control
  ['click', 'mousedown', 'pointerdown', 'pointerup', 'keydown'].forEach((e) =>
    sel.addEventListener(e, (ev) => ev.stopPropagation()));
  sel.addEventListener('change', () => setGroup(user, sel.value));
  return sel;
}

function syncSelect(sel) {
  const v = userGroups[sel.dataset.user] || '';
  if (sel.value !== v) sel.value = v;
  sel.dataset.group = v;
}

// Group dropdown in every row of the Following / Followers dialog
function processFollowList() {
  if (!/\/(following|followers)\/?$/.test(location.pathname)) return;
  const dlg = document.querySelector('[role=dialog]');
  if (!dlg) return;
  for (const a of dlg.querySelectorAll('a[href]')) {
    const m = a.getAttribute('href').match(USER_RE);
    if (!m || !a.textContent.trim()) continue;
    let row = a;
    while (row && row !== dlg && !row.querySelector('button')) row = row.parentElement;
    if (!row || row === dlg) continue;
    let sel = row.querySelector(':scope > .igo-group');
    if (sel && sel.dataset.user === m[1]) { syncSelect(sel); continue; }
    sel?.remove();
    sel = groupSelect(m[1]);
    const btnBox = [...row.children].find((c) => c.querySelector('button'));
    row.insertBefore(sel, btnBox || null);
  }
}

// ---------- Post bar: date + group + Hide / Expand / Unhide ----------
// Image file names of a post (avatars excluded) — stable across signed CDN URLs
function mediaNames(art) {
  const names = new Set();
  const add = (u) => {
    try {
      const url = new URL(u, location.href);
      if (/\/t51\.\d+-19\//.test(url.pathname)) return; // profile pictures
      const n = url.pathname.split('/').pop();
      if (/\.(jpe?g|png|webp|heic)$/i.test(n)) names.add(n);
    } catch {}
  };
  for (const img of art.querySelectorAll('img')) {
    if (/profile picture/i.test(img.alt)) continue;
    add(img.getAttribute('src') || '');
    (img.getAttribute('srcset') || '').split(',').forEach((p) => add(p.trim().split(/\s+/)[0]));
  }
  for (const v of art.querySelectorAll('video[poster]')) add(v.getAttribute('poster'));
  return [...names];
}

// Remember new image names of a hidden post so the background worker blocks them
function recordMedia(code, art) {
  const known = new Set(hiddenMedia[code] || []);
  const fresh = mediaNames(art).filter((n) => !known.has(n));
  if (!fresh.length) return;
  hiddenMedia[code] = [...known, ...fresh];
  chrome.storage.local.set({ hiddenMedia });
}

function reloadImages(art) {
  const bust = (u) => u.split('#')[0] + '#igo' + Date.now();
  for (const img of art.querySelectorAll('img')) {
    const set = img.getAttribute('srcset');
    if (set) img.setAttribute('srcset', set.split(',').map((p) => {
      const [u, w] = p.trim().split(/\s+/);
      return bust(u) + (w ? ' ' + w : '');
    }).join(', '));
    const src = img.getAttribute('src');
    if (src) img.setAttribute('src', bust(src));
  }
}

function setHidden(code, value, art) {
  if (value) {
    hidden.add(code);
    hiddenMedia[code] = mediaNames(art);
  } else {
    hidden.delete(code);
    expanded.delete(code);
    delete hiddenMedia[code];
    chrome.runtime.sendMessage({ type: 'unblock', code, value: false });
  }
  chrome.storage.local.set({ hidden: [...hidden], hiddenMedia });
  run();
}

async function toggleExpanded(code, art) {
  const open = !expanded.has(code);
  if (open) expanded.add(code); else expanded.delete(code);
  run();
  // Lift the image block while expanded, then refetch images blocked earlier
  await chrome.runtime.sendMessage({ type: 'unblock', code, value: open });
  if (open) reloadImages(art);
}

function button(text, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'igo-btn';
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}

function makeBar(art, code, author, isHidden, isExpanded) {
  const bar = document.createElement('div');
  bar.className = 'igo-bar';
  if (isHidden) {
    const l = document.createElement('span');
    l.className = 'igo-label';
    l.textContent = author ? `Hidden post · @${author}` : 'Hidden post';
    bar.append(l);
  }
  const d = codeDate(code);
  if (d) {
    const s = document.createElement('span');
    s.className = 'igo-date';
    s.textContent = fmt(d);
    bar.append(s);
  }
  const actions = document.createElement('span');
  actions.className = 'igo-actions';
  if (isHidden) {
    actions.append(
      button(isExpanded ? 'Collapse' : 'Expand', isExpanded ? 'Collapse this post' : 'Show this post', () => toggleExpanded(code, art)),
      button('Unhide', 'Stop hiding this post', () => setHidden(code, false, art))
    );
  } else {
    if (author) actions.append(groupSelect(author));
    actions.append(button('Hide', 'Hide this post', () => setHidden(code, true, art)));
  }
  bar.append(actions);
  return bar;
}

function processArticles() {
  for (const art of document.querySelectorAll('article')) {
    const code = postCode(art);
    if (!code) continue;
    const isHidden = hidden.has(code);
    const isExpanded = isHidden && expanded.has(code);
    art.toggleAttribute('data-igo-user-hidden', isHidden);
    art.toggleAttribute('data-igo-expanded', isExpanded);
    const author = postAuthor(art);
    art.toggleAttribute('data-igo-public', isHome() && userGroups[author] === 'publics');
    if (isHidden) recordMedia(code, art);
    const state = `${code}|${isHidden}|${isExpanded}|${author}`;
    const bar = art.querySelector(':scope > .igo-bar');
    if (bar && bar.dataset.state === state) {
      bar.querySelectorAll('.igo-group').forEach(syncSelect);
      continue;
    }
    bar?.remove();
    const nb = makeBar(art, code, author, isHidden, isExpanded);
    nb.dataset.state = state;
    art.prepend(nb);
  }
}

// ---------- Exact dates for comments and other <time> ----------
function processTimes() {
  for (const t of document.querySelectorAll('time[datetime]')) {
    const src = t.getAttribute('datetime');
    if (t.dataset.igoSrc === src) continue;
    const d = new Date(src);
    if (isNaN(d)) continue;
    t.dataset.igoSrc = src;
    t.dataset.igoDate = fmt(d);
  }
}

// ---------- Play videos once ----------
function processVideos() {
  for (const v of document.querySelectorAll('video')) {
    if (!v._igo) {
      v._igo = true;
      v.addEventListener('ended', () => { v._igoEnded = true; });
      v.addEventListener('play', () => {
        if (!opts.noLoop) return;
        if (v.loop) { v.loop = false; v._igoWasLoop = true; }
        // A restart without user action is an auto-replay — stop it
        if (v._igoEnded && Date.now() - lastUserAction > 1000) v.pause();
        else v._igoEnded = false;
      });
    }
    if (opts.noLoop && v.loop) { v.loop = false; v._igoWasLoop = true; }
    if (!opts.noLoop && v._igoWasLoop) { v.loop = true; v._igoWasLoop = false; }
  }
}

['pointerdown', 'keydown'].forEach((e) =>
  document.addEventListener(e, () => { lastUserAction = Date.now(); }, true));

// ---------- Keep infinite scroll going ----------
// Instagram's virtualized feed reserves blank padding for posts it measures as 0 px tall
// (our hidden ones). That padding is removed via CSS on [data-igo-feed]. While fewer than
// two visible posts are left below the screen, synthetic scroll events keep the feed loading.
const AUTO_LIMIT = 60; // max posts auto-loaded without a new visible one, until the user scrolls
let autoBase = null;

function markFeed() {
  const root = feedRoot() || document.querySelector('main article')?.parentElement;
  if (root && !root.hasAttribute('data-igo-feed')) {
    document.querySelectorAll('[data-igo-feed]').forEach((e) => e.removeAttribute('data-igo-feed'));
    root.setAttribute('data-igo-feed', '');
  }
}

function autoLoad() {
  if (!isHome()) return;
  const arts = document.querySelectorAll('main article');
  if (!arts.length) return;
  markFeed();
  let ahead = 0;
  for (const a of arts) {
    if (a.offsetHeight > 0 && !a.hasAttribute('data-igo-user-hidden') &&
        a.getBoundingClientRect().bottom > innerHeight) ahead++;
  }
  if (ahead >= 2) { autoBase = null; return; }
  if (autoBase === null) autoBase = arts.length;
  if (arts.length - autoBase > AUTO_LIMIT) return;
  window.dispatchEvent(new Event('scroll'));
}
setInterval(autoLoad, 800);
['wheel', 'touchmove', 'keydown'].forEach((e) =>
  addEventListener(e, () => { autoBase = null; }, { passive: true, capture: true }));

// ---------- Backfill image names of posts hidden before image blocking existed ----------
// Reads the post's media info from Instagram's API (JSON only, no image download).
const triedBackfill = new Set();
let backfilling = false;

function mediaId(code) {
  let id = 0n;
  for (const c of code.slice(0, 11)) id = id * 64n + BigInt(ALPHA.indexOf(c));
  return id.toString();
}

async function backfillMedia() {
  if (backfilling) return;
  backfilling = true;
  try {
    const todo = [...hidden].filter((c) => !hiddenMedia[c]?.length && !triedBackfill.has(c));
    let changed = 0;
    for (const code of todo) {
      if (!hidden.has(code) || hiddenMedia[code]?.length) continue;
      triedBackfill.add(code);
      const r = await fetch(`/api/v1/media/${mediaId(code)}/info/`, {
        headers: { 'x-ig-app-id': '936619743392459' }, credentials: 'include'
      }).catch(() => null);
      if (!r) continue;
      if (r.status === 429 || r.status === 401 || r.status === 403) break; // rate limited / logged out
      if (r.ok) {
        const item = (await r.json().catch(() => null))?.items?.[0];
        const names = new Set();
        for (const m of item ? (item.carousel_media || [item]) : []) {
          for (const c of m.image_versions2?.candidates || []) {
            try { names.add(new URL(c.url).pathname.split('/').pop()); } catch {}
          }
        }
        if (names.size) { hiddenMedia[code] = [...names]; changed++; }
      }
      if (changed && changed % 10 === 0) chrome.storage.local.set({ hiddenMedia });
      await new Promise((res) => setTimeout(res, 1500));
    }
    if (changed) chrome.storage.local.set({ hiddenMedia });
  } finally {
    backfilling = false;
  }
}

// ---------- Main loop ----------
function run() {
  if (opts.onlyFollowing) { redirect(); scanSuggested(); }
  processArticles();
  processFollowList();
  processTimes();
  processVideos();
}

function apply() {
  root.classList.toggle('igo-on', opts.onlyFollowing);
  root.classList.toggle('igo-dates', opts.dates);
  root.classList.toggle('igo-show-hidden', opts.showHidden);
  root.classList.toggle('igo-hide-publics', opts.hidePublics);
  run();
}

let pending = false;
new MutationObserver(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; run(); });
}).observe(root, { childList: true, subtree: true });

chrome.storage.sync.get(opts, (r) => {
  Object.assign(opts, r);
  chrome.storage.local.get({ hidden: [], hiddenMedia: {}, userGroups: {} }, (l) => {
    hidden = new Set(l.hidden);
    userGroups = l.userGroups;
    hiddenMedia = l.hiddenMedia;
    apply();
    setTimeout(backfillMedia, 3000);
  });
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.hidden) hidden = new Set(c.hidden.newValue || []);
  if (area === 'local' && c.hiddenMedia) hiddenMedia = c.hiddenMedia.newValue || {};
  if (area === 'local' && c.userGroups) userGroups = c.userGroups.newValue || {};
  if (area === 'sync') for (const k in opts) if (c[k]) opts[k] = c[k].newValue;
  apply();
});
