/*
 * Générique Atelier — app.js
 * User interface: credits editor (sections / rows, bulk text), generic
 * form bindings, live canvas preview with play / pause / scrub, themes,
 * language switch, exports (WebM via MediaRecorder, PNG frame, PNG sheet,
 * JSON, text), autosave and keyboard shortcuts.
 * Original code — MIT licence © 2026 Amirouche Amwanes.
 */
(function () {
  'use strict';
  var C = window.GACore, R = window.GARender, I18N = window.GAI18N;
  var $ = function (id) { return document.getElementById(id); };
  var PROJECT_KEY = 'generique-atelier:project:v1', LANG_KEY = 'generique-atelier:lang', UI_KEY = 'generique-atelier:ui:v1';

  /* ------------------------------------------------------------ storage */
  function load(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }

  var P;
  try { P = C.validateProject(load(PROJECT_KEY, null)); } catch (e) { P = C.defaultProject(); }
  var lang = load(LANG_KEY, null);
  if (!I18N.STR[lang]) lang = 'fr';
  var ui = load(UI_KEY, {}) || {};

  function t(key) { var v = I18N.STR[lang][key]; return v !== undefined ? v : (I18N.STR.fr[key] !== undefined ? I18N.STR.fr[key] : key); }

  var saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (!save(PROJECT_KEY, P)) { // quota exceeded (big logo): keep everything but the logo
        var light = C.clone(P); light.closing.logo = ''; save(PROJECT_KEY, light);
      }
      save(UI_KEY, { loop: $('loop').checked, checker: $('checker').checked });
    }, 250);
  }

  /* --------------------------------------------------------------- toast */
  var toastTimer = 0;
  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ------------------------------------------------------- path helpers */
  function getPath(path) { var o = P, ks = path.split('.'); for (var i = 0; i < ks.length; i++) o = o == null ? undefined : o[ks[i]]; return o; }
  function setPath(path, v) { var o = P, ks = path.split('.'); for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
  var NUMERIC = /^(output\.(fps|bitrate)|style\.(bgAngle|grain|vignette|size\w+|lineGap|sectionGap|gutter|width)|timing\.(duration|speed|hold|fade))$/;

  /* ---------------------------------------------------------- languages */
  function applyLang() {
    document.documentElement.lang = lang === 'kab' ? 'kab' : lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    fillThemes();
    renderSections();
    updatePlayButton();
    updateInfo();
  }
  function fillLangs() {
    var sel = $('lang'); sel.innerHTML = '';
    I18N.LANGS.forEach(function (l) { var o = document.createElement('option'); o.value = l[0]; o.textContent = l[1]; sel.appendChild(o); });
    sel.value = lang;
    sel.addEventListener('change', function () { lang = sel.value; save(LANG_KEY, lang); applyLang(); });
  }

  /* ------------------------------------------------- selects and themes */
  function fillStatic() {
    document.querySelectorAll('.font-select').forEach(function (sel) {
      C.FONTS.forEach(function (f) { var o = document.createElement('option'); o.value = f.id; o.textContent = f.label; sel.appendChild(o); });
    });
    var res = $('fRes');
    C.RESOLUTIONS.forEach(function (r) { var o = document.createElement('option'); o.value = r.id; o.textContent = r.label; res.appendChild(o); });
  }
  function themeMatches() {
    var th = C.theme(P.style.theme);
    for (var k in th.s) if (th.s[k] !== P.style[k]) return false;
    return true;
  }
  function fillThemes() {
    var sel = $('theme'); sel.innerHTML = '';
    C.THEMES.forEach(function (th) { var o = document.createElement('option'); o.value = th.id; o.textContent = th.name[lang] || th.name.fr; sel.appendChild(o); });
    var c = document.createElement('option'); c.value = 'custom'; c.textContent = t('custom'); c.disabled = true; sel.appendChild(c);
    sel.value = themeMatches() ? P.style.theme : 'custom';
  }

  /* ------------------------------------------------------ form bindings */
  function refreshForm() {
    document.querySelectorAll('[data-k]').forEach(function (el) {
      var v = getPath(el.getAttribute('data-k'));
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = String(v) === el.value;
      else if (document.activeElement !== el) el.value = v === undefined ? '' : String(v);
      if (el.type === 'range') showRange(el);
    });
    $('theme').value = themeMatches() ? P.style.theme : 'custom';
    updateLogoUI();
    updateTimingFields();
  }
  function showRange(el) {
    var out = el.parentNode.querySelector('output'); if (!out) return;
    var v = Number(el.value);
    out.textContent = el.hasAttribute('data-pct') ? Math.round(v * 100) + ' %' : (Math.round(v * 100) / 100) + (el.getAttribute('data-unit') || '');
  }
  function bindForm() {
    document.querySelectorAll('[data-k]').forEach(function (el) {
      var ev = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'color') ? 'change' : 'input';
      var handler = function () {
        var path = el.getAttribute('data-k'), v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
        else v = el.value;
        if (NUMERIC.test(path)) { v = Number(v); if (!isFinite(v) || el.value === '') return; v = C.clamp(v, Number(el.min || -1e9), Number(el.max || 1e9)); }
        setPath(path, v);
        if (el.type === 'range') showRange(el);
        if (path.indexOf('style.') === 0) $('theme').value = themeMatches() ? P.style.theme : 'custom';
        changed(path);
      };
      el.addEventListener(ev, handler);
      if (el.type === 'color') el.addEventListener('input', handler); // live colour preview
      if (el.type === 'number') el.addEventListener('change', function () { refreshForm(); }); // normalize display after edit
    });
    $('theme').addEventListener('change', function () {
      if ($('theme').value === 'custom') return;
      P.style = C.applyTheme(P.style, $('theme').value); refreshForm(); changed('style.theme');
    });
  }
  /** Something in the project changed: relayout, redraw, autosave. */
  function changed(path) {
    var keepRatio = model ? curT / Math.max(0.001, model.m.duration) : 0;
    invalidate();
    if (path && /^(style\.mode|timing|output\.res|title|sections|closing|style\.(layout|size|lineGap|sectionGap|gutter|width|upper|font|titleFont))/.test(path)) {
      // keep the playhead at the same relative position when the duration changes
      ensureModel(); curT = Math.min(model.m.duration, keepRatio * model.m.duration);
    }
    updateTimingFields(); updateInfo(); draw(); persist();
  }

  /* ------------------------------------------------------ credits editor */
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs) { if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function iconBtn(act, label, glyph, extra) {
    var b = el('button', { type: 'button', class: 'icon-btn' + (extra ? ' ' + extra : ''), 'data-act': act, 'aria-label': label, title: label });
    b.appendChild(el('span', { 'aria-hidden': 'true' }, glyph)); return b;
  }
  function renderSections(focus) {
    var host = $('sections'); host.innerHTML = '';
    P.sections.forEach(function (sec, si) {
      var fs = el('fieldset', { class: 'section', 'data-sec': si });
      var head = el('div', { class: 'sec-head' });
      var lbl = t('sectionN') + ' ' + (si + 1);
      var inp = el('input', { type: 'text', dir: 'auto', maxlength: '300', class: 'sec-title', 'data-sec': si, 'data-f': 'title', 'aria-label': lbl + ' — ' + t('secTitle'), placeholder: t('secTitle') });
      inp.value = sec.title; head.appendChild(inp);
      var up = iconBtn('secUp', t('moveUp') + ' (' + lbl + ')', '↑'), dn = iconBtn('secDown', t('moveDown') + ' (' + lbl + ')', '↓');
      up.disabled = si === 0; dn.disabled = si === P.sections.length - 1;
      head.appendChild(up); head.appendChild(dn); head.appendChild(iconBtn('secDel', t('delSection') + ' (' + lbl + ')', '✕', 'danger'));
      fs.appendChild(head);
      var rows = el('div', { class: 'rows' });
      sec.rows.forEach(function (r, ri) {
        var row = el('div', { class: 'credit-row', 'data-row': ri });
        var n = lbl + ', ' + (ri + 1);
        var ro = el('input', { type: 'text', dir: 'auto', maxlength: '300', 'data-sec': si, 'data-row': ri, 'data-f': 'role', placeholder: t('role'), 'aria-label': t('role') + ' — ' + n });
        var na = el('input', { type: 'text', dir: 'auto', maxlength: '300', 'data-sec': si, 'data-row': ri, 'data-f': 'name', placeholder: t('name'), 'aria-label': t('name') + ' — ' + n });
        ro.value = r.role; na.value = r.name;
        row.appendChild(ro); row.appendChild(na);
        var ru = iconBtn('rowUp', t('moveUp') + ' — ' + n, '↑'), rd = iconBtn('rowDown', t('moveDown') + ' — ' + n, '↓');
        ru.disabled = ri === 0; rd.disabled = ri === sec.rows.length - 1;
        row.appendChild(ru); row.appendChild(rd); row.appendChild(iconBtn('rowDel', t('delRow') + ' — ' + n, '✕', 'danger'));
        rows.appendChild(row);
      });
      fs.appendChild(rows);
      var add = el('button', { type: 'button', class: 'btn small add-row', 'data-act': 'rowAdd' });
      add.appendChild(el('span', { 'aria-hidden': 'true' }, '＋ ')); add.appendChild(el('span', {}, t('addRow')));
      fs.appendChild(add);
      host.appendChild(fs);
    });
    $('noSections').hidden = P.sections.length > 0;
    $('secCount').textContent = P.sections.length + ' · ' + P.sections.reduce(function (a, s) { return a + s.rows.length; }, 0);
    if (focus) { var f = host.querySelector(focus); if (f) f.focus(); }
  }
  function bindEditor() {
    var host = $('sections');
    host.addEventListener('input', function (e) {
      var x = e.target, si = Number(x.getAttribute('data-sec')), f = x.getAttribute('data-f');
      if (!f || !P.sections[si]) return;
      if (f === 'title') P.sections[si].title = x.value;
      else { var ri = Number(x.getAttribute('data-row')); if (P.sections[si].rows[ri]) P.sections[si].rows[ri][f] = x.value; }
      changed('sections');
    });
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var fs = b.closest('[data-sec]'), si = Number(fs.getAttribute('data-sec')), rowEl = b.closest('[data-row]');
      var ri = rowEl ? Number(rowEl.getAttribute('data-row')) : -1, secs = P.sections, rows = secs[si].rows, focus = null;
      var swap = function (arr, i, j) { var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; };
      switch (b.getAttribute('data-act')) {
        case 'secUp': if (si > 0) { swap(secs, si, si - 1); focus = '[data-sec="' + (si - 1) + '"] [data-act="secUp"]'; } break;
        case 'secDown': if (si < secs.length - 1) { swap(secs, si, si + 1); focus = '[data-sec="' + (si + 1) + '"] [data-act="secDown"]'; } break;
        case 'secDel': secs.splice(si, 1); focus = secs.length ? '[data-sec="' + Math.min(si, secs.length - 1) + '"] .sec-title' : '#addSection'; break;
        case 'rowUp': if (ri > 0) { swap(rows, ri, ri - 1); focus = '[data-sec="' + si + '"] [data-row="' + (ri - 1) + '"] [data-act="rowUp"]'; } break;
        case 'rowDown': if (ri < rows.length - 1) { swap(rows, ri, ri + 1); focus = '[data-sec="' + si + '"] [data-row="' + (ri + 1) + '"] [data-act="rowDown"]'; } break;
        case 'rowDel': rows.splice(ri, 1); focus = '[data-sec="' + si + '"] .add-row'; break;
        case 'rowAdd': rows.push({ role: '', name: '' }); focus = '[data-sec="' + si + '"] [data-row="' + (rows.length - 1) + '"] [data-f="role"]'; break;
      }
      renderSections(focus); changed('sections');
    });
    $('addSection').addEventListener('click', function () {
      P.sections.push({ title: '', rows: [{ role: '', name: '' }] });
      renderSections('[data-sec="' + (P.sections.length - 1) + '"] .sec-title'); changed('sections');
    });
    // bulk text
    $('bulkReplace').addEventListener('click', function () { bulk(true); });
    $('bulkAppend').addEventListener('click', function () { bulk(false); });
    $('bulkLoad').addEventListener('click', function () { $('bulkText').value = C.serializeSections(P.sections); });
  }
  function bulk(replace) {
    var parsed = C.parseBulk($('bulkText').value);
    if (!parsed.length) { toast(t('tEmptyParse')); return; }
    if (replace && P.sections.length && !window.confirm(t('confirmReplace'))) return;
    P.sections = (replace ? [] : P.sections).concat(parsed).slice(0, C.LIMITS.sections);
    renderSections(); changed('sections');
    toast(parsed.length + ' ' + t('tParsed'));
  }

  /* --------------------------------------------------------------- logo */
  var assets = { logo: null };
  function loadLogoAsset() {
    if (!P.closing.logo) { assets.logo = null; return; }
    var img = new Image();
    img.onload = function () { invalidate(); draw(); };
    img.src = P.closing.logo; assets.logo = img;
  }
  function updateLogoUI() {
    var has = !!P.closing.logo;
    $('logoThumb').hidden = !has; $('logoRemove').hidden = !has;
    if (has) $('logoThumb').src = P.closing.logo; else $('logoThumb').removeAttribute('src');
  }
  function bindLogo() {
    $('logoFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          // downscale to keep the project (and localStorage) small; always stored as PNG
          var max = 900, w = img.naturalWidth || 300, h = img.naturalHeight || 300, sc = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          P.closing.logo = c.toDataURL('image/png'); P.closing.logoAspect = c.width / c.height;
          loadLogoAsset(); updateLogoUI(); changed('closing'); toast(t('tLogo'));
        };
        img.onerror = function () { toast(t('tLogoBad')); };
        img.src = fr.result;
      };
      fr.readAsDataURL(f);
    });
    $('logoRemove').addEventListener('click', function () { P.closing.logo = ''; loadLogoAsset(); updateLogoUI(); changed('closing'); });
  }

  /* -------------------------------------------------------------- fonts */
  var fontsRequested = {};
  /** Make sure the web fonts used by the project are loaded, then relayout. */
  function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    var ids = [P.style.font, P.style.titleFont, 'naskh', 'tifinagh'], jobs = [];
    ids.forEach(function (id) {
      var f = C.font(id); if (!f.web) return;
      [400, 600, 700].forEach(function (wt) {
        var key = id + wt; if (fontsRequested[key]) return; fontsRequested[key] = true;
        var fam = f.css.split(',')[0];
        jobs.push(document.fonts.load(wt + ' 40px ' + fam, 'Aa ءا ⵜⴰ').catch(function () { /* offline: system fallback */ }));
        if (wt === 400) jobs.push(document.fonts.load('italic 400 40px ' + fam, 'Aa').catch(function () {}));
      });
    });
    if (jobs.length) Promise.all(jobs).then(function () { invalidate(); draw(); });
  }

  /* ------------------------------------------------------------ preview */
  var canvas = $('preview'), ctx = canvas.getContext('2d');
  var model = null, curT = 0, playing = false, lastNow = 0, raf = 0;
  function invalidate() { model = null; }
  function frameSize() { return C.resolution(P.output.res); }
  function ensureModel() {
    if (!model) model = R.prepare(P, canvas.width, canvas.height);
    return model;
  }
  function sizeCanvas() {
    var r = frameSize(), ar = r.w / r.h, screen = $('screen');
    var availW = screen.clientWidth || 600, maxH = Math.max(220, Math.min(window.innerHeight * 0.62, 760));
    var dw = Math.min(availW, maxH * ar), dh = dw / ar;
    canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
    var dpr = Math.min(2, window.devicePixelRatio || 1), pw = Math.round(dw * dpr), ph = Math.round(dh * dpr);
    var cap = 1600 / Math.max(pw, ph); if (cap < 1) { pw = Math.round(pw * cap); ph = Math.round(ph * cap); }
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = Math.max(2, pw); canvas.height = Math.max(2, ph); invalidate(); }
  }
  function draw() {
    ensureModel();
    if (curT > model.m.duration) curT = model.m.duration;
    R.draw(ctx, P, model, curT, { checker: $('checker').checked, frame: Math.floor(curT * P.output.fps), assets: assets });
    $('time').textContent = C.formatTime(curT) + ' / ' + C.formatTime(model.m.duration);
    if (document.activeElement !== $('scrub')) $('scrub').value = String(Math.round(curT / Math.max(0.001, model.m.duration) * 1000));
  }
  function tick(now) {
    if (!playing) return;
    var dt = Math.min(0.25, (now - lastNow) / 1000); lastNow = now;
    curT += dt; ensureModel();
    if (curT >= model.m.duration) {
      if ($('loop').checked) curT = 0;
      else { curT = model.m.duration; setPlaying(false); }
    }
    draw();
    if (playing) raf = requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    ensureModel();
    if (on && curT >= model.m.duration - 1e-3) curT = 0;
    playing = on; cancelAnimationFrame(raf);
    if (on) { lastNow = performance.now(); raf = requestAnimationFrame(tick); }
    updatePlayButton();
  }
  function updatePlayButton() {
    var b = $('playBtn'); b.setAttribute('aria-pressed', playing ? 'true' : 'false');
    b.querySelector('.play-label').textContent = playing ? t('pause') : t('play');
  }
  function seek(sec) { ensureModel(); curT = Math.max(0, Math.min(model.m.duration, sec)); draw(); }
  function bindTransport() {
    $('playBtn').addEventListener('click', function () { setPlaying(!playing); });
    $('restartBtn').addEventListener('click', function () { seek(0); });
    $('scrub').addEventListener('input', function () { ensureModel(); curT = Number($('scrub').value) / 1000 * model.m.duration; draw(); });
    $('loop').addEventListener('change', persist);
    $('checker').addEventListener('change', function () { draw(); persist(); });
  }

  /* ----------------------------------------------------- timing helpers */
  function updateTimingFields() {
    var m = P.style.mode, scrolling = m === 'roll' || m === 'crawl';
    var by = scrolling ? P.timing.by : 'duration';
    document.querySelectorAll('[data-k="timing.by"]').forEach(function (r) { r.disabled = !scrolling; r.checked = r.value === by; });
    var fd = $('fDuration'), fs = $('fSpeed');
    ensureModel();
    fd.disabled = by === 'speed'; fs.disabled = !scrolling || by === 'duration';
    if (document.activeElement !== fd) fd.value = by === 'speed' ? model.m.duration.toFixed(1) : P.timing.duration;
    if (document.activeElement !== fs) fs.value = scrolling ? (by === 'duration' ? Math.round(model.m.speed) : P.timing.speed) : '';
    document.querySelector('[data-k="timing.stopOnEnd"]').disabled = m !== 'roll';
    document.querySelector('[data-k="timing.hold"]').disabled = m !== 'roll' || !P.timing.stopOnEnd;
  }
  function updateInfo() {
    if (!canvas.width) return;
    ensureModel();
    var r = frameSize(), m = model.m, parts = [t('infoDur') + ' ' + C.formatTime(m.duration)];
    if (P.style.mode === 'roll' || P.style.mode === 'crawl') parts.push(t('infoSpeed') + ' ' + Math.round(m.speed) + ' ' + t('pxs'));
    if (P.style.mode === 'cards') parts.push(model.cards.length + ' ' + t('infoCards') + ' (' + m.per.toFixed(1) + ' ' + t('infoPer') + ')');
    parts.push(r.w + '×' + r.h + ' · ' + P.output.fps + ' i/s');
    $('info').textContent = parts.join(' · ');
  }

  /* ------------------------------------------------------------ exports */
  function download(blob, name) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function fullFrame(sec) {
    var r = frameSize(), c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    var m = R.prepare(P, r.w, r.h), cctx = c.getContext('2d');
    // the still card is exported without fade at the start of the timeline
    R.draw(cctx, P, m, sec !== undefined ? sec : curT, { frame: Math.floor(curT * P.output.fps), assets: assets, noFade: P.style.mode === 'still' && curT < 0.05 });
    return c;
  }
  function toBlob(c, type) { return new Promise(function (res) { c.toBlob(function (b) { res(b); }, type || 'image/png'); }); }
  function exportPng() {
    return toBlob(fullFrame()).then(function (b) { download(b, C.fileName(P, 'png', 't' + curT.toFixed(1).replace('.', '-'))); toast(t('tPng')); });
  }
  function exportSheet() {
    var r = frameSize();
    return toBlob(R.sheet(P, r.w, r.h, assets)).then(function (b) { download(b, C.fileName(P, 'png', 'complet')); toast(t('tSheet')); });
  }
  function exportJson() {
    download(new Blob([JSON.stringify(P, null, 2)], { type: 'application/json' }), C.fileName(P, 'json'));
    toast(t('tJson'));
  }
  function setProject(obj) {
    P = C.validateProject(obj); loadLogoAsset(); invalidate(); curT = 0;
    renderSections(); refreshForm(); fillThemes(); ensureFonts(); updateInfo(); draw(); persist();
  }
  function importJson(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try { setProject(JSON.parse(fr.result)); toast(t('tLoaded')); } catch (e) { toast(t('tBad')); }
    };
    fr.readAsText(file);
  }
  function copyText() {
    var text = C.projectToText(P);
    var fallback = function () { $('bulkText').value = text; $('bulkPanel').open = true; toast(t('tCopyFail')); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { toast(t('tCopied')); }, fallback);
    }
    fallback(); return Promise.resolve();
  }

  /* ----------------------------------------------------------- WebM rec */
  var rec = null;
  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    var list = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < list.length; i++) if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(list[i])) return list[i];
    return null;
  }
  /** Real-time WebM recording of the whole timeline. Resolves with the Blob (or null if cancelled). */
  function exportWebm() {
    var mime = pickMime(), r = frameSize();
    var c = document.createElement('canvas');
    if (!mime || !c.captureStream) { toast(t('tNoRec')); return Promise.resolve(null); }
    if (rec) return Promise.resolve(null);
    setPlaying(false);
    c.width = r.w; c.height = r.h;
    var cctx = c.getContext('2d'), m = R.prepare(P, r.w, r.h), fps = P.output.fps, dur = m.m.duration;
    var stream = c.captureStream(fps), chunks = [], canceled = false;
    var mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: P.output.bitrate * 1e6 });
    rec = { mr: mr, cancel: function () { canceled = true; finish(); } };
    $('recBox').hidden = false; $('webmBtn').disabled = true; $('recProg').value = 0;
    var start = 0, frame = 0, timer = 0, done = false;
    function finish() { if (done) return; done = true; clearTimeout(timer); if (mr.state !== 'inactive') mr.stop(); }
    return new Promise(function (resolve) {
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        rec = null; $('recBox').hidden = true; $('webmBtn').disabled = false;
        if (canceled) { toast(t('tCanceled')); resolve(null); return; }
        var blob = new Blob(chunks, { type: 'video/webm' });
        download(blob, C.fileName(P, 'webm')); toast(t('tWebm')); resolve(blob);
      };
      // a timer (not rAF) keeps a steady frame rate; MediaRecorder timestamps are wall-clock
      function step() {
        if (done) return;
        var sec = (performance.now() - start) / 1000;
        R.draw(cctx, P, m, Math.min(sec, dur), { frame: frame++, assets: assets });
        $('recProg').value = Math.min(1, sec / dur);
        if (sec >= dur + 0.15) { finish(); return; }
        timer = setTimeout(step, Math.max(1, 1000 / fps - 2));
      }
      R.draw(cctx, P, m, 0, { frame: 0, assets: assets });
      mr.start(500);
      start = performance.now();
      step();
    });
  }
  function bindExports() {
    $('pngBtn').addEventListener('click', exportPng);
    $('sheetBtn').addEventListener('click', exportSheet);
    $('jsonBtn').addEventListener('click', exportJson);
    $('jsonFile').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importJson(f); });
    $('copyBtn').addEventListener('click', copyText);
    $('webmBtn').addEventListener('click', function () { exportWebm(); });
    $('recCancel').addEventListener('click', function () { if (rec) rec.cancel(); });
    $('resetBtn').addEventListener('click', function () {
      if (!window.confirm(t('confirmReset'))) return;
      setProject(C.defaultProject()); toast(t('tReset'));
    });
  }

  /* ---------------------------------------------------------- shortcuts */
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tg = e.target, tag = tg && tg.tagName;
      var typing = tag === 'INPUT' && !/^(range|checkbox|radio|button)$/.test(tg.type) || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable);
      if (typing || $('help').open) return;
      if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); setPlaying(!playing); }
      else if (e.key === 'Home') { e.preventDefault(); seek(0); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && tg.type !== 'range') { e.preventDefault(); seek(curT + (e.key === 'ArrowLeft' ? -1 : 1)); }
      else if (e.key === '?') { e.preventDefault(); openHelp(); }
    });
    $('helpBtn').addEventListener('click', openHelp);
  }
  function openHelp() { var d = $('help'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }

  /* --------------------------------------------------------------- init */
  var ready = false;
  function init() {
    fillLangs(); fillStatic();
    $('loop').checked = !!ui.loop; $('checker').checked = ui.checker !== false;
    bindForm(); bindEditor(); bindLogo(); bindTransport(); bindExports(); bindKeys();
    sizeCanvas(); loadLogoAsset();
    applyLang(); refreshForm(); ensureFonts(); draw();
    var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { sizeCanvas(); draw(); }) : null;
    if (ro) ro.observe($('screen')); else window.addEventListener('resize', function () { sizeCanvas(); draw(); });
    window.addEventListener('resize', function () { sizeCanvas(); draw(); });
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { invalidate(); draw(); });
    // when the output format changes, the preview aspect ratio changes too
    document.querySelector('[data-k="output.res"]').addEventListener('change', function () { sizeCanvas(); invalidate(); updateInfo(); draw(); });
    ready = true;
  }

  // Small API used by the end-to-end tests (and handy from the console).
  window.GeneriqueAtelier = {
    ready: function () { return ready; },
    project: function () { return C.clone(P); },
    setProject: setProject,
    model: function () { ensureModel(); return { duration: model.m.duration, speed: model.m.speed, cards: model.cards ? model.cards.length : 0, height: model.stack.height }; },
    time: function () { return curT; },
    playing: function () { return playing; },
    seek: seek,
    exportWebm: exportWebm,
    pixel: function (x, y) { var d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; }
  };
  init();
})();
