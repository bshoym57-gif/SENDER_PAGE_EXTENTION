const statusEl = document.getElementById('status');
const dot = document.getElementById('dot');
const logContainer = document.getElementById('logContainer');
const statSent = document.getElementById('statSent');
const statFailed = document.getElementById('statFailed');
const statSkipped = document.getElementById('statSkipped');
const statLoaded = document.getElementById('statLoaded');
const loadingProgress = document.getElementById('loadingProgress');
const loadedCount = document.getElementById('loadedCount');

const loadBtn = document.getElementById('loadBtn');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');

const replyTitleInput = document.getElementById('replyTitleInput');
const skipCountInput = document.getElementById('skipCountInput');
const startFromInput = document.getElementById('startFromInput');

function setStatus(msg, color = '#a5a8ae', dotState = 'off') {
    statusEl.innerText = msg;
    statusEl.style.color = color;
    dot.className = 'status-dot' + (dotState === 'on' ? ' on' : dotState === 'loading' ? ' loading' : '');
}

// ============================================
// استرجاع الإعدادات المحفوظة عند فتح الـ popup
// ============================================
(async () => {
    const data = await chrome.storage.local.get('botSettings');
    if (data.botSettings) {
        if (data.botSettings.savedReplyTitle) replyTitleInput.value = data.botSettings.savedReplyTitle;
        if (typeof data.botSettings.skipCount !== 'undefined') skipCountInput.value = data.botSettings.skipCount;
        if (data.botSettings.startFromName) startFromInput.value = data.botSettings.startFromName;
    }
})();

function collectSettings() {
    return {
        savedReplyTitle: replyTitleInput.value.trim() || 'BM AUTO',
        skipCount: Math.max(0, parseInt(skipCountInput.value, 10) || 0),
        startFromName: startFromInput.value.trim()
    };
}

// حفظ الإعدادات تلقائياً عند أي تغيير
[replyTitleInput, skipCountInput, startFromInput].forEach(input => {
    input.addEventListener('change', async () => {
        await chrome.storage.local.set({ botSettings: collectSettings() });
    });
});

// ============================================
// البحث عن تاب فيسبوك
// ============================================
async function findBotTab() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes('facebook.com')) {
        await chrome.storage.local.set({ botTabId: activeTab.id });
        return activeTab.id;
    }

    const data = await chrome.storage.local.get('botTabId');
    if (data.botTabId) {
        try {
            const tab = await chrome.tabs.get(data.botTabId);
            if (tab && tab.url && tab.url.includes('facebook.com')) {
                return tab.id;
            }
        } catch (e) { /* التاب مش موجود */ }
    }

    const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
    if (tabs.length > 0) {
        await chrome.storage.local.set({ botTabId: tabs[0].id });
        return tabs[0].id;
    }

    return null;
}

async function sendToTab(action, extra = {}) {
    const tabId = await findBotTab();
    if (!tabId) {
        setStatus('❌ افتح تاب فيسبوك أولاً', '#e06c66');
        return { success: false };
    }
    try {
        const res = await chrome.tabs.sendMessage(tabId, { action, ...extra });
        return { success: true, data: res };
    } catch (e) {
        try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
            await new Promise(r => setTimeout(r, 400));
            const res = await chrome.tabs.sendMessage(tabId, { action, ...extra });
            return { success: true, data: res };
        } catch (e2) {
            setStatus('❌ فشل الاتصال بالتاب: ' + e2.message, '#e06c66');
            return { success: false };
        }
    }
}

// ============================================
// زر: تحميل المحادثات فقط (بدون أي إرسال)
// ============================================
loadBtn.addEventListener('click', async () => {
    setStatus('⏳ جاري التحميل...', '#d9a441', 'loading');
    loadBtn.disabled = true;

    const res = await sendToTab('LOAD_ONLY');
    if (res.success) {
        setStatus('🔄 التحميل جارٍ... (بدون إرسال)', '#d9a441', 'loading');
    } else {
        loadBtn.disabled = false;
    }
});

// ============================================
// زر: بدء الإرسال للمحمّل (مع الإعدادات)
// ============================================
sendBtn.addEventListener('click', async () => {
    const settings = collectSettings();
    await chrome.storage.local.set({ botSettings: settings });

    setStatus('📨 بدء الإرسال...', '#4caf7d', 'on');
    sendBtn.disabled = true;
    loadBtn.disabled = true;

    const res = await sendToTab('SEND_LOADED', { settings });
    if (res.success) {
        setStatus('🟢 الإرسال جارٍ للمحادثات المحملة', '#4caf7d', 'on');
    } else {
        sendBtn.disabled = false;
        loadBtn.disabled = false;
    }
});

// ============================================
// زر: إيقاف فوري لأي عملية
// ============================================
stopBtn.addEventListener('click', async () => {
    setStatus('⏹️ جاري الإيقاف...', '#d9a441');
    await sendToTab('STOP_ALL');
});

// ============================================
// زر: Reset كامل
// ============================================
resetBtn.addEventListener('click', async () => {
    if (!confirm('هترجع الإضافة زي أول ما ثبّتها بالظبط (مسح كل البيانات المحفوظة). متأكد؟')) return;

    await sendToTab('RESET');
    await chrome.storage.local.clear();

    setStatus('♻️ تمت إعادة الضبط — الإضافة رجعت كأنها لسه متثبتة', '#8a8d94');
    loadingProgress.classList.remove('show');
    statSent.innerText = '0';
    statFailed.innerText = '0';
    statSkipped.innerText = '0';
    statLoaded.innerText = '0';
    logContainer.innerHTML = '';
    replyTitleInput.value = 'BM AUTO';
    skipCountInput.value = '0';
    startFromInput.value = '';
    loadBtn.disabled = false;
    sendBtn.disabled = true;
});

// ============================================
// تحديث الإحصائيات والسجل والحالة كل ثانية
// ============================================
async function refreshUI() {
    const data = await chrome.storage.local.get(['stats', 'botLog', 'conversationQueue', 'currentMode']);
    const stats = data.stats || { sent: 0, failed: 0, skipped: 0 };
    const queue = data.conversationQueue || [];
    const mode = data.currentMode || 'idle';

    statSent.innerText = stats.sent;
    statFailed.innerText = stats.failed;
    statSkipped.innerText = stats.skipped;
    statLoaded.innerText = queue.length;

    if (mode === 'loading') {
        loadingProgress.classList.add('show');
        loadedCount.innerText = queue.length;
        setStatus('🔄 جاري تحميل المحادثات... (لن يبدأ الإرسال تلقائياً)', '#d9a441', 'loading');
        loadBtn.disabled = true;
        sendBtn.disabled = true; // ❗ ممنوع بدء الإرسال والتحميل شغال - استخدم إيقاف الأول
        stopBtn.disabled = false;
    } else if (mode === 'sending') {
        loadingProgress.classList.remove('show');
        setStatus(`🟢 يرسل... (${stats.sent + stats.failed + stats.skipped}/${queue.length})`, '#4caf7d', 'on');
        loadBtn.disabled = true;
        sendBtn.disabled = true;
        stopBtn.disabled = false;
    } else {
        loadingProgress.classList.remove('show');
        loadBtn.disabled = false;
        sendBtn.disabled = queue.length === 0;
        stopBtn.disabled = true;
        if (statusEl.innerText.includes('جاري') || statusEl.innerText.includes('يرسل') || statusEl.innerText.includes('الإيقاف')) {
            setStatus(queue.length > 0 ? `⏸️ متوقف — ${queue.length} محادثة محملة` : 'جاهز...', '#a5a8ae');
        }
    }

    const logs = data.botLog || [];
    logContainer.innerHTML = '';
    logs.slice(-25).forEach(log => {
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + (log.type || 'info');
        entry.innerText = log.message;
        logContainer.appendChild(entry);
    });
    logContainer.scrollTop = logContainer.scrollHeight;
}

(async () => {
    const tabId = await findBotTab();
    if (!tabId) {
        setStatus('افتح فيسبوك في هذا التاب أولاً', '#8a8d94');
    }
    await refreshUI();
})();

setInterval(refreshUI, 1000);
