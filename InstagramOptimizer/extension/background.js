// Blocks image downloads of hidden posts via dynamic declarativeNetRequest rules.
// hiddenMedia (storage.local): { postCode: [imageFileName, ...] }
// unblocked (storage.session): post codes the user expanded in this browser session
const MAX_RULES = 29000;
let queue = Promise.resolve();

function rebuild() {
  queue = queue.then(async () => {
    const { hiddenMedia = {} } = await chrome.storage.local.get('hiddenMedia');
    const { unblocked = [] } = await chrome.storage.session.get('unblocked');
    const skip = new Set(unblocked);
    const names = new Set();
    for (const [code, list] of Object.entries(hiddenMedia)) {
      if (!skip.has(code)) list.forEach((n) => names.add(n));
    }
    const addRules = [...names].slice(0, MAX_RULES).map((n, i) => ({
      id: i + 1,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '/' + n, resourceTypes: ['image'] }
    }));
    const old = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: old.map((r) => r.id),
      addRules
    });
  }).catch((e) => console.error('Ig Optimizer: rule update failed', e));
  return queue;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'unblock') return;
  (async () => {
    const { unblocked = [] } = await chrome.storage.session.get('unblocked');
    const set = new Set(unblocked);
    if (msg.value) set.add(msg.code); else set.delete(msg.code);
    await chrome.storage.session.set({ unblocked: [...set] });
    await rebuild();
    reply(true);
  })();
  return true; // async reply
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.hiddenMedia) rebuild();
});
chrome.runtime.onInstalled.addListener(rebuild);
chrome.runtime.onStartup.addListener(rebuild);
