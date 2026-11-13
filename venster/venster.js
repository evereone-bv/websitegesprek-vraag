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
  var NL = /^nl\b/i.test(navigator.language || 'nl'); // VB7: Engelse melding als de browsertaal geen Nederlands is
  var T = NL ? {
    titel: 'Vraag het de vraagbaak', plaats: 'Typ je vraag…', stuur: 'Stuur', sluit: 'Sluiten', bezig: 'Even denken…', nogEven: 'Nog even…',
    mislukt: 'Dat lukt nu even niet. Vraag het via WhatsApp of mail, dan krijg je persoonlijk antwoord.',
    uit: 'De vraagbaak is even niet beschikbaar. Je vraag is welkom via WhatsApp of mail; je krijgt dan persoonlijk antwoord.',
    wa: 'Vraag het via WhatsApp', mail: 'Mail ons', bron: 'Lees meer', nuttig: 'Was dit nuttig?', ja: 'Ja, nuttig', nee: 'Nee, niet nuttig',
    v1: 'Je praat met een AI-assistent (Claude). Antwoorden kunnen fouten bevatten; wat telt, staat op onze website en in onze voorwaarden. Deel geen persoonsgegevens; liever een mens? Vraag het via WhatsApp of mail.',
    vol: 'Dit gesprek is vol. Begin een nieuw gesprek of vraag het via WhatsApp.', tegrootte: 'Je vraag is te lang (max. 500 tekens).', start: 'Verbinden…'
  } : {
    titel: 'Ask our assistant', plaats: 'Type your question…', stuur: 'Send', sluit: 'Close', bezig: 'Thinking…', nogEven: 'Almost there…',
    mislukt: "That isn't working right now. Ask us via WhatsApp or email for a personal answer.",
    uit: 'The assistant is not available right now. Ask us via WhatsApp or email for a personal answer.',
    wa: 'Ask via WhatsApp', mail: 'Email us', bron: 'Read more', nuttig: 'Was this helpful?', ja: 'Yes, helpful', nee: 'No, not helpful',
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
  var css = '' +
    '#wgv{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:min(380px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 32px));display:flex;flex-direction:column;background:#fff;color:#1b1f2a;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}' +
    '#wgv *{box-sizing:border-box}' +
    '#wgv .k{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;background:#1b1f2a;color:#fff}' +
    '#wgv .k strong{font-size:16px}' +
    '#wgv button{font:inherit;cursor:pointer;min-height:44px;min-width:44px;border-radius:10px;border:0}' +
    '#wgv .x{background:transparent;color:#fff;font-size:24px;line-height:1}' +
    '#wgv .m{padding:10px 14px;font-size:13px;color:#4a5160;background:#f4f2ec;border-bottom:1px solid #e6e2d8}' +
    '#wgv .l{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}' +
    '#wgv .b{max-width:88%;padding:10px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}' +
    '#wgv .b.u{align-self:flex-end;background:#1b1f2a;color:#fff}' +
    '#wgv .b.a{align-self:flex-start;background:#f4f2ec}' +
    '#wgv .b a{color:#1b1f2a;font-weight:600}' +
    '#wgv .id{display:block;margin-top:6px;font-size:11px;color:#6b7280}' +
    '#wgv .d{display:flex;gap:6px;margin-top:6px}' +
    '#wgv .d button{background:#fff;border:1px solid #d9d4c7;min-height:36px;min-width:44px;font-size:16px}' +
    '#wgv .d button[aria-pressed=true]{background:#f5c400;border-color:#f5c400}' +
    '#wgv form{display:flex;gap:8px;padding:10px 14px;border-top:1px solid #e6e2d8}' +
    '#wgv textarea{flex:1;resize:none;min-height:44px;max-height:120px;padding:10px;border:1px solid #cfc9bb;border-radius:10px;font:inherit}' +
    '#wgv textarea:focus,#wgv button:focus-visible,#wgv a:focus-visible{outline:3px solid #f5c400;outline-offset:2px}' +
    '#wgv .s{background:#f5c400;color:#1b1f2a;font-weight:700;padding:0 14px}' +
    '#wgv .s[disabled]{opacity:.5;cursor:default}' +
    '#wgv .t{display:flex;gap:8px;padding:0 14px 12px}' +
    '#wgv .t a{flex:1;display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px}' +
    '#wgv .t .w{background:#25D366;color:#073b1b}' +
    '#wgv .t .e{background:#eceae4;color:#1b1f2a}';

  var el, lijst, invoer, knop, token = null, bezig = false, opnieuw = 0;

  function maak(tag, attrs, tekst) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (tekst != null) e.textContent = tekst;
    return e;
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
      var ja = maak('button', { type: 'button', 'aria-label': T.ja, 'aria-pressed': 'false' }, '👍');
      var nee = maak('button', { type: 'button', 'aria-label': T.nee, 'aria-pressed': 'false' }, '👎');
      ja.onclick = function () { duim(id, 1, ja, nee); };
      nee.onclick = function () { duim(id, -1, nee, ja); };
      d.appendChild(ja); d.appendChild(nee); b.appendChild(d);
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

  function stuur(tekst) {
    if (bezig) return;
    tekst = String(tekst || '').trim();
    if (!tekst) return;
    if (tekst.length > 500) { bericht('a', T.tegrootte); return; }
    bezig = true; knop.disabled = true;
    bericht('u', tekst);
    var wacht = bericht('a', T.bezig);
    var t6 = setTimeout(function () { wacht.firstChild.nodeValue = T.nogEven; }, 6000);
    function klaar() { clearTimeout(t6); if (wacht.parentNode) wacht.parentNode.removeChild(wacht); bezig = false; knop.disabled = false; bewaar(); }
    function vraag() {
      post('/v1/vraag', { token: token, vraag: tekst, pagina: location.href.split('#')[0] }, 12000).then(function (r) {
        if (r.__status === 401 && opnieuw < 1) {
          opnieuw++;
          return haalToken(function (ok) { if (ok) vraag(); else { klaar(); terugval(T.mislukt); } });
        }
        opnieuw = 0;
        klaar();
        if (r.uit) return terugval(T.uit);
        if (r.fout === 'gesprek_vol') return terugval(T.vol);
        if (!r.antwoord) return terugval(T.mislukt);
        bericht('a', r.antwoord, r.bron, r.id);
      }).catch(function () { klaar(); terugval(T.mislukt); });
    }
    vraag();
  }

  function open() {
    if (el) { el.style.display = 'flex'; invoer.focus(); return; }
    var st = maak('style'); st.textContent = css; document.head.appendChild(st);
    el = maak('div', { id: 'wgv', role: 'dialog', 'aria-label': T.titel, 'aria-modal': 'false' });
    var k = maak('div', { class: 'k' });
    k.appendChild(maak('strong', null, T.titel));
    var x = maak('button', { type: 'button', class: 'x', 'aria-label': T.sluit }, '×');
    x.onclick = function () { el.style.display = 'none'; };
    k.appendChild(x); el.appendChild(k);
    var melding = maak('div', { class: 'm' }, T.v1); // V1: altijd zichtbaar vóór de eerste vraag
    el.appendChild(melding);
    lijst = maak('div', { class: 'l', 'aria-live': 'polite' });
    el.appendChild(lijst);
    var f = maak('form');
    invoer = maak('textarea', { rows: '1', maxlength: '500', placeholder: T.plaats, 'aria-label': T.plaats });
    knop = maak('button', { type: 'submit', class: 's' }, T.stuur);
    invoer.disabled = true; knop.disabled = true;
    f.appendChild(invoer); f.appendChild(knop); el.appendChild(f);
    var t = maak('div', { class: 't' });
    t.appendChild(maak('a', { class: 'w', href: WA, target: '_blank', rel: 'noopener' }, T.wa));
    t.appendChild(maak('a', { class: 'e', href: MAIL }, T.mail));
    el.appendChild(t);
    f.onsubmit = function (ev) { ev.preventDefault(); var v = invoer.value; invoer.value = ''; stuur(v); };
    invoer.onkeydown = function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); f.onsubmit(ev); } };
    el.onkeydown = function (ev) { if (ev.key === 'Escape') el.style.display = 'none'; };
    document.body.appendChild(el);
    try {
      var oud = JSON.parse(sessionStorage.getItem(OPSLAG) || '[]');
      oud.forEach(function (o) { if (o.c.indexOf('u') > -1) bericht('u', o.t); else bericht('a', o.t, o.bron, o.id); });
    } catch (e) { /* niets */ }
    haalToken(function (r) {
      if (!r) return terugval(T.mislukt);
      if (!r.aan) return terugval(T.uit);
      invoer.disabled = false; knop.disabled = false; invoer.focus();
    });
  }

  window.WGVraagbaak = { open: open };
  open();
})();
