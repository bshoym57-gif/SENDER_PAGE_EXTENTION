/**
 * 🤖 FB Smart Auto Responder v7.3
 * - ويدجيت احترافي محقون في الصفحة (أعلى اليمين) مع بروجريس متزامن وإعدادات
 * - إصلاح التخطي: "تخطي أول X" أصبح مطلقاً - يتخطى أول X تماماً ويبدأ من بعدهم دائماً
 * - إصلاح "لم يتم العثور" بعد الريفريش: تمرير صبور بجولات ثبات + إعادة محاولة من أعلى القائمة
 * - إعادة محاولة تلقائية للمحادثات اللي فشلت سابقاً بسبب "لم يتم العثور"
 * - فصل كامل بين التحميل والإرسال + قفل تشغيل صارم + إيقاف فوري
 */

// ============================================
// الحالة الرئيسية
// ============================================
let currentMode = 'idle'; // idle | loading | sending
let processedChats = new Set();
let failedChats = new Set();
let stats = { sent: 0, skipped: 0, failed: 0 };
let conversationQueue = []; // [{key, name}]
let queueIndex = 0;
let loadingComplete = false;
let recentLogs = []; // للعرض في الويدجيت

let settings = {
    savedReplyTitle: 'BM AUTO',
    skipCount: 0,
    startFromName: ''
};

let stopLoadingFlag = false;
let stopSendingFlag = false;

console.log("✅ [FB Bot v7.3] تم تحميل السكريبت بنجاح!");

// ============================================
// نظام التسجيل
// ============================================
async function addLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('ar');
    const logMessage = `[${timestamp}] ${message}`;

    recentLogs.push({ message: logMessage, type });
    if (recentLogs.length > 40) recentLogs.shift();

    try {
        const data = await chrome.storage.local.get('botLog');
        const logs = data.botLog || [];
        logs.push({ message: logMessage, type });
        if (logs.length > 150) logs.shift();
        await chrome.storage.local.set({ botLog: logs });
    } catch (e) { /* غير حرج */ }
    console.log(message);
}

async function persistState() {
    try {
        await chrome.storage.local.set({
            stats,
            processedChats: Array.from(processedChats),
            failedChats: Array.from(failedChats),
            conversationQueue,
            queueIndex,
            loadingComplete,
            currentMode
        });
    } catch (e) { /* غير حرج */ }
}

// ============================================
// Anti-throttling
// ============================================
let _audioCtx = null;
function startAntiThrottle() {
    try {
        _audioCtx = new AudioContext();
        const buffer = _audioCtx.createBuffer(1, 1, 22050);
        const source = _audioCtx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(_audioCtx.destination);
        source.start();
    } catch (e) { /* غير حرج */ }
}
startAntiThrottle();
document.addEventListener('visibilitychange', () => {
    if (document.hidden && (!_audioCtx || _audioCtx.state !== 'running')) {
        startAntiThrottle();
    }
});

// ============================================
// تحميل الحالة المحفوظة عند بدء السكريبت
// ============================================
chrome.storage.local.get(
    ['processedChats', 'failedChats', 'conversationQueue', 'queueIndex', 'stats', 'loadingComplete', 'botSettings'],
    (result) => {
        if (result.processedChats) processedChats = new Set(result.processedChats);
        if (result.failedChats) failedChats = new Set(result.failedChats);
        if (result.conversationQueue) conversationQueue = result.conversationQueue;
        if (typeof result.queueIndex === 'number') queueIndex = result.queueIndex;
        if (result.stats) stats = result.stats;
        if (typeof result.loadingComplete === 'boolean') loadingComplete = result.loadingComplete;
        if (result.botSettings) settings = { ...settings, ...result.botSettings };

        currentMode = 'idle';
        persistState();

        if (conversationQueue.length > 0 || processedChats.size > 0) {
            addLog(`📊 استرجاع الحالة: ${processedChats.size} ناجحة، ${failedChats.size} فاشلة، ${conversationQueue.length} محملة`, "info");
        }
    }
);

function randomDelay(min, max) {
    return new Promise(resolve =>
        setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min))
    );
}

// ============================================
// 🧑 محاكاة السلوك البشري
// ============================================
function humanClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
    const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);

    const eventOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        button: 0
    };

    el.dispatchEvent(new PointerEvent('pointerover', { ...eventOpts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseover', eventOpts));
    el.dispatchEvent(new MouseEvent('mousemove', eventOpts));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...eventOpts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...eventOpts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    el.click();
}

async function humanClickWithHover(el) {
    await randomDelay(150, 450);
    humanClick(el);
}

function smartDelay() {
    const baseDelay = 3500 + Math.random() * 3500;
    const errorRatio = stats.failed / Math.max(stats.sent + stats.failed, 1);
    const multiplier = 1 + errorRatio * 0.8;
    return Math.floor(baseDelay * multiplier);
}

let messagesSinceBreak = 0;
let nextBreakAt = 12 + Math.floor(Math.random() * 7);

async function maybeHumanBreak() {
    messagesSinceBreak++;
    if (messagesSinceBreak >= nextBreakAt) {
        const breakMs = 15000 + Math.floor(Math.random() * 25000);
        addLog(`☕ استراحة قصيرة (${Math.round(breakMs / 1000)} ثانية) لمحاكاة السلوك البشري...`, "info");
        await randomDelay(breakMs, breakMs + 2000);
        messagesSinceBreak = 0;
        nextBreakAt = 12 + Math.floor(Math.random() * 7);
    }
}

// ============================================
// البحث عن العناصر
// ============================================
function findByLabel(labelText) {
    const elements = document.querySelectorAll(`[aria-label*="${labelText}"]`);
    return elements.length > 0 ? elements[0] : null;
}

function findAllByLabel(labelText) {
    return document.querySelectorAll(`[aria-label*="${labelText}"]`);
}

const NAME_CLASS_SELECTOR = 'div.x1vvvo52.xxio538.x12nagc.xeuugli';

function getConversationNameRows() {
    let rows = Array.from(document.querySelectorAll(NAME_CLASS_SELECTOR));
    return rows.filter(r => r.innerText && r.innerText.trim().length > 0);
}

function buildRowKey(nameEl) {
    const name = nameEl.innerText.trim();

    let container = nameEl.parentElement;
    for (let i = 0; i < 4 && container && container.parentElement; i++) {
        container = container.parentElement;
    }

    let fullText = container ? container.innerText : name;
    let fingerprint = fullText.replace(name, '').trim().replace(/\s+/g, ' ').slice(0, 60);

    return fingerprint ? `${name}||${fingerprint}` : name;
}

function getConversationRowsWithKeys() {
    return getConversationNameRows().map(el => ({ el, name: el.innerText.trim(), key: buildRowKey(el) }));
}

// ============================================
// Scroll container
// ============================================
function findScrollContainer(sampleEl) {
    let el = sampleEl;
    let depth = 0;
    while (el && el !== document.body && depth < 15) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 5) {
            return el;
        }
        el = el.parentElement;
        depth++;
    }
    return null;
}

async function humanScroll(container, totalAmount) {
    const steps = 2 + Math.floor(Math.random() * 3);
    const perStep = totalAmount / steps;
    for (let i = 0; i < steps; i++) {
        container.scrollTop += perStep * (0.8 + Math.random() * 0.4);
        await randomDelay(80, 200);
    }
}

// ============================================
// 📋 تحميل المحادثات فقط (بدون أي إرسال تلقائي)
// ============================================
async function buildConversationQueue() {
    currentMode = 'loading';
    stopLoadingFlag = false;
    await persistState();

    const seenKeys = new Set(conversationQueue.map(c => c.key));
    const startCount = conversationQueue.length;

    addLog(`📋 بدء التحميل (يوجد ${startCount} محادثة محملة مسبقاً)...`, "info");

    let stableCount = 0;
    const MAX_STABLE_ROUNDS = 5;
    let lastSaveCount = conversationQueue.length;

    while (stableCount < MAX_STABLE_ROUNDS && !stopLoadingFlag) {
        const rows = getConversationRowsWithKeys();
        let addedNew = false;

        for (const r of rows) {
            if (!seenKeys.has(r.key)) {
                seenKeys.add(r.key);
                conversationQueue.push({ key: r.key, name: r.name });
                addedNew = true;
            }
        }

        if (conversationQueue.length - lastSaveCount >= 15) {
            await persistState();
            lastSaveCount = conversationQueue.length;
        }

        const container = findScrollContainer(rows[rows.length - 1]?.el || document.body);
        if (!container) break;

        const beforeScroll = container.scrollTop;
        await humanScroll(container, 600);
        await randomDelay(500, 900);

        if (container.scrollTop === beforeScroll && !addedNew) {
            stableCount++;
            await randomDelay(800, 1500);
        } else {
            stableCount = 0;
        }
    }

    const wasStoppedManually = stopLoadingFlag;
    loadingComplete = !wasStoppedManually;

    currentMode = 'idle';
    await persistState();
    addLog(
        wasStoppedManually
            ? `⏹️ تم إيقاف التحميل يدوياً عند ${conversationQueue.length} محادثة`
            : `✅ اكتمل التحميل: ${conversationQueue.length} محادثة إجمالاً`,
        "success"
    );
}

// ============================================
// 🖱️ النقر على محادثة - نسخة صبورة v7.3
// - جولات ثبات بدل الاستسلام من أول توقف scroll (الشبكة البطيئة)
// - محاولات أكتر بكتير (تكفي مئات المحادثات)
// - إعادة محاولة أخيرة من أعلى القائمة قبل تسجيل الفشل
// ============================================
async function clickConversationByKey(targetKey, targetName, opts = {}) {
    const maxScrollAttempts = opts.maxScrollAttempts || 45;
    const allowFromTopRetry = opts.allowFromTopRetry !== false;

    let stableRounds = 0;

    for (let attempt = 0; attempt < maxScrollAttempts; attempt++) {
        if (stopSendingFlag) return false;

        const rows = getConversationRowsWithKeys();

        let target = rows.find(r => r.key === targetKey);

        if (!target) {
            const sameNameRows = rows.filter(r => r.name === targetName);
            if (sameNameRows.length === 1) {
                target = sameNameRows[0];
            }
        }

        if (target) {
            target.el.scrollIntoView({ block: 'center', behavior: 'auto' });
            await randomDelay(300, 550);
            await humanClickWithHover(target.el);
            return true;
        }

        const container = findScrollContainer(rows[rows.length - 1]?.el || document.body);
        if (!container) break;

        const beforeScroll = container.scrollTop;
        await humanScroll(container, 700);
        await randomDelay(450, 750);

        if (container.scrollTop === beforeScroll) {
            // الـ scroll واقف - ممكن فيسبوك لسه بيحمّل دفعة جديدة، استنى بصبر
            stableRounds++;
            await randomDelay(1000, 1600);
            if (stableRounds >= 4) break; // القائمة خلصت فعلاً
        } else {
            stableRounds = 0;
        }
    }

    // 🔄 محاولة أخيرة: ارجع لأعلى القائمة ودوّر من الأول
    // (بعد الريفريش القائمة بتبدأ من فوق - المحادثة ممكن تكون فوق موضع الـ scroll الحالي)
    if (allowFromTopRetry && !stopSendingFlag) {
        const rows = getConversationRowsWithKeys();
        const container = findScrollContainer(rows[0]?.el || rows[rows.length - 1]?.el || document.body);
        if (container && container.scrollTop > 0) {
            addLog(`🔄 إعادة البحث عن "${targetName}" من أعلى القائمة...`, "info");
            container.scrollTop = 0;
            await randomDelay(900, 1400);
            return clickConversationByKey(targetKey, targetName, { maxScrollAttempts: 35, allowFromTopRetry: false });
        }
    }

    return false;
}

// ============================================
// مربع الكتابة
// ============================================
function getComposeBoxText() {
    const box = document.querySelector('[contenteditable="true"][role="textbox"]');
    return box ? box.innerText.trim() : "";
}

async function waitForChange(checkFn, timeoutMs = 6000) {
    const start = Date.now();
    let lastVal = checkFn();

    while (Date.now() - start < timeoutMs) {
        if (stopSendingFlag) return false;
        await randomDelay(200, 300);
        const newVal = checkFn();
        if (newVal !== lastVal) return true;
        lastVal = newVal;
    }
    return false;
}

async function waitForCondition(condFn, timeoutMs = 5000, pollMin = 200, pollMax = 350) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (stopSendingFlag) return false;
        if (condFn()) return true;
        await randomDelay(pollMin, pollMax);
    }
    return false;
}

// ============================================
// 🎯 اختيار الرد المحفوظ الصحيح من داخل القائمة
// ============================================
function findSavedReplyDialog() {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const d of dialogs) {
        if (d.querySelector('[aria-label*="Pressable"]')) return d;
    }
    return document;
}

function findClickableAncestor(el, root) {
    let cur = el;
    let depth = 0;
    while (cur && cur !== root && cur !== document.body && depth < 12) {
        const label = cur.getAttribute && cur.getAttribute('aria-label');
        const role = cur.getAttribute && cur.getAttribute('role');
        if ((label && label.includes('Pressable')) || role === 'button' || role === 'listitem' || role === 'menuitem') {
            return cur;
        }
        cur = cur.parentElement;
        depth++;
    }
    return null;
}

function pickSavedReply() {
    const root = findSavedReplyDialog();
    const wantedTitle = (settings.savedReplyTitle || '').trim();

    if (wantedTitle) {
        const headings = root.querySelectorAll('[role="heading"]');
        for (const h of headings) {
            if (h.innerText && h.innerText.trim() === wantedTitle) {
                const clickable = findClickableAncestor(h, root);
                if (clickable) return { el: clickable, method: 'title-heading' };
            }
        }

        const all = root.querySelectorAll('div, span');
        for (const el of all) {
            if (el.children.length === 0 && el.innerText && el.innerText.trim() === wantedTitle) {
                const clickable = findClickableAncestor(el, root);
                if (clickable) return { el: clickable, method: 'title-text' };
            }
        }

        const pressablesInRoot = root.querySelectorAll('[aria-label*="Pressable"]');
        for (const p of pressablesInRoot) {
            if (p.innerText && p.innerText.includes(wantedTitle)) {
                return { el: p, method: 'title-pressable' };
            }
        }
    }

    const pressables = root === document
        ? findAllByLabel("Pressable")
        : root.querySelectorAll('[aria-label*="Pressable"]');

    if (pressables.length > 0) {
        for (const p of pressables) {
            if (p.innerText && p.innerText.trim().length > 2) {
                return { el: p, method: 'first-reply' };
            }
        }
        return { el: pressables[0], method: 'first-pressable' };
    }

    return null;
}

// ============================================
// معالج الرسائل من الـ popup
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("📩 استلام أمر:", request.action);

    if (request.action === "LOAD_ONLY") {
        loadOnlyFlow();
        sendResponse({ ok: true });
    } else if (request.action === "SEND_LOADED") {
        if (request.settings) {
            settings = { ...settings, ...request.settings };
            chrome.storage.local.set({ botSettings: settings });
        }
        sendOnlyFlow();
        sendResponse({ ok: true });
    } else if (request.action === "STOP_ALL") {
        stopAll();
        sendResponse({ ok: true });
    } else if (request.action === "GET_STATE") {
        sendResponse({ ok: true, mode: currentMode, loaded: conversationQueue.length });
    } else if (request.action === "RESET") {
        resetAll();
        sendResponse({ ok: true });
    }
    return true;
});

function stopAll() {
    stopLoadingFlag = true;
    stopSendingFlag = true;
    addLog("⏹️ تم طلب الإيقاف - سيتوقف البوت خلال ثوانٍ", "warning");
}

function resetAll() {
    stopLoadingFlag = true;
    stopSendingFlag = true;
    currentMode = 'idle';
    processedChats = new Set();
    failedChats = new Set();
    conversationQueue = [];
    queueIndex = 0;
    loadingComplete = false;
    stats = { sent: 0, skipped: 0, failed: 0 };
    messagesSinceBreak = 0;
    recentLogs = [];
    persistState();
}

// ============================================
// تدفق: تحميل فقط
// ============================================
async function loadOnlyFlow() {
    if (currentMode !== 'idle') {
        addLog(`⚠️ فيه عملية شغالة بالفعل (${currentMode}) - أوقفها الأول`, "warning");
        return;
    }
    await buildConversationQueue();
}

// ============================================
// تدفق: إرسال للمحمّل فقط
// ============================================
async function sendOnlyFlow() {
    if (currentMode === 'sending') {
        addLog("⚠️ الإرسال شغال بالفعل", "warning");
        return;
    }

    if (currentMode === 'loading') {
        addLog("⏸️ إيقاف التحميل أولاً قبل بدء الإرسال...", "info");
        stopLoadingFlag = true;
        const start = Date.now();
        while (currentMode === 'loading' && Date.now() - start < 30000) {
            await randomDelay(300, 500);
        }
        if (currentMode === 'loading') {
            addLog("❌ التحميل لم يتوقف - حاول مرة أخرى", "error");
            return;
        }
    }

    if (conversationQueue.length === 0) {
        addLog("❌ لا توجد محادثات محملة بعد - اضغط تحميل أولاً", "error");
        return;
    }

    applyStartPosition();

    await runSendAutomation();
}

// ============================================
// 🎯 البدء من مكان معين - v7.3: التخطي أصبح مطلقاً
// - "تخطي أول X" يعني: أول X محادثة تتخطى تماماً والبدء من X+1 مهما كان الموضع المحفوظ
// - "البدء من اسم" يعني: البدء من هذه المحادثة بالظبط مهما كان الموضع المحفوظ
// - لو مفيش إعدادات: إعادة محاولة تلقائية للي فشلوا بسبب "لم يتم العثور" سابقاً
// ============================================
function applyStartPosition() {
    const startName = (settings.startFromName || '').trim();
    const skipCount = Math.max(0, parseInt(settings.skipCount, 10) || 0);

    // 1) البدء من اسم محدد (أولوية أولى) - مطلق
    if (startName) {
        const idx = conversationQueue.findIndex(c => c.name.includes(startName));
        if (idx >= 0) {
            queueIndex = idx;
            addLog(`🎯 البدء من المحادثة "${conversationQueue[idx].name}" (الموضع ${idx + 1} من ${conversationQueue.length})`, "success");
            return;
        }
        addLog(`⚠️ لم يتم العثور على محادثة باسم "${startName}" في المحمّل - سيتم تجاهل هذا الإعداد`, "warning");
    }

    // 2) تخطي أول X - مطلق: يتجاوز الموضع المحفوظ تماماً
    if (skipCount > 0) {
        queueIndex = Math.min(skipCount, conversationQueue.length);
        addLog(`🎯 تخطي أول ${skipCount} محادثة تماماً - البدء من الموضع ${queueIndex + 1} من ${conversationQueue.length}`, "success");
        return;
    }

    // 3) مفيش إعدادات بدء: أعد محاولة اللي فشلوا سابقاً (غالباً فشل "لم يتم العثور" الزائف)
    if (failedChats.size > 0) {
        let earliestFailedIdx = -1;
        for (let i = 0; i < conversationQueue.length; i++) {
            if (failedChats.has(conversationQueue[i].key) && !processedChats.has(conversationQueue[i].key)) {
                earliestFailedIdx = i;
                break;
            }
        }
        if (earliestFailedIdx >= 0 && earliestFailedIdx < queueIndex) {
            addLog(`🔄 إعادة محاولة ${failedChats.size} محادثة فشلت سابقاً (بدءاً من الموضع ${earliestFailedIdx + 1})`, "info");
            queueIndex = earliestFailedIdx;
        }
        failedChats = new Set(); // امسح قائمة الفشل عشان يعاد المحاولة عليهم
    }

    // لو الموضع المحفوظ عدى نهاية الطابور والقائمة فيها غير معالج، ارجع للبداية
    if (queueIndex >= conversationQueue.length) {
        const hasUnprocessed = conversationQueue.some(c => !processedChats.has(c.key));
        if (hasUnprocessed) {
            queueIndex = 0;
            addLog(`🔄 الموضع المحفوظ وصل النهاية - إعادة الفحص من البداية (المعالَج هيتخطى تلقائياً)`, "info");
        }
    }
}

// ============================================
// 🚀 حلقة الإرسال الرئيسية
// ============================================
async function runSendAutomation() {
    currentMode = 'sending';
    stopSendingFlag = false;
    await persistState();

    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 5;

    addLog(`🚀 بدء الإرسال من الموضع ${queueIndex + 1}/${conversationQueue.length}`, "success");

    while (!stopSendingFlag && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
        try {
            if (queueIndex >= conversationQueue.length) {
                if (loadingComplete) {
                    addLog("🏁 انتهى الطابور بالكامل!", "success");
                } else {
                    addLog("⏸️ وصلنا آخر المحمّل. حمّل المزيد للمتابعة.", "warning");
                }
                break;
            }

            const chatData = conversationQueue[queueIndex];
            const chatKey = chatData.key;
            const chatName = chatData.name;

            if (processedChats.has(chatKey) || failedChats.has(chatKey)) {
                addLog(`⏭️ تخطي "${chatName}" (معالج مسبقاً)`, "info");
                queueIndex++;
                stats.skipped++;
                await persistState();
                continue;
            }

            addLog(`🔄 معالجة: ${chatName} (${queueIndex + 1}/${conversationQueue.length})`, "info");

            const found = await clickConversationByKey(chatKey, chatName);
            if (!found) {
                if (stopSendingFlag) break;
                addLog(`⚠️ لم يتم إيجاد "${chatName}" في القائمة الحالية`, "warning");
                failedChats.add(chatKey);
                queueIndex++;
                stats.failed++;
                await persistState();
                continue;
            }

            await waitForCondition(
                () => document.querySelector('[contenteditable="true"][role="textbox"]') !== null,
                4000
            );
            await randomDelay(700, 1400);

            const pageText = document.body.innerText;
            if (pageText.includes("لا يمكنك الرد") || pageText.includes("unavailable")) {
                addLog(`⛔ محادثة محظورة: "${chatName}"`, "error");
                failedChats.add(chatKey);
                queueIndex++;
                stats.failed++;
                await persistState();
                continue;
            }

            let savedReplyBtn = findByLabel("إدراج رد محفوظ") ||
                               findByLabel("Insert saved reply") ||
                               findByLabel("Saved replies");

            if (!savedReplyBtn) {
                addLog(`❌ لم يتم العثور على زر الردود المحفوظة لـ "${chatName}"`, "error");
                failedChats.add(chatKey);
                queueIndex++;
                stats.failed++;
                consecutiveFailures++;
                await persistState();
                await randomDelay(1500, 2500);
                continue;
            }

            await humanClickWithHover(savedReplyBtn);

            await waitForCondition(() => findAllByLabel("Pressable").length > 0, 5000);
            await randomDelay(500, 900);

            const picked = pickSavedReply();

            if (!picked) {
                addLog(`❌ لم يتم العثور على الرد المحفوظ "${settings.savedReplyTitle}" لـ "${chatName}"`, "error");
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
                failedChats.add(chatKey);
                queueIndex++;
                stats.failed++;
                consecutiveFailures++;
                await persistState();
                await randomDelay(1500, 2500);
                continue;
            }

            if (picked.method.startsWith('title')) {
                addLog(`🎯 تم إيجاد الرد "${settings.savedReplyTitle}" بالعنوان`, "info");
            }

            const composeBoxBefore = getComposeBoxText();
            await humanClickWithHover(picked.el);

            const textChanged = await waitForChange(getComposeBoxText, 5000);
            const composeBoxAfterInsert = getComposeBoxText();

            if (!textChanged && composeBoxAfterInsert === composeBoxBefore) {
                addLog(`⚠️ لم يتغير مربع الكتابة لـ "${chatName}"`, "warning");
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
                failedChats.add(chatKey);
                queueIndex++;
                stats.failed++;
                consecutiveFailures++;
                await persistState();
                await randomDelay(1500, 2500);
                continue;
            }

            await randomDelay(600, 1200);

            let sendBtnEl = findByLabel("إرسال") || findByLabel("Send");
            if (!sendBtnEl) {
                const buttons = document.querySelectorAll('div[role="button"]');
                for (let btn of buttons) {
                    if (btn.innerText.includes("إرسال") || btn.innerText.includes("Send")) {
                        sendBtnEl = btn;
                        break;
                    }
                }
            }

            if (!sendBtnEl) {
                addLog(`❌ لم يتم العثور على زر الإرسال لـ "${chatName}"`, "error");
                failedChats.add(chatKey);
                queueIndex++;
                stats.failed++;
                consecutiveFailures++;
                await persistState();
                continue;
            }

            await humanClickWithHover(sendBtnEl);

            const sendConfirmed = await waitForCondition(
                () => getComposeBoxText() !== composeBoxAfterInsert,
                4000
            );

            if (!sendConfirmed && getComposeBoxText() === composeBoxAfterInsert) {
                addLog(`❌ فشل إرسال "${chatName}" (النص لسه موجود)`, "error");
                failedChats.add(chatKey);
                queueIndex++;
                stats.failed++;
                consecutiveFailures++;
                await persistState();
                await randomDelay(1500, 2500);
                continue;
            }

            addLog(`✅ تم الإرسال بنجاح: "${chatName}"`, "success");
            processedChats.add(chatKey);
            failedChats.delete(chatKey);
            queueIndex++;
            stats.sent++;
            consecutiveFailures = 0;
            await persistState();

            const delay = smartDelay();
            await randomDelay(delay, delay + 1000);

            await maybeHumanBreak();

        } catch (error) {
            addLog(`💥 خطأ: ${error.message}`, "error");
            consecutiveFailures++;
            await randomDelay(4000, 7000);
        }
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        addLog(`🛑 توقف تلقائي بعد ${MAX_CONSECUTIVE_FAILURES} فشل متتالي - راجع الصفحة`, "error");
    }

    const summary = `📊 تقرير: ✅${stats.sent} | ❌${stats.failed} | ⏭️${stats.skipped}`;
    addLog(summary, stats.failed > 0 ? "warning" : "success");

    currentMode = 'idle';
    await persistState();
}

// ============================================
// ✨ الويدجيت المحقون - v7.3
// شريط صغير احترافي أعلى يمين الصفحة مع بروجريس + إعدادات + لوحة تحكم
// ============================================
const WIDGET_ID = 'fbsr-widget-host';

function shouldShowWidget() {
    return location.hostname.includes('facebook.com') && location.pathname.includes('/latest/inbox');
}

function initWidget() {
    if (document.getElementById(WIDGET_ID)) return;
    if (!shouldShowWidget()) return;

    const host = document.createElement('div');
    host.id = WIDGET_ID;
    host.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;direction:rtl;';
    document.documentElement.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
    <style>
        :host { all: initial; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }

        .widget {
            width: 264px;
            background: rgba(17, 19, 24, 0.94);
            backdrop-filter: blur(16px) saturate(1.4);
            -webkit-backdrop-filter: blur(16px) saturate(1.4);
            border: 1px solid rgba(255, 255, 255, 0.09);
            border-radius: 18px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3);
            color: #e8eaee;
            overflow: hidden;
            direction: rtl;
            transition: box-shadow 0.3s ease;
        }
        .widget:hover { box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35); }

        /* ---------- الشريط الرئيسي ---------- */
        .bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 9px 12px;
            cursor: default;
        }
        .dot {
            width: 8px; height: 8px;
            border-radius: 50%;
            background: #5b6070;
            flex-shrink: 0;
            transition: background 0.3s ease, box-shadow 0.3s ease;
        }
        .dot.on {
            background: #34d17b;
            box-shadow: 0 0 0 3px rgba(52, 209, 123, 0.18);
            animation: pulse 1.6s ease-in-out infinite;
        }
        .dot.loading {
            background: #f0b13c;
            box-shadow: 0 0 0 3px rgba(240, 177, 60, 0.18);
            animation: pulse 1.1s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.55; transform: scale(0.85); }
        }

        .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .counts {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.2px;
            color: #c3c7d0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.2;
        }
        .counts b { color: #fff; font-weight: 700; }

        .track {
            height: 4px;
            border-radius: 99px;
            background: rgba(255, 255, 255, 0.09);
            overflow: hidden;
            position: relative;
        }
        .fill {
            height: 100%;
            width: 0%;
            border-radius: 99px;
            background: linear-gradient(90deg, #34d17b, #4fe3a1);
            transition: width 0.5s ease;
        }
        .fill.indeterminate {
            width: 40% !important;
            background: linear-gradient(90deg, #f0b13c, #ffd077);
            animation: slide 1.3s ease-in-out infinite alternate;
        }
        @keyframes slide {
            from { transform: translateX(160%); }
            to { transform: translateX(-10%); }
        }

        .ic {
            width: 28px; height: 28px;
            border: none;
            border-radius: 9px;
            background: transparent;
            color: #9aa0ad;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
            transition: background 0.2s ease, color 0.2s ease, transform 0.25s ease;
        }
        .ic:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
        .ic svg { width: 15px; height: 15px; }
        .ic.rotated svg { transform: rotate(180deg); }
        .ic svg { transition: transform 0.3s ease; }
        .ic.spin-once svg { animation: spinOnce 0.5s ease; }
        @keyframes spinOnce { from { transform: rotate(0); } to { transform: rotate(180deg); } }

        /* ---------- اللوحات ---------- */
        .panel {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .panel.open { max-height: 400px; }
        .panel-inner {
            padding: 4px 12px 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            display: flex; flex-direction: column; gap: 8px;
        }

        .status-line {
            font-size: 10.5px;
            color: #9aa0ad;
            line-height: 1.4;
            padding-top: 8px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .btn-row { display: flex; gap: 6px; }
        .btn {
            flex: 1;
            padding: 7px 4px;
            border: none;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            color: #fff;
            transition: opacity 0.2s ease, transform 0.15s ease;
        }
        .btn:active { transform: scale(0.96); }
        .btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .btn-load { background: #2563eb; }
        .btn-send { background: #16a34a; }
        .btn-stop { background: #dc2626; }
        .btn-ghost {
            background: rgba(255, 255, 255, 0.07);
            color: #c3c7d0;
        }

        .stats-row {
            display: flex; gap: 5px;
        }
        .stat {
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            padding: 6px 2px;
            text-align: center;
        }
        .stat .num { font-size: 13px; font-weight: 700; color: #fff; line-height: 1.2; }
        .stat .lbl { font-size: 9px; color: #8a8f9c; margin-top: 1px; }
        .stat.ok .num { color: #34d17b; }
        .stat.bad .num { color: #ef6a63; }
        .stat.skip .num { color: #f0b13c; }

        .log {
            background: rgba(0, 0, 0, 0.35);
            border-radius: 10px;
            padding: 7px 9px;
            max-height: 92px;
            overflow-y: auto;
            display: flex; flex-direction: column; gap: 3px;
        }
        .log::-webkit-scrollbar { width: 4px; }
        .log::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
        .log-entry { font-size: 9.5px; color: #9aa0ad; line-height: 1.45; word-break: break-word; }
        .log-entry.success { color: #34d17b; }
        .log-entry.error { color: #ef6a63; }
        .log-entry.warning { color: #f0b13c; }

        .field { display: flex; flex-direction: column; gap: 3px; }
        .field label { font-size: 10px; color: #8a8f9c; font-weight: 600; }
        .field input {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 9px;
            padding: 6px 9px;
            font-size: 11px;
            color: #fff;
            outline: none;
            transition: border-color 0.2s ease;
        }
        .field input:focus { border-color: rgba(52, 209, 123, 0.5); }
        .field input::placeholder { color: #5b6070; }
        .hint { font-size: 9px; color: #6b7080; line-height: 1.4; }
    </style>

    <div class="widget" id="widget">
        <div class="bar">
            <span class="dot" id="wDot"></span>
            <div class="mid">
                <div class="counts" id="wCounts">جاهز</div>
                <div class="track"><div class="fill" id="wFill"></div></div>
            </div>
            <button class="ic" id="wGear" title="الإعدادات">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button class="ic" id="wExpand" title="لوحة التحكم">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
        </div>

        <!-- لوحة الإعدادات -->
        <div class="panel" id="wSettingsPanel">
            <div class="panel-inner">
                <div class="field">
                    <label>عنوان الرد المحفوظ</label>
                    <input type="text" id="wReplyTitle" placeholder="BM AUTO" />
                </div>
                <div class="field">
                    <label>تخطي أول (عدد) محادثة</label>
                    <input type="number" id="wSkipCount" min="0" placeholder="0" />
                    <span class="hint">مثال: 100 = يتجاهل أول 100 تماماً ويبدأ من 101</span>
                </div>
                <div class="field">
                    <label>أو البدء من محادثة اسمها</label>
                    <input type="text" id="wStartFrom" placeholder="اترك فارغاً للبدء من الأول" />
                </div>
            </div>
        </div>

        <!-- لوحة التحكم -->
        <div class="panel" id="wMainPanel">
            <div class="panel-inner">
                <div class="status-line" id="wStatus">جاهز...</div>
                <div class="btn-row">
                    <button class="btn btn-load" id="wLoadBtn">تحميل</button>
                    <button class="btn btn-send" id="wSendBtn">إرسال</button>
                    <button class="btn btn-stop" id="wStopBtn" disabled>إيقاف</button>
                </div>
                <div class="stats-row">
                    <div class="stat ok"><div class="num" id="wSent">0</div><div class="lbl">ناجح</div></div>
                    <div class="stat bad"><div class="num" id="wFailed">0</div><div class="lbl">فاشل</div></div>
                    <div class="stat skip"><div class="num" id="wSkipped">0</div><div class="lbl">متخطى</div></div>
                    <div class="stat"><div class="num" id="wLoaded">0</div><div class="lbl">محمّل</div></div>
                </div>
                <div class="log" id="wLog"></div>
                <div class="btn-row">
                    <button class="btn btn-ghost" id="wResetBtn">إعادة ضبط كاملة</button>
                </div>
            </div>
        </div>
    </div>`;

    // ---------- عناصر ----------
    const $ = (id) => root.getElementById(id);
    const wDot = $('wDot'), wCounts = $('wCounts'), wFill = $('wFill');
    const wGear = $('wGear'), wExpand = $('wExpand');
    const wSettingsPanel = $('wSettingsPanel'), wMainPanel = $('wMainPanel');
    const wStatus = $('wStatus');
    const wLoadBtn = $('wLoadBtn'), wSendBtn = $('wSendBtn'), wStopBtn = $('wStopBtn'), wResetBtn = $('wResetBtn');
    const wSent = $('wSent'), wFailed = $('wFailed'), wSkipped = $('wSkipped'), wLoaded = $('wLoaded');
    const wLog = $('wLog');
    const wReplyTitle = $('wReplyTitle'), wSkipCount = $('wSkipCount'), wStartFrom = $('wStartFrom');

    // ---------- ملء الإعدادات الحالية ----------
    wReplyTitle.value = settings.savedReplyTitle || 'BM AUTO';
    wSkipCount.value = settings.skipCount || 0;
    wStartFrom.value = settings.startFromName || '';

    function saveWidgetSettings() {
        settings.savedReplyTitle = wReplyTitle.value.trim() || 'BM AUTO';
        settings.skipCount = Math.max(0, parseInt(wSkipCount.value, 10) || 0);
        settings.startFromName = wStartFrom.value.trim();
        try { chrome.storage.local.set({ botSettings: settings }); } catch (e) { /* غير حرج */ }
    }
    [wReplyTitle, wSkipCount, wStartFrom].forEach(input => {
        input.addEventListener('change', saveWidgetSettings);
        input.addEventListener('blur', saveWidgetSettings);
    });

    // ---------- فتح/غلق اللوحات ----------
    wGear.addEventListener('click', () => {
        wGear.classList.add('spin-once');
        setTimeout(() => wGear.classList.remove('spin-once'), 550);
        const opening = !wSettingsPanel.classList.contains('open');
        wSettingsPanel.classList.toggle('open', opening);
        if (opening) wMainPanel.classList.remove('open'), wExpand.classList.remove('rotated');
    });
    wExpand.addEventListener('click', () => {
        const opening = !wMainPanel.classList.contains('open');
        wMainPanel.classList.toggle('open', opening);
        wExpand.classList.toggle('rotated', opening);
        if (opening) wSettingsPanel.classList.remove('open');
    });

    // ---------- أزرار التحكم ----------
    wLoadBtn.addEventListener('click', () => {
        saveWidgetSettings();
        loadOnlyFlow();
    });
    wSendBtn.addEventListener('click', () => {
        saveWidgetSettings();
        sendOnlyFlow();
    });
    wStopBtn.addEventListener('click', () => stopAll());
    wResetBtn.addEventListener('click', () => {
        if (!confirm('هترجع الإضافة زي أول ما ثبّتها (مسح كل البيانات). متأكد؟')) return;
        resetAll();
        try { chrome.storage.local.clear(); } catch (e) { /* غير حرج */ }
        wReplyTitle.value = 'BM AUTO';
        wSkipCount.value = 0;
        wStartFrom.value = '';
    });

    // ---------- التحديث الدوري المتزامن ----------
    function updateWidget() {
        const loaded = conversationQueue.length;
        const done = Math.min(queueIndex, loaded);

        wSent.innerText = stats.sent;
        wFailed.innerText = stats.failed;
        wSkipped.innerText = stats.skipped;
        wLoaded.innerText = loaded;

        if (currentMode === 'loading') {
            wDot.className = 'dot loading';
            wCounts.innerHTML = `جاري التحميل... <b>${loaded}</b> محادثة`;
            wFill.classList.add('indeterminate');
            wStatus.innerText = 'تحميل المحادثات جارٍ (بدون إرسال)...';
            wLoadBtn.disabled = true; wSendBtn.disabled = true; wStopBtn.disabled = false;
        } else if (currentMode === 'sending') {
            wDot.className = 'dot on';
            wCounts.innerHTML = `يرسل: <b>${done}</b> / ${loaded}`;
            wFill.classList.remove('indeterminate');
            wFill.style.width = loaded > 0 ? `${Math.round((done / loaded) * 100)}%` : '0%';
            wStatus.innerText = `إرسال جارٍ — الموضع ${done} من ${loaded}`;
            wLoadBtn.disabled = true; wSendBtn.disabled = true; wStopBtn.disabled = false;
        } else {
            wDot.className = 'dot';
            wCounts.innerHTML = loaded > 0 ? `متوقف — <b>${loaded}</b> محملة` : 'جاهز';
            wFill.classList.remove('indeterminate');
            wFill.style.width = loaded > 0 ? `${Math.round((done / loaded) * 100)}%` : '0%';
            wStatus.innerText = loaded > 0 ? `متوقف عند الموضع ${done} من ${loaded}` : 'جاهز... اضغط تحميل أولاً';
            wLoadBtn.disabled = false; wSendBtn.disabled = loaded === 0; wStopBtn.disabled = true;
        }

        // السجل المصغر
        const lastLogs = recentLogs.slice(-8);
        wLog.innerHTML = '';
        for (const log of lastLogs) {
            const entry = document.createElement('div');
            entry.className = 'log-entry ' + (log.type || 'info');
            entry.innerText = log.message;
            wLog.appendChild(entry);
        }
        wLog.scrollTop = wLog.scrollHeight;
    }

    updateWidget();
    setInterval(updateWidget, 800);
}

// حقن الويدجيت + متابعة تنقلات الـ SPA (فيسبوك بيغير الـ URL بدون ريفريش)
initWidget();
setInterval(() => {
    if (shouldShowWidget() && !document.getElementById(WIDGET_ID)) {
        initWidget();
    }
}, 2000);
