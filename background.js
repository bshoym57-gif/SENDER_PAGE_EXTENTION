// background.js v8.0 - keepalive via chrome.alarms
chrome.runtime.onInstalled.addListener(() => {
    console.log('[FB Bot v8.0] installed');
    chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'keepAlive') return;
    const data = await chrome.storage.local.get(['botTabId', 'currentMode']);
    if (!data.botTabId || data.currentMode === 'idle') return;
    try {
        await chrome.tabs.sendMessage(data.botTabId, { action: 'HEARTBEAT' });
    } catch (e) {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'HEARTBEAT') {
        sendResponse({ ok: true });
    }
    return true;
});