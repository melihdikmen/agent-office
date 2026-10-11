'use strict';
// UI language for text built in the main process (notifications, tray, doctor, spoken phrases).
let lang = 'tr';
const setLang = (l) => { lang = l === 'en' ? 'en' : 'tr'; };
const getLang = () => lang;
const tt = (tr, en) => (lang === 'en' ? en : tr);
module.exports = { setLang, getLang, tt };
