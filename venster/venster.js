/* Vraagbaak Websitegesprek - chatvenster (ontwerp 0.2 §3).
 * Wordt pas geladen na een tik op "Stel je vraag hier" (vast blok op websitegesprek.nl).
 * Geen cookies, geen externe scripts; alleen de getoonde tekst in sessionStorage (V4, VB4).
 * Antwoorden alleen als tekst (textContent); links alleen naar https://websitegesprek.nl/ (toets security).
 */
(function () {
  'use strict';
  if (window.WGVraagbaak) return;

  var API = 'https://vraag.websitegesprek.nl';
  var OPSLAG = 'wg-vraag-gesprek';
  var WA = 'https://wa.me/31611729912?text=' + encodeURIComponent('Hoi! Ik heb een vraag over Websitegesprek: ');
  var MAIL = 'mailto:info@websitegesprek.nl';
  var PRIVACY = 'https://websitegesprek.nl/privacy/'; // VA1 (Juridisch 14 nov)
  var VOORLEZEN = false; // Besluit 456 (Raymond 15 nov): voorlezen werkte niet op de iPhone, dus geen speakerknop.
  var MIC_MAX_MS = 30000; // S1: microfoon hooguit 30 seconden
  // Besluit 455 (wens Raymond 15 nov): het venster is altijd Nederlands, ook in een Engelstalige browser.
  // Antwoorden volgen nog wel de taal van de vraag (instructie). VB7 (Engelse melding) ligt ter toets bij Juridisch.
  var NL = true;
  var T = NL ? {
    titel: 'Stel je vraag', plaats: 'Typ je vraag…', stuur: 'Stuur', sluit: 'Sluiten', bezig: 'Even denken…', nogEven: 'Nog even…',
    mislukt: 'Dat lukt nu even niet. Vraag het via WhatsApp of mail, dan krijg je persoonlijk antwoord.',
    uit: 'De vraagbaak is even niet beschikbaar. Je vraag is welkom via WhatsApp of mail; je krijgt dan persoonlijk antwoord.',
    naam: 'Websitegesprek', mens: 'Liever een mens?', mic: 'Vraag inspreken', micStop: 'Stoppen met luisteren', luister: 'Ik luister…', spraakRegel: 'Je browser zet je spraak om in tekst, soms via Apple of Google. Wij krijgen alleen de tekst.', lees: 'Voorlezen', leesStop: 'Stoppen met voorlezen', geenMic: 'Inspreken werkt niet in deze browser. Typ je vraag, of gebruik het microfoontje van je toetsenbord.', wa: 'WhatsApp', of: 'of', mail: 'mail ons', bron: 'Lees meer', privacy: 'Privacy', nuttig: 'Was dit nuttig?', ja: 'Ja, nuttig', nee: 'Nee, niet nuttig',
    meer: 'Meer', minder: 'Minder',
    v1: 'Je praat met een AI-assistent (Claude). Antwoorden kunnen fouten bevatten; wat telt, staat op onze website en in onze voorwaarden. Deel geen persoonsgegevens; liever een mens? Vraag het via WhatsApp of mail.',
    vol: 'Dit gesprek is vol. Begin een nieuw gesprek of vraag het via WhatsApp.', tegrootte: 'Je vraag is te lang (max. 500 tekens).', start: 'Verbinden…'
  } : {
    titel: 'Ask your question', plaats: 'Type your question…', stuur: 'Send', sluit: 'Close', bezig: 'Thinking…', nogEven: 'Almost there…',
    mislukt: "That isn't working right now. Ask us via WhatsApp or email for a personal answer.",
    uit: 'The assistant is not available right now. Ask us via WhatsApp or email for a personal answer.',
    naam: 'Websitegesprek', mens: 'Prefer a human?', mic: 'Speak your question', micStop: 'Stop listening', luister: 'Listening…', spraakRegel: 'Your browser turns your speech into text, sometimes via Apple or Google. We only receive the text.', lees: 'Read aloud', leesStop: 'Stop reading', geenMic: "Speaking isn't working. Use your keyboard's microphone or type your question.", wa: 'WhatsApp', of: 'or', mail: 'email us', bron: 'Read more', privacy: 'Privacy', nuttig: 'Was this helpful?', ja: 'Yes, helpful', nee: 'No, not helpful',
    meer: 'More', minder: 'Less',
    v1: "You're chatting with an AI assistant (Claude). Answers may contain mistakes; what counts is on our website and in our terms. Don't share personal data; prefer a human? Ask us via WhatsApp or email.",
    vol: 'This conversation is full. Start a new one or ask via WhatsApp.', tegrootte: 'Your question is too long (max. 500 characters).', start: 'Connecting…'
  };

  /* ---------- SHA-256 voor de rekenpuzzel (besluit 401) ---------- */
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function utf8(s) { return unescape(encodeURIComponent(s)); }
  function sha256Eerste(s) {
    // Geeft het eerste 32-bits woord van de hash (genoeg om nullen te tellen).
    var b = utf8(s), l = b.length, i, j, w = new Array(64);
    var n = ((l + 9 + 63) >> 6) << 4, m = new Array(n);
    for (i = 0; i < n; i++) m[i] = 0;
    for (i = 0; i < l; i++) m[i >> 2] |= b.charCodeAt(i) << (24 - (i % 4) * 8);
    m[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    m[n - 1] = l * 8;
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    for (i = 0; i < n; i += 16) {
      var a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (j = 0; j < 64; j++) {
        if (j < 16) w[j] = m[i + j] | 0;
        else {
          var x = w[j - 15], y = w[j - 2];
          var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
          var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
          w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
        }
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[j] + w[j]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return h0 >>> 0;
  }
  function nullen(w) { return w === 0 ? 32 : Math.clz32(w); }
  function losOp(uitdaging, bits, klaar) {
    // In stukjes rekenen zodat de pagina blijft reageren; bits boven 32 komen niet voor.
    var i = 0;
    (function stap() {
      var eind = i + 20000;
      for (; i < eind; i++) {
        if (nullen(sha256Eerste(uitdaging + ':' + i)) >= bits) return klaar(String(i));
      }
      setTimeout(stap, 0);
    })();
  }
  window.__wgSha256Eerste = sha256Eerste; // voor de test

  /* ---------- netwerk ---------- */
  function post(pad, data, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(API + pad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), signal: ctrl.signal, credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.__status = r.status; return j; }); })
      .finally(function () { clearTimeout(timer); });
  }

  /* ---------- opmaak ---------- */
  // Huisstijl websitegesprek.nl (design-profile 10 nov 2026, skill websitegesprek-design):
  // navy #0E1B2C, amber #F2B33D (één hoofdknop: Stuur), tekst #1B2633, lijnen #E3DED2, crème #F6F4EE,
  // Inter 16-17px, Bricolage Grotesque voor de kop, knoppen 48px radius 12px, kaart radius 16px, iconen getekend.
  var css = '' +
    '#wg-vraag-venster{position:fixed;right:16px;bottom:max(16px,env(safe-area-inset-bottom));z-index:1000;width:min(400px,calc(100vw - 32px));height:min(640px,calc(100dvh - 32px));display:flex;flex-direction:column;background:#fff;color:#1B2633;border:1px solid #E3DED2;border-radius:16px;box-shadow:0 8px 28px rgba(14,27,44,.18);font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow:hidden}' +
    '#wg-vraag-venster *{box-sizing:border-box}' +
    '#wg-vraag-venster .k{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 8px 8px 24px;background:#0E1B2C;color:#F6F4EE;min-height:64px}' +
    '#wg-vraag-venster .mk{display:flex;align-items:center;gap:12px;min-width:0}' +
    '#wg-vraag-venster .lg{flex:0 0 36px;width:36px;height:36px;display:block}#wg-vraag-venster .lg svg{width:36px;height:36px;display:block}' +
    '#wg-vraag-venster .nm{display:flex;flex-direction:column;min-width:0}' +
    '#wg-vraag-venster .k h2{margin:0;font:700 19px/1.25 "Bricolage Grotesque",Inter,sans-serif;color:#F6F4EE}' +
    '#wg-vraag-venster .sub{font-size:14px;line-height:1.4;color:#8E9BAA}' +
    '#wg-vraag-venster button{font:inherit;cursor:pointer;border:0;-webkit-tap-highlight-color:transparent}' +
    '#wg-vraag-venster .x{position:relative;width:48px;height:48px;border-radius:12px;background:transparent}' +
    '#wg-vraag-venster .x::before,#wg-vraag-venster .x::after{content:"";position:absolute;left:14px;top:23px;width:20px;height:2px;border-radius:1px;background:#F6F4EE}' +
    '#wg-vraag-venster .x::before{transform:rotate(45deg)}#wg-vraag-venster .x::after{transform:rotate(-45deg)}' +
    '#wg-vraag-venster .m{margin:0;padding:16px 24px;font-size:14px;line-height:1.5;color:#5B6775;background:#F6F4EE;border-bottom:1px solid #E3DED2}' +
    '#wg-vraag-venster .m.dicht{padding-top:4px;padding-bottom:4px}#wg-vraag-venster .m.dicht .mrest{display:none}' +
    // Knop 'Meer/Minder' even hoog als de tekstregel (anders zakt de laatste regel, Raymond 15 nov 09:24); het tikvlak van
    // 44 px zit in een onzichtbare laag eromheen (WCAG 2.5.8, Apple 44 pt).
    '#wg-vraag-venster .mt{position:relative;display:inline;margin:0 0 0 8px;padding:0 4px;border:0;background:transparent;color:#0E1B2C;font-family:inherit;font-weight:600;font-size:14px;line-height:1.5;text-decoration:underline;text-underline-offset:2px;vertical-align:baseline}' +
    '#wg-vraag-venster .mt::after{content:"";position:absolute;left:-4px;right:-4px;top:50%;height:44px;transform:translateY(-50%)}' +
    '#wg-vraag-venster .l{flex:1;overflow:auto;padding:16px 24px;display:flex;flex-direction:column;gap:16px;overscroll-behavior:contain}' +
    '#wg-vraag-venster .b{max-width:88%;padding:12px 16px;border-radius:16px;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '#wg-vraag-venster .b.u{align-self:flex-end;background:#0E1B2C;color:#F6F4EE;border-bottom-right-radius:4px}' +
    '#wg-vraag-venster .b.a{align-self:flex-start;background:#F6F4EE;color:#1B2633;border-bottom-left-radius:4px}' +
    '#wg-vraag-venster .b.typt a,#wg-vraag-venster .b.typt .id,#wg-vraag-venster .b.typt .d{visibility:hidden}' +
    '#wg-vraag-venster .pt{display:inline-block;width:6px;height:6px;margin-left:4px;border-radius:50%;background:#5B6775;vertical-align:middle}' +
    '@media (prefers-reduced-motion:no-preference){#wg-vraag-venster .pt{animation:wgVraagPunt 1s ease-in-out infinite}#wg-vraag-venster .pt:nth-child(2){animation-delay:.15s}#wg-vraag-venster .pt:nth-child(3){animation-delay:.3s}@keyframes wgVraagPunt{0%,80%,100%{opacity:.25}40%{opacity:1}}}' +
    '#wg-vraag-venster .b a{color:#0E1B2C;font-weight:600;text-decoration:underline;text-underline-offset:2px}' +
    '#wg-vraag-venster .id{display:block;margin-top:8px;font-size:12px;line-height:1.4;color:#5B6775}' +
    '#wg-vraag-venster .d{display:flex;gap:8px;margin-top:8px}' +
    '#wg-vraag-venster .d button{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:12px;background:#fff;border:1px solid #E3DED2;color:#0E1B2C}' +
    '#wg-vraag-venster .d button svg{width:20px;height:20px;display:block}' +
    '#wg-vraag-venster .d button[aria-pressed=true]{background:#0E1B2C;border-color:#0E1B2C;color:#F6F4EE}' +
    '#wg-vraag-venster form{display:flex;gap:8px;align-items:flex-end;padding:16px 24px;border-top:1px solid #E3DED2;margin:0}' +
    '#wg-vraag-venster textarea{flex:1;resize:none;min-height:48px;max-height:146px;overflow-y:auto;line-height:24px;padding:11px 16px;border:1px solid #5B6775;border-radius:12px;font:inherit;color:#1B2633;background:#fff}' +
    '#wg-vraag-venster textarea::placeholder{color:#5B6775}' +
    '#wg-vraag-venster textarea:focus-visible,#wg-vraag-venster button:focus-visible,#wg-vraag-venster a:focus-visible{outline:3px solid #0E1B2C;outline-offset:2px}' +
    '#wg-vraag-venster .k button:focus-visible{outline-color:#F2B33D}' +
    '#wg-vraag-venster .mi{flex:0 0 48px;display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:#fff;border:2px solid #0E1B2C;color:#0E1B2C}' +
    '#wg-vraag-venster .mi svg{width:22px;height:22px;display:block}' +
    '#wg-vraag-venster .mi[aria-pressed=true]{background:#0E1B2C;color:#F2B33D}' +
    '@media (prefers-reduced-motion:no-preference){#wg-vraag-venster .mi[aria-pressed=true]{animation:wgVraagPuls 1.2s ease-in-out infinite}@keyframes wgVraagPuls{50%{box-shadow:0 0 0 6px rgba(242,179,61,.45)}}}' +
    '#wg-vraag-venster .mi[hidden],#wg-vraag-venster .sr[hidden]{display:none}' +
    '#wg-vraag-venster .sr{margin:-8px 0 0;padding:0 24px 8px;font-size:12px;line-height:1.4;color:#5B6775}' +
    '#wg-vraag-venster .s{min-height:48px;padding:0 24px;border-radius:12px;background:#F2B33D;color:#0E1B2C;font-weight:700}' +
    '#wg-vraag-venster .s[disabled],#wg-vraag-venster textarea[disabled]{opacity:.55;cursor:default}' +
    '#wg-vraag-venster .t{margin:0;padding:0 24px 16px;font-size:14px;line-height:1.5;color:#5B6775}' +
    '#wg-vraag-venster .t a{display:inline-block;padding:4px 0;color:#0E1B2C;font-weight:600;text-decoration:underline;text-underline-offset:2px}' +
    '@media (max-width:480px){#wg-vraag-venster{left:0;right:0;bottom:0;width:100%;height:min(88dvh,640px);border-radius:16px 16px 0 0;border-bottom:0}#wg-vraag-venster .k{padding-left:16px}#wg-vraag-venster .m,#wg-vraag-venster .l,#wg-vraag-venster form,#wg-vraag-venster .sr{padding-left:16px;padding-right:16px}#wg-vraag-venster .t{padding:0 16px max(16px,env(safe-area-inset-bottom))}}' +
    '@media (prefers-reduced-motion:no-preference){#wg-vraag-venster{animation:wgVraagIn .2s ease-out}@keyframes wgVraagIn{from{opacity:0}to{opacity:1}}}' +
    '@media print{#wg-vraag-venster{display:none}}';

  // Logo Websitegesprek, gelijk aan de kop van websitegesprek.nl (zodat een schermafbeelding herkenbaar van ons is).
  var LOGO = '<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#F2B33D"/><g transform="translate(0,16)"><path d="M118 150a46 46 0 0 1 46-46h184a46 46 0 0 1 46 46v136a46 46 0 0 1-46 46H236l-82 70v-70a46 46 0 0 1-36-45z" fill="#0E1B2C"/><g stroke="#F2B33D" stroke-width="26" stroke-linecap="round"><line x1="196" y1="196" x2="196" y2="240"/><line x1="256" y1="168" x2="256" y2="268"/><line x1="316" y1="196" x2="316" y2="240"/></g></g></svg>';
  var MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  var LUID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  var DUIM_OP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11v9H4v-9h3zM7 11l4-8c1.7 0 3 1.3 3 3v3h5.2c1.3 0 2.2 1.2 1.9 2.4l-1.6 7c-.2.9-1 1.6-1.9 1.6H7"/></svg>';
  var DUIM_NEER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 13V4h3v9h-3zM17 13l-4 8c-1.7 0-3-1.3-3-3v-3H4.8c-1.3 0-2.2-1.2-1.9-2.4l1.6-7C4.7 4.7 5.5 4 6.4 4H17"/></svg>';

  var el, lijst, invoer, knop, token = null, bezig = false, opnieuw = 0;

  function maak(tag, attrs, tekst) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (tekst != null) e.textContent = tekst;
    return e;
  }
  // Knop met een vast, eigen SVG-icoon (nooit tekst van buiten).
  function icoonKnop(svg, label) {
    var b = maak('button', { type: 'button', 'aria-label': label, 'aria-pressed': 'false' });
    var tpl = document.createElement('template');
    tpl.innerHTML = svg; // alleen vaste iconen uit dit bestand
    if (tpl.content) b.appendChild(tpl.content.cloneNode(true));
    return b;
  }
  function veiligeLink(url) {
    try { var u = new URL(url); return u.protocol === 'https:' && u.hostname === 'websitegesprek.nl' ? u.href : null; } catch (e) { return null; }
  }
  function bewaar() {
    try {
      var items = [];
      lijst.querySelectorAll('.b').forEach(function (b) { items.push({ c: b.className, t: b.getAttribute('data-t') || '', bron: b.getAttribute('data-bron') || '', id: b.getAttribute('data-id') || '' }); });
      sessionStorage.setItem(OPSLAG, JSON.stringify(items.slice(-40)));
    } catch (e) { /* sessionStorage kan ontbreken: niet erg */ }
  }
  /* ---------- spraak (besluit 409) ---------- */
  // Voorlezen gebeurt helemaal op de telefoon (speechSynthesis): er gaat niets naar buiten.
  var KAN_LEZEN = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  // Inspreken via de spraakherkenning van de browser (Safari: Apple, Chrome: Google). Geen knop als de browser het niet kan.
  var Herkenning = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var gesproken = false; // vraag ingesproken: lees het antwoord dan vanzelf voor
  var leesKnop = null;
  // S6 (Juridisch 14 nov): alleen een stem die op het toestel zelf draait (localService); anders geen luidsprekertje.
  function stem() {
    if (!KAN_LEZEN) return null;
    var lijstStemmen = [];
    try { lijstStemmen = window.speechSynthesis.getVoices() || []; } catch (e) { return null; }
    var taalcode = NL ? 'nl' : 'en';
    for (var i = 0; i !== lijstStemmen.length; i++) {
      var v = lijstStemmen[i];
      if (v && v.localService === true && String(v.lang).toLowerCase().indexOf(taalcode) === 0) return v;
    }
    return null;
  }
  // Stemmen laden soms later (Chrome); daarna kan het luidsprekertje alsnog verschijnen bij nieuwe antwoorden.
  try { if (KAN_LEZEN) { window.speechSynthesis.getVoices(); } } catch (e) { /* niets */ }
  function stopLezen() {
    try { if (KAN_LEZEN) window.speechSynthesis.cancel(); } catch (e) { /* niets */ }
    if (leesKnop) { leesKnop.setAttribute('aria-pressed', 'false'); leesKnop.setAttribute('aria-label', T.lees); }
    leesKnop = null;
  }
  function leesVoor(tekst, knopje) {
    if (!KAN_LEZEN) return;
    var wasZelfde = leesKnop === knopje;
    stopLezen();
    if (wasZelfde) return;
    // Voorlezen mag nooit het antwoord breken: elke fout stil afvangen.
    try {
      var s = stem();
      if (!s) return; // S6: nooit een stem via het net
      var u = new window.SpeechSynthesisUtterance(tekst);
      u.lang = s.lang || (NL ? 'nl-NL' : 'en-GB');
      u.voice = s;
      u.onend = u.onerror = function () { if (leesKnop === knopje) stopLezen(); };
      leesKnop = knopje;
      knopje.setAttribute('aria-pressed', 'true'); knopje.setAttribute('aria-label', T.leesStop);
      window.speechSynthesis.speak(u);
    } catch (e) { stopLezen(); }
  }
  var herk = null, micTimer = null;
  // S1: pas na een tik, stopt na het resultaat, na hooguit 30 seconden of bij sluiten.
  // S2: herkenning op het apparaat waar de browser dat kan (processLocally).
  // S3: de tekst komt in het invoerveld; de bezoeker verstuurt zelf met 'Stuur'.
  // S4: wij nemen zelf geen geluid op en sturen geen geluid door.
  function stopLuisteren(hard) {
    if (micTimer) { clearTimeout(micTimer); micTimer = null; }
    if (!herk) return;
    try { if (hard) herk.abort(); else herk.stop(); } catch (e) { /* niets */ }
  }
  function luisteren(micKnop) {
    if (herk) { stopLuisteren(false); return; }
    stopLezen();
    try { herk = new Herkenning(); } catch (e) { herk = null; micWerktNiet(micKnop); return; }
    herk.lang = NL ? 'nl-NL' : 'en-GB';
    herk.continuous = false;
    herk.interimResults = true;
    herk.maxAlternatives = 1;
    try { if ('processLocally' in herk) herk.processLocally = true; } catch (e) { /* browser kan het niet: dan via de browserdienst */ }
    var definitief = '';
    var vooraf = invoer.value ? invoer.value.replace(/\s+$/, '') + ' ' : '';
    var vorige = invoer.placeholder;
    micKnop.setAttribute('aria-pressed', 'true'); micKnop.setAttribute('aria-label', T.micStop);
    invoer.placeholder = T.luister;
    herk.onresult = function (ev) {
      var tussen = '';
      for (var i = ev.resultIndex; i !== ev.results.length; i++) {
        if (ev.results[i].isFinal) definitief += ev.results[i][0].transcript; else tussen += ev.results[i][0].transcript;
      }
      invoer.value = (vooraf + (definitief + tussen).trim()).slice(0, 500); pasHoogteAan();
    };
    herk.onerror = function (ev) { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture' || ev.error === 'language-not-supported' || ev.error === 'network') micWerktNiet(micKnop); };
    herk.onend = function () {
      if (micTimer) { clearTimeout(micTimer); micTimer = null; }
      herk = null;
      micKnop.setAttribute('aria-pressed', 'false'); micKnop.setAttribute('aria-label', T.mic);
      invoer.placeholder = vorige;
      var v = definitief.trim();
      if (v) { gesproken = true; invoer.value = (vooraf + v).slice(0, 500); pasHoogteAan(); }
      try { invoer.focus(); } catch (e) { /* niets */ }
    };
    try {
      herk.start();
      micTimer = setTimeout(function () { stopLuisteren(false); }, MIC_MAX_MS);
    } catch (e) { herk = null; micKnop.setAttribute('aria-pressed', 'false'); micKnop.setAttribute('aria-label', T.mic); micWerktNiet(micKnop); }
  }

  // Besluit 455: werkt inspreken niet, dan verdwijnt de microfoon (ook na herladen in dit tabblad) in plaats van een knop die niets doet.
  var MIC_UIT = 'wg-vraag-mic-uit';
  function micWerktNiet(micKnop) {
    if (micKnop) { micKnop.hidden = true; micKnop.disabled = true; }
    var sr = el ? el.querySelector('.sr') : null; if (sr) sr.hidden = true;
    try { sessionStorage.setItem(MIC_UIT, '1'); } catch (e) { /* niets */ }
    bericht('a', T.geenMic);
  }
  function micUitGezet() { try { return sessionStorage.getItem(MIC_UIT) === '1'; } catch (e) { return false; } }

  function bericht(soort, tekst, bron, id) {
    var b = maak('div', { class: 'b ' + soort, 'data-t': tekst });
    b.appendChild(document.createTextNode(tekst));
    var link = bron ? veiligeLink(bron) : null;
    if (link) {
      b.setAttribute('data-bron', link);
      b.appendChild(document.createTextNode(' '));
      var a = maak('a', { href: link, target: '_self' }, T.bron + ' →');
      b.appendChild(a);
    }
    if (id) {
      b.setAttribute('data-id', id);
      b.appendChild(maak('span', { class: 'id' }, id));
      var d = maak('div', { class: 'd', role: 'group', 'aria-label': T.nuttig });
      var ja = icoonKnop(DUIM_OP, T.ja);
      var nee = icoonKnop(DUIM_NEER, T.nee);
      ja.onclick = function () { duim(id, 1, ja, nee); };
      nee.onclick = function () { duim(id, -1, nee, ja); };
      d.appendChild(ja); d.appendChild(nee);
      if (VOORLEZEN && stem()) {
        var lees = icoonKnop(LUID, T.lees);
        lees.onclick = function () { leesVoor(tekst, lees); };
        d.appendChild(lees);
        if (gesproken) { gesproken = false; leesVoor(tekst, lees); }
      }
      b.appendChild(d);
    }
    lijst.appendChild(b);
    lijst.scrollTop = lijst.scrollHeight;
    bewaar();
    return b;
  }
  function duim(id, w, aan, uit) {
    aan.setAttribute('aria-pressed', 'true'); uit.setAttribute('aria-pressed', 'false');
    if (token) post('/v1/duim', { token: token, id: id, duim: w }, 4000).catch(function () {});
  }
  function terugval(tekst) {
    bericht('a', tekst);
    invoer.disabled = true; knop.disabled = true;
  }

  function haalToken(klaar) {
    post('/v1/puzzel', {}, 3000).then(function (p) {
      if (!p.uitdaging) return klaar(null);
      losOp(p.uitdaging, p.bits, function (opl) {
        post('/v1/token', { uitdaging: p.uitdaging, oplossing: opl }, 3000).then(function (r) {
          if (!r.token) return klaar(null);
          token = r.token;
          klaar(r);
        }).catch(function () { klaar(null); });
      });
    }).catch(function () { klaar(null); });
  }

  // Besluit 458 B: het goedgekeurde antwoord verschijnt woord voor woord (de controle is dan al gedaan).
  // Zonder beweging (prefers-reduced-motion) meteen helemaal; link, id en duimpjes pas als de tekst er staat.
  function typ(b) {
    var knoop = b && b.firstChild;
    if (!knoop || knoop.nodeType !== 3) return;
    var stil = false;
    try { stil = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { stil = false; }
    if (stil) return;
    var woorden = knoop.nodeValue.split(/(\s+)/);
    if (woorden.length !== 1) {
      b.className += ' typt'; lijst.setAttribute('aria-busy', 'true');
      knoop.nodeValue = '';
      var i = 0;
      var stap = function () {
        knoop.nodeValue += woorden[i] + (woorden[i + 1] || ''); i += 2;
        lijst.scrollTop = lijst.scrollHeight;
        if (woorden.length - i > 0) setTimeout(stap, 35);
        else { b.className = b.className.replace(' typt', ''); lijst.removeAttribute('aria-busy'); }
      };
      stap();
    }
  }

  function pasHoogteAan() {
    if (!invoer) return;
    invoer.style.height = 'auto';
    invoer.style.height = Math.min(invoer.scrollHeight + 2, 146) + 'px';
  }
  var klapMelding = function () { /* wordt gezet zodra het venster er is */ };
  function stuur(tekst) {
    if (bezig) return;
    tekst = String(tekst || '').trim();
    if (!tekst) return;
    if (tekst.length > 500) { bericht('a', T.tegrootte); return; }
    bezig = true; knop.disabled = true;
    klapMelding(false);
    bericht('u', tekst);
    var wacht = bericht('a', T.bezig);
    wacht.appendChild(maak('span', { class: 'pt', 'aria-hidden': 'true' })); wacht.appendChild(maak('span', { class: 'pt', 'aria-hidden': 'true' })); wacht.appendChild(maak('span', { class: 'pt', 'aria-hidden': 'true' }));
    var t6 = setTimeout(function () { wacht.firstChild.nodeValue = T.nogEven; }, 6000);
    function klaar() { clearTimeout(t6); if (wacht.parentNode) wacht.parentNode.removeChild(wacht); bezig = false; knop.disabled = false; bewaar(); }
    function vraag() {
      post('/v1/vraag', { token: token, vraag: tekst, pagina: location.href.split('#')[0] }, 28000).then(function (r) {
        if (r.__status === 401 && opnieuw < 1) {
          opnieuw++;
          return haalToken(function (ok) { if (ok) vraag(); else { klaar(); terugval(T.mislukt); } });
        }
        opnieuw = 0;
        klaar();
        if (r.uit) return terugval(T.uit);
        if (r.fout === 'gesprek_vol') return terugval(T.vol);
        if (!r.antwoord) return terugval(T.mislukt);
        typ(bericht('a', r.antwoord, r.bron, r.id));
      }).catch(function () { klaar(); terugval(T.mislukt); });
    }
    vraag();
  }

  function open() {
    if (el) { el.style.display = 'flex'; invoer.focus(); return; }
    var st = maak('style'); st.textContent = css; document.head.appendChild(st);
    el = maak('div', { id: 'wg-vraag-venster', role: 'dialog', 'aria-label': T.titel, 'aria-modal': 'false' });
    var k = maak('div', { class: 'k' });
    var merk = maak('div', { class: 'mk' });
    var logo = maak('span', { class: 'lg' });
    var tplLogo = document.createElement('template'); tplLogo.innerHTML = LOGO;
    if (tplLogo.content) logo.appendChild(tplLogo.content.cloneNode(true));
    var namen = maak('span', { class: 'nm' });
    namen.appendChild(maak('h2', null, T.naam));
    namen.appendChild(maak('span', { class: 'sub' }, T.titel));
    merk.appendChild(logo); merk.appendChild(namen); k.appendChild(merk);
    var x = maak('button', { type: 'button', class: 'x', 'aria-label': T.sluit });
    x.onclick = function () { stopLezen(); stopLuisteren(true); el.style.display = 'none'; };
    k.appendChild(x); el.appendChild(k);
    // V1: helemaal zichtbaar vóór de eerste vraag. Daarna ingeklapt tot de eerste zin (blijft altijd zichtbaar: je praat met
    // een AI), met 'Meer' om de rest weer te tonen (wens Raymond 15 nov 08:49: de melding bedekte te veel van het scherm).
    var punt = T.v1.indexOf('.') + 1;
    var melding = maak('div', { class: 'm' });
    var mKort = maak('span', { class: 'mkort' }, T.v1.slice(0, punt));
    var mRest = maak('span', { class: 'mrest', id: 'wg-vraag-v1-rest' }, T.v1.slice(punt));
    var mKnop = maak('button', { type: 'button', class: 'mt', 'aria-expanded': 'true', 'aria-controls': 'wg-vraag-v1-rest' }, T.minder);
    klapMelding = function (open) {
      melding.className = open ? 'm' : 'm dicht';
      mKnop.setAttribute('aria-expanded', open ? 'true' : 'false');
      mKnop.textContent = open ? T.minder : T.meer;
    };
    mKnop.onclick = function () { klapMelding(melding.className.indexOf('dicht') > -1); };
    melding.appendChild(mKort); melding.appendChild(mRest); melding.appendChild(mKnop);
    el.appendChild(melding);
    lijst = maak('div', { class: 'l', 'aria-live': 'polite' });
    el.appendChild(lijst);
    var f = maak('form');
    invoer = maak('textarea', { rows: '1', maxlength: '500', placeholder: T.plaats, 'aria-label': T.plaats });
    // Tekstvak groeit mee met wat je typt, tot 5 regels; daarna scrollt het (Raymond 15 nov 10:24).
    invoer.oninput = pasHoogteAan;
    knop = maak('button', { type: 'submit', class: 's' }, T.stuur);
    invoer.disabled = true; knop.disabled = true;
    var mic = null;
    if (Herkenning) {
      mic = icoonKnop(MIC, T.mic);
      mic.className = 'mi'; mic.hidden = true; mic.disabled = true;
      mic.onclick = function () { luisteren(mic); };
    }
    f.appendChild(invoer); if (mic) f.appendChild(mic); f.appendChild(knop); el.appendChild(f);
    var spraakRegel = maak('p', { class: 'sr', hidden: 'hidden' }, T.spraakRegel);
    el.appendChild(spraakRegel);
    // Onderregel (wens Raymond 13 nov): geen knoppenrij meer, wel altijd de weg naar een mens.
    var t = maak('p', { class: 't' });
    t.appendChild(document.createTextNode(T.mens + ' '));
    t.appendChild(maak('a', { href: WA, target: '_blank', rel: 'noopener' }, T.wa));
    t.appendChild(document.createTextNode(' ' + T.of + ' '));
    t.appendChild(maak('a', { href: MAIL }, T.mail));
    t.appendChild(document.createTextNode(' · '));
    t.appendChild(maak('a', { href: PRIVACY, target: '_self' }, T.privacy)); // VA1
    // Open zwevende WhatsApp-kaart sluiten zodra het venster opent (één ding tegelijk in beeld).
    var zw = document.querySelector('details.wg-zweef'); if (zw) zw.open = false;
    el.appendChild(t);
    f.onsubmit = function (ev) { ev.preventDefault(); var v = invoer.value; invoer.value = ''; pasHoogteAan(); stuur(v); };
    invoer.onkeydown = function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); f.onsubmit(ev); } };
    el.onkeydown = function (ev) { if (ev.key === 'Escape') { stopLezen(); stopLuisteren(true); el.style.display = 'none'; } };
    document.body.appendChild(el);
    try {
      var oud = JSON.parse(sessionStorage.getItem(OPSLAG) || '[]');
      if (oud.length) klapMelding(false);
      oud.forEach(function (o) { if (o.c.indexOf('u') > -1) bericht('u', o.t); else bericht('a', o.t, o.bron, o.id); });
    } catch (e) { /* niets */ }
    haalToken(function (r) {
      if (!r) return terugval(T.mislukt);
      if (!r.aan) return terugval(T.uit);
      invoer.disabled = false; knop.disabled = false; invoer.focus();
      // Microfoon alleen na akkoord Juridisch (blok op de site data-spraak="1", of VRAAG_SPRAAK=1 op de server). De testlink ?vraagbaak=test
      // toont het venster zoals bezoekers het zien, dus zonder microfoon (Raymond 15 nov 09:27); proberen kan met &spraak=1.
      var blok = document.getElementById('wg-vraag-blok');
      var spraakAan = r.spraak || (blok ? blok.getAttribute('data-spraak') === '1' : false);
      if (mic && !micUitGezet() && (spraakAan || location.search.indexOf('spraak=1') > -1)) { mic.hidden = false; mic.disabled = false; spraakRegel.hidden = false; }
    });
  }

  window.WGVraagbaak = { open: open };
  open();
})();
