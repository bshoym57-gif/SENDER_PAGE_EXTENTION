// خدمة خلفية بسيطة - الأداة دلوقتي بتشتغل على نفس التاب المفتوح
// مفيش حاجة تشغيل نافذة مخفية، الـ popup بيتواصل مباشرة مع content script

chrome.runtime.onInstalled.addListener(() => {
    console.log("✅ [FB Bot] تم تثبيت الإضافة (v7 - يعمل على نفس التاب)");
});
