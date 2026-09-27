let shot = null; // last capture, handed to the viewer tab when it loads

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// captureVisibleTab is rate limited, so back off and retry instead of failing.
async function grab(windowId) {
  for (let i = 0; i < 6; i++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (e) {
      await sleep(600);
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === 'grab') {
    grab(sender.tab.windowId).then(respond);
    return true;
  }
  if (msg?.type === 'get') respond(shot);
});

const badge = (text, color = '#4F46E5') => {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
};

chrome.action.onClicked.addListener(async (tab) => {
  if (!/^(https?|file):/.test(tab.url || '')) {
    badge('n/a', '#B91C1C');
    return setTimeout(() => badge(''), 2000);
  }
  badge('...');
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['capture.js'],
    });
    if (!result?.image) throw new Error('nothing captured');
    const host = new URL(tab.url).hostname || 'page';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    shot = { ...result, name: `${host}-${stamp}.png`, source: tab.title || tab.url };
    badge('');
    await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html'), index: tab.index + 1 });
  } catch (e) {
    console.error(e);
    badge('err', '#B91C1C');
    setTimeout(() => badge(''), 3000);
  }
});
