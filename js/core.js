/*
 * Générique Atelier — core.js
 * Pure logic, no DOM: project schema and validation, resolutions, themes,
 * fonts, bulk text parser / serializer, RTL detection, layout engine (works
 * with any text-measuring function, so it is unit-testable in Node), roll /
 * crawl / card timing math, perspective projection, file names.
 * Original code — MIT licence © 2026 Amirouche Amwanes.
 *
 * Coordinate system: every size is expressed in "units" = pixels at a
 * 1080-pixel reference short side. On the real canvas, 1 unit = min(W, H) / 1080.
 */
(function (root) {
  'use strict';

  var VERSION = 1;

  /* ------------------------------------------------------------ helpers */
  function clamp(v, a, b) { v = Number(v); if (!isFinite(v)) v = a; return Math.min(b, Math.max(a, v)); }
  function num(v, a, b, d) { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; }
  function str(v, max, d) { return typeof v === 'string' ? v.slice(0, max || 200) : (d === undefined ? '' : d); }
  function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function color(v, d) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d; }
  function bool(v, d) { return typeof v === 'boolean' ? v : d; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* -------------------------------------------------------- resolutions */
  var RESOLUTIONS = [
    { id: 'hd', w: 1920, h: 1080, label: '16:9 · 1920×1080' },
    { id: 'scope', w: 1920, h: 804, label: '2.39:1 · 1920×804' },
    { id: 'vertical', w: 1080, h: 1920, label: '9:16 · 1080×1920' },
    { id: 'square', w: 1080, h: 1080, label: '1:1 · 1080×1080' },
    { id: 'uhd', w: 3840, h: 2160, label: '4K UHD · 3840×2160' }
  ];
  function resolution(id) { for (var i = 0; i < RESOLUTIONS.length; i++) if (RESOLUTIONS[i].id === id) return RESOLUTIONS[i]; return RESOLUTIONS[0]; }
  /** Size of the frame in layout units (short side = 1080). */
  function unitsFor(w, h) { var u = Math.min(w, h) / 1080; return { u: u, w: w / u, h: h / u }; }

  /* -------------------------------------------------------------- fonts */
  // Arabic and Tifinagh fallbacks are appended to every stack so that mixed
  // credits (French + Arabic + Tamazight names) always render with real glyphs.
  var FALLBACK = '"Noto Naskh Arabic", "Noto Sans Tifinagh", ';
  var FONTS = [
    { id: 'sans', label: 'Système — sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif', web: false },
    { id: 'serif', label: 'Système — serif', css: 'Georgia, "Times New Roman", "Noto Serif", serif', web: false },
    { id: 'cormorant', label: 'Cormorant Garamond', css: '"Cormorant Garamond", Georgia, serif', web: true },
    { id: 'cinzel', label: 'Cinzel', css: 'Cinzel, Georgia, serif', web: true },
    { id: 'oswald', label: 'Oswald', css: 'Oswald, "Arial Narrow", sans-serif', web: true },
    { id: 'josefin', label: 'Josefin Sans', css: '"Josefin Sans", system-ui, sans-serif', web: true },
    { id: 'naskh', label: 'Noto Naskh Arabic (عربي)', css: '"Noto Naskh Arabic", Georgia, serif', web: true },
    { id: 'kufi', label: 'Noto Kufi Arabic (عربي)', css: '"Noto Kufi Arabic", system-ui, sans-serif', web: true },
    { id: 'tifinagh', label: 'Noto Sans Tifinagh (ⵜⵉⴼⵉⵏⴰⵖ)', css: '"Noto Sans Tifinagh", "Noto Sans", system-ui, sans-serif', web: true },
    { id: 'mono', label: 'Système — mono', css: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace', web: false }
  ];
  var FONT_IDS = FONTS.map(function (f) { return f.id; });
  function font(id) { for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i]; return FONTS[0]; }
  /** Full CSS font-family list for a font id, with script fallbacks. */
  function fontStack(id) {
    var f = font(id), css = f.css;
    // put the script fallbacks just before the generic family / system fonts
    var first = css.split(',')[0];
    return f.web ? first + ', ' + FALLBACK + css.split(',').slice(1).join(',').trim() : FALLBACK + css;
  }
  /** Canvas font shorthand. */
  function fontSpec(weight, sizePx, id, italic) { return (italic ? 'italic ' : '') + weight + ' ' + Math.max(1, Math.round(sizePx * 100) / 100) + 'px ' + fontStack(id); }

  /* ------------------------------------------------------------- themes */
  // Original colour themes. Each one overwrites colours, background and fonts.
  var THEMES = [
    { id: 'nuit', name: { fr: 'Nuit noire', en: 'Black night', kab: 'Iḍ aberkan' },
      s: { bgType: 'solid', bg1: '#000000', bg2: '#16161c', bgAngle: 90, colTitle: '#ffffff', colSection: '#9ea3ad', colRole: '#b9bcc4', colName: '#ffffff', font: 'josefin', titleFont: 'josefin', grain: 0, vignette: 0, shadow: false } },
    { id: 'argentique', name: { fr: 'Argentique', en: 'Film stock', kab: 'Afilim aqbur' },
      s: { bgType: 'linear', bg1: '#1a110a', bg2: '#3b2717', bgAngle: 160, colTitle: '#f6e6c6', colSection: '#d9a75a', colRole: '#cdb89a', colName: '#fff4dc', font: 'cormorant', titleFont: 'cormorant', grain: 0.35, vignette: 0.55, shadow: false } },
    { id: 'atlas', name: { fr: 'Crépuscule de l’Atlas', en: 'Atlas dusk', kab: 'Tameddit n Watlas' },
      s: { bgType: 'linear', bg1: '#0a1a2f', bg2: '#22102e', bgAngle: 200, colTitle: '#eef5ff', colSection: '#7fd3ff', colRole: '#9fb3c8', colName: '#f2f6ff', font: 'oswald', titleFont: 'oswald', grain: 0.12, vignette: 0.35, shadow: false } },
    { id: 'sable', name: { fr: 'Sable clair', en: 'Light sand', kab: 'Ijdi afawan' },
      s: { bgType: 'solid', bg1: '#efe6d5', bg2: '#d9c9ab', bgAngle: 90, colTitle: '#2a2018', colSection: '#a4532b', colRole: '#5f5145', colName: '#1f1712', font: 'cormorant', titleFont: 'cinzel', grain: 0.1, vignette: 0.2, shadow: false } },
    { id: 'aurore', name: { fr: 'Aurore', en: 'Dawn', kab: 'Tafat n tafrara' },
      s: { bgType: 'radial', bg1: '#41204f', bg2: '#0c0614', bgAngle: 90, colTitle: '#ffe9dc', colSection: '#ffb38a', colRole: '#d9c2e6', colName: '#ffffff', font: 'sans', titleFont: 'cinzel', grain: 0.08, vignette: 0.3, shadow: false } },
    { id: 'incrust', name: { fr: 'Incrustation (fond transparent)', en: 'Overlay (transparent)', kab: 'Asekcem (agilal afrawan)' },
      s: { bgType: 'transparent', bg1: '#000000', bg2: '#000000', bgAngle: 90, colTitle: '#ffffff', colSection: '#ffd27a', colRole: '#e6e6e6', colName: '#ffffff', font: 'sans', titleFont: 'sans', grain: 0, vignette: 0, shadow: true } }
  ];
  var THEME_IDS = THEMES.map(function (t) { return t.id; });
  function theme(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return THEMES[0]; }
  function applyTheme(style, id) { var t = theme(id), out = clone(style); for (var k in t.s) out[k] = t.s[k]; out.theme = t.id; return out; }

  /* ------------------------------------------------------------ project */
  var MODES = ['roll', 'crawl', 'cards', 'still'];
  var LAYOUTS = ['two', 'stack', 'names'];
  var BG_TYPES = ['solid', 'linear', 'radial', 'transparent'];
  var FPS = [24, 25, 30, 60];

  function defaultStyle() {
    var s = { mode: 'roll', layout: 'two', theme: 'nuit', bgType: 'solid', bg1: '#000000', bg2: '#16161c', bgAngle: 90,
      colTitle: '#ffffff', colSection: '#9ea3ad', colRole: '#b9bcc4', colName: '#ffffff', font: 'josefin', titleFont: 'josefin',
      sizeTitle: 96, sizeSection: 30, sizeRole: 32, sizeName: 44, lineGap: 1.25, sectionGap: 80, gutter: 44, width: 0.86,
      upperSections: true, upperRoles: false, grain: 0, vignette: 0, shadow: false };
    return applyTheme(s, 'nuit');
  }
  /** Demo project (fictional film and names). */
  function defaultProject() {
    return {
      app: 'generique-atelier', version: VERSION,
      title: { show: true, title: 'Tafat n Yiḍ', subtitle: 'La lumière de la nuit · ⵜⴰⴼⴰⵜ ⵏ ⵢⵉⴹ' },
      sections: [
        { title: 'Réalisation', rows: [{ role: 'Un film de', name: 'Lounis Aït Menguellet' }] },
        { title: 'Scénario', rows: [{ role: 'Scénario', name: 'Tiziri Amrani' }, { role: 'Dialogues', name: 'ياسمين بلقاسم' }] },
        { title: 'Image', rows: [{ role: 'Directrice de la photographie', name: 'Nadia Ferhat' }, { role: 'Cadre', name: 'Massinissa Ouali' }, { role: 'Étalonnage', name: 'Sami Haddad' }] },
        { title: 'Son', rows: [{ role: 'Prise de son', name: 'Yanis Belaïd' }, { role: 'Montage son & mixage', name: 'Kahina Saadi' }] },
        { title: 'Musique', rows: [{ role: 'Musique originale', name: 'Idir Tamazight Ensemble' }, { role: 'Mandole', name: 'Aksel Hamani' }] },
        { title: 'Montage', rows: [{ role: 'Montage', name: 'Sonia Larbi' }] },
        { title: 'Avec', rows: [{ role: 'Tafat', name: 'Thiziri Mansouri' }, { role: 'Le père', name: 'Mohand Arezki' }, { role: 'La voisine', name: 'فاطمة الزهراء' }, { role: 'Le berger', name: 'ⴰⵎⴰⵣⵉⵖ' }] }
      ],
      closing: { show: true, text: 'Fin', thanks: 'Merci aux habitants du village pour leur accueil · Tanemmirt', logo: '', logoAspect: 1 },
      style: defaultStyle(),
      timing: { by: 'duration', duration: 60, speed: 110, stopOnEnd: true, hold: 4, fade: 1 },
      output: { res: 'hd', fps: 25, bitrate: 12 }
    };
  }

  var LIMITS = { sections: 80, rows: 200, text: 300 };
  /** Sanitize any object into a valid project (unknown fields dropped, numbers clamped). */
  function validateProject(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not a project');
    var hasContent = Array.isArray(o.sections) || (o.title && typeof o.title === 'object') || (o.style && typeof o.style === 'object');
    if (!hasContent) throw new Error('not a project');
    var d = defaultProject(), p = { app: 'generique-atelier', version: VERSION };
    var ti = o.title && typeof o.title === 'object' ? o.title : {};
    p.title = { show: bool(ti.show, true), title: str(ti.title, LIMITS.text, ''), subtitle: str(ti.subtitle, LIMITS.text, '') };
    p.sections = (Array.isArray(o.sections) ? o.sections : []).slice(0, LIMITS.sections).filter(function (s) { return s && typeof s === 'object'; }).map(function (s) {
      return { title: str(s.title, LIMITS.text, ''), rows: (Array.isArray(s.rows) ? s.rows : []).slice(0, LIMITS.rows).filter(function (r) { return r && typeof r === 'object'; })
        .map(function (r) { return { role: str(r.role, LIMITS.text, ''), name: str(r.name, LIMITS.text, '') }; }) };
    });
    var cl = o.closing && typeof o.closing === 'object' ? o.closing : {};
    var logo = typeof cl.logo === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(cl.logo) && cl.logo.length < 4e6 ? cl.logo : '';
    p.closing = { show: bool(cl.show, true), text: str(cl.text, LIMITS.text, ''), thanks: str(cl.thanks, 600, ''), logo: logo, logoAspect: num(cl.logoAspect, 0.05, 20, 1) };
    var s = o.style && typeof o.style === 'object' ? o.style : {}, ds = d.style;
    p.style = {
      mode: oneOf(s.mode, MODES, ds.mode), layout: oneOf(s.layout, LAYOUTS, ds.layout), theme: oneOf(s.theme, THEME_IDS, ds.theme),
      bgType: oneOf(s.bgType, BG_TYPES, ds.bgType), bg1: color(s.bg1, ds.bg1), bg2: color(s.bg2, ds.bg2), bgAngle: num(s.bgAngle, 0, 360, ds.bgAngle),
      colTitle: color(s.colTitle, ds.colTitle), colSection: color(s.colSection, ds.colSection), colRole: color(s.colRole, ds.colRole), colName: color(s.colName, ds.colName),
      font: oneOf(s.font, FONT_IDS, ds.font), titleFont: oneOf(s.titleFont, FONT_IDS, ds.titleFont),
      sizeTitle: num(s.sizeTitle, 24, 240, ds.sizeTitle), sizeSection: num(s.sizeSection, 12, 120, ds.sizeSection),
      sizeRole: num(s.sizeRole, 12, 120, ds.sizeRole), sizeName: num(s.sizeName, 12, 160, ds.sizeName),
      lineGap: num(s.lineGap, 0.9, 3, ds.lineGap), sectionGap: num(s.sectionGap, 0, 400, ds.sectionGap), gutter: num(s.gutter, 0, 300, ds.gutter),
      width: num(s.width, 0.4, 1, ds.width), upperSections: bool(s.upperSections, ds.upperSections), upperRoles: bool(s.upperRoles, ds.upperRoles),
      grain: num(s.grain, 0, 1, ds.grain), vignette: num(s.vignette, 0, 1, ds.vignette), shadow: bool(s.shadow, ds.shadow)
    };
    var t = o.timing && typeof o.timing === 'object' ? o.timing : {}, dt = d.timing;
    p.timing = { by: oneOf(t.by, ['duration', 'speed'], dt.by), duration: num(t.duration, 3, 1800, dt.duration), speed: num(t.speed, 10, 1500, dt.speed),
      stopOnEnd: bool(t.stopOnEnd, dt.stopOnEnd), hold: num(t.hold, 0, 60, dt.hold), fade: num(t.fade, 0, 5, dt.fade) };
    var out = o.output && typeof o.output === 'object' ? o.output : {};
    p.output = { res: oneOf(out.res, RESOLUTIONS.map(function (r) { return r.id; }), 'hd'), fps: FPS.indexOf(Number(out.fps)) >= 0 ? Number(out.fps) : 25,
      bitrate: num(out.bitrate, 2, 80, 12) };
    return p;
  }

  /* ---------------------------------------------------------- bulk text */
  // Accepted separators between role and name: ":" "：" (full width), tab, or " — " / " – ".
  var SEP = /\s*(?:[:：]|\t| [—–] )\s*/;
  /**
   * Parse plain text into sections.
   *   # Image                 -> new section titled "Image"
   *   Cadre : Massinissa      -> row role/name
   *   (blank line)            -> new section
   *   a line without separator: section title if the section is still empty
   *   and untitled, otherwise a name-only row.
   */
  function parseBulk(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], cur = null;
    function flush() { if (cur && (cur.title || cur.rows.length)) out.push(cur); cur = null; }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\uFEFF/, '').trim();
      if (!line) { flush(); continue; }
      if (line.charAt(0) === '#') { flush(); cur = { title: line.replace(/^#+\s*/, '').slice(0, LIMITS.text), rows: [] }; continue; }
      if (!cur) cur = { title: '', rows: [] };
      var m = line.match(SEP);
      if (m && m.index > 0 && m.index + m[0].length < line.length) {
        cur.rows.push({ role: line.slice(0, m.index).trim().slice(0, LIMITS.text), name: line.slice(m.index + m[0].length).trim().slice(0, LIMITS.text) });
      } else {
        var clean = line.replace(/[:：]\s*$/, '').trim();
        if (!cur.title && !cur.rows.length) cur.title = clean.slice(0, LIMITS.text);
        else cur.rows.push({ role: '', name: clean.slice(0, LIMITS.text) });
      }
    }
    flush();
    return out.slice(0, LIMITS.sections);
  }
  /** Inverse of parseBulk (sections only). */
  function serializeSections(sections) {
    return sections.map(function (s) {
      var lines = [];
      if (s.title) lines.push('# ' + s.title);
      s.rows.forEach(function (r) {
        if (r.role && r.name) lines.push(r.role + ' : ' + r.name);
        else if (r.name || r.role) lines.push(r.name || r.role);
      });
      return lines.join('\n');
    }).filter(Boolean).join('\n\n');
  }
  /** Human-readable text of the whole project (copy-as-text). */
  function projectToText(p) {
    var parts = [];
    if (p.title.show && (p.title.title || p.title.subtitle)) parts.push([p.title.title, p.title.subtitle].filter(Boolean).join('\n'));
    var body = serializeSections(p.sections); if (body) parts.push(body);
    if (p.closing.show && (p.closing.text || p.closing.thanks)) parts.push([p.closing.text, p.closing.thanks].filter(Boolean).join('\n'));
    return parts.join('\n\n') + '\n';
  }

  /* ---------------------------------------------------------------- RTL */
  var RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  var LTR_RE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u2D30-\u2D7F]/;
  /** True when the first strong character of the string is right-to-left (Arabic, Hebrew…). */
  function isRTL(s) {
    s = String(s || '');
    for (var i = 0; i < s.length; i++) { var c = s.charAt(i); if (RTL_RE.test(c)) return true; if (LTR_RE.test(c)) return false; }
    return false;
  }

  /* ------------------------------------------------------------- layout */
  /** Greedy word wrap with a measuring function (text -> width in units). */
  function wrap(text, maxW, measure) {
    text = String(text || '').trim(); if (!text) return [];
    if (measure(text) <= maxW) return [text];
    var words = text.split(/\s+/), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i], test = line ? line + ' ' + w : w;
      if (!line || measure(test) <= maxW) { line = test; }
      else { lines.push(line); line = w; }
      // a single word wider than the column is kept whole (canvas will just overflow slightly)
    }
    if (line) lines.push(line);
    return lines;
  }
  function upper(s, on) { return on ? String(s).toLocaleUpperCase('fr') : s; }

  /**
   * Turn the project into positioned blocks. measure(text, kind) returns the
   * width in units of `text` drawn with the style of `kind` ('title',
   * 'subtitle', 'section', 'role', 'name', 'closing', 'thanks').
   * Returns { groups: [{kind, blocks, h}], ... } where each group (title card,
   * section, closing card) has its own local y coordinates; stack() lays them
   * out vertically for the roll / crawl / sheet.
   */
  function buildGroups(p, measure, viewW) {
    var s = p.style, colW = viewW * s.width, groups = [];
    var lh = function (size) { return size * s.lineGap; };
    function textLines(kind, text, size, maxW, extra) {
      var ls = wrap(text, maxW, function (t) { return measure(t, kind); }), out = [], y = 0;
      for (var i = 0; i < ls.length; i++) { out.push({ kind: kind, text: ls[i], size: size, y: y + lh(size) / 2, rtl: isRTL(ls[i]), align: 'center', x: 0 }); y += lh(size); }
      return { lines: out, h: y + (extra || 0) };
    }
    function push(group, res, dy) { res.lines.forEach(function (l) { l.y += dy; group.blocks.push(l); }); return dy + res.h; }

    if (p.title.show && (p.title.title || p.title.subtitle)) {
      var g = { kind: 'title', blocks: [], h: 0 }, y = 0;
      if (p.title.title) y = push(g, textLines('title', p.title.title, s.sizeTitle, colW), y);
      if (p.title.subtitle) { y += s.sizeTitle * 0.15; y = push(g, textLines('subtitle', p.title.subtitle, s.sizeTitle * 0.38, colW), y); }
      g.h = y; groups.push(g);
    }
    p.sections.forEach(function (sec, si) {
      var rows = sec.rows.filter(function (r) { return (r.role || '').trim() || (r.name || '').trim(); });
      if (s.layout === 'names') rows = rows.filter(function (r) { return (r.name || '').trim(); });
      if (!rows.length && !sec.title.trim()) return;
      var g = { kind: 'section', index: si, blocks: [], h: 0, rowStarts: [] }, y = 0;
      if (sec.title.trim()) { y = push(g, textLines('section', upper(sec.title.trim(), s.upperSections), s.sizeSection, colW), y); y += s.sizeSection * 0.6; }
      g.headerH = y;
      rows.forEach(function (r, ri) {
        var role = upper((r.role || '').trim(), s.upperRoles), name = (r.name || '').trim();
        g.rowStarts.push(y);
        if (ri) y += Math.max(s.sizeName, s.sizeRole) * (s.layout === 'two' ? 0.25 : 0.55);
        if (s.layout === 'two' && role && name) {
          var half = (colW - s.gutter) / 2;
          var R = textLines('role', role, s.sizeRole, half), N = textLines('name', name, s.sizeName, half);
          // Mirror the columns when the role itself is right-to-left (Arabic credits).
          var mirror = isRTL(role);
          var rx = mirror ? s.gutter / 2 : -s.gutter / 2, nx = mirror ? -s.gutter / 2 : s.gutter / 2;
          var h = Math.max(R.h, N.h);
          R.lines.forEach(function (l) { l.align = mirror ? 'left' : 'right'; l.x = rx; l.y += y + (h - R.h) / 2; g.blocks.push(l); });
          N.lines.forEach(function (l) { l.align = mirror ? 'right' : 'left'; l.x = nx; l.y += y + (h - N.h) / 2; g.blocks.push(l); });
          y += h;
        } else {
          if (role && s.layout !== 'names') y = push(g, textLines('role', role, s.sizeRole * (s.layout === 'two' ? 1 : 0.85), colW), y);
          if (name) y = push(g, textLines('name', name, s.sizeName, colW), y);
        }
      });
      g.rowStarts.push(y);
      g.h = y; groups.push(g);
    });
    if (p.closing.show && (p.closing.text || p.closing.thanks || p.closing.logo)) {
      var c = { kind: 'closing', blocks: [], h: 0 }, cy = 0;
      if (p.closing.logo) { var lhgt = 170, lw = Math.min(colW, lhgt * p.closing.logoAspect); c.blocks.push({ kind: 'logo', y: cy + lhgt / 2, w: lw, h: lw / p.closing.logoAspect, x: 0 }); cy += lhgt + 30; }
      if (p.closing.text) cy = push(c, textLines('closing', p.closing.text, s.sizeTitle * 0.75, colW), cy);
      if (p.closing.thanks) { if (p.closing.text) cy += 20; cy = push(c, textLines('thanks', p.closing.thanks, s.sizeRole, colW * 0.85), cy); }
      c.h = cy; groups.push(c);
    }
    return groups;
  }

  /** Stack groups vertically for roll / crawl / sheet. */
  function stack(groups, style) {
    var y = 0, blocks = [], anchors = [];
    groups.forEach(function (g, i) {
      if (i) y += style.sectionGap * (g.kind === 'closing' || groups[i - 1].kind === 'title' ? 2.2 : 1);
      anchors.push({ kind: g.kind, top: y, h: g.h, center: y + g.h / 2 });
      g.blocks.forEach(function (b) { var c = {}; for (var k in b) c[k] = b[k]; c.y = b.y + y; blocks.push(c); });
      y += g.h;
    });
    var closing = anchors.filter(function (a) { return a.kind === 'closing'; })[0];
    return { blocks: blocks, height: y, anchors: anchors, closingCenter: closing ? closing.center : null };
  }

  /** Split groups into cards that fit `maxH` units (long sections are continued). */
  function buildCards(groups, maxH) {
    var cards = [];
    groups.forEach(function (g) {
      if (g.kind !== 'section' || g.h <= maxH || g.rowStarts.length < 3) { cards.push({ kind: g.kind, blocks: g.blocks, h: g.h }); return; }
      var header = g.blocks.filter(function (b) { return b.kind === 'section'; });
      var starts = g.rowStarts, i = 0, n = starts.length - 1;
      while (i < n) {
        var j = i + 1;
        while (j < n && g.headerH + starts[j + 1] - starts[i] <= maxH) j++;
        var y0 = starts[i], y1 = starts[j], off = g.headerH - y0;
        var body = g.blocks.filter(function (b) { return b.kind !== 'section' && b.y >= y0 && b.y < y1; }).map(function (b) { var c = {}; for (var k in b) c[k] = b[k]; c.y = b.y + off; return c; });
        cards.push({ kind: 'section', blocks: header.concat(body), h: g.headerH + y1 - y0, cont: i > 0 });
        i = j;
      }
    });
    return cards;
  }

  /* ------------------------------------------------------------- timing */
  /**
   * Roll metrics. Content starts just below the frame (top of content at the
   * bottom edge). With stopOnEnd the roll stops when the closing card is
   * centred, then holds `hold` seconds.
   * Returns { travel (units), speed (units/s), scroll (s), duration (s) }.
   */
  function rollMetrics(height, closingCenter, viewH, timing) {
    var stop = timing.stopOnEnd && closingCenter !== null && closingCenter !== undefined;
    var travel = stop ? viewH / 2 + closingCenter : viewH + height;
    var hold = stop ? timing.hold : 0, speed, scroll;
    if (timing.by === 'speed') { speed = timing.speed; scroll = travel / speed; }
    else { scroll = Math.max(1, timing.duration - hold); speed = travel / scroll; }
    return { travel: travel, speed: speed, scroll: scroll, hold: hold, duration: scroll + hold };
  }
  /** Scroll offset (units) at time t for the roll. */
  function rollOffset(t, m) { return Math.min(m.travel, Math.max(0, t) * m.speed); }

  /** Perspective geometry for the crawl, in units. */
  function crawlGeometry(viewW, viewH) { return { bottom: viewH, horizon: viewH * 0.08, depth: viewH * 0.8, cx: viewW / 2, far: 0.15 }; }
  /**
   * Project a plane distance p (0 = bottom edge, growing into the distance).
   * scale = horizontal size factor; squash = extra vertical factor (the plane
   * is tilted, so glyphs are foreshortened as much as the line spacing).
   */
  function crawlProject(p, g) {
    var sc = g.depth / (g.depth + Math.max(p, -g.depth * 0.9));
    return { scale: sc, y: g.horizon + (g.bottom - g.horizon) * sc, squash: Math.min(1, (g.bottom - g.horizon) / g.depth * sc) };
  }
  function crawlMetrics(height, viewW, viewH, timing) {
    var g = crawlGeometry(viewW, viewH);
    var farP = g.depth * (1 / g.far - 1);     // distance at which text has shrunk to 15 % (fully faded)
    var travel = height + farP;
    var speed, duration;
    if (timing.by === 'speed') { speed = timing.speed; duration = travel / speed; }
    else { duration = timing.duration; speed = travel / duration; }
    return { travel: travel, speed: speed, scroll: duration, hold: 0, duration: duration, geom: g };
  }

  /** Sequential cards: equal share of the total duration, cross-fades of `fade` s. */
  function cardMetrics(nCards, timing) {
    var duration = timing.duration, per = duration / Math.max(1, nCards);
    return { per: per, duration: duration, fade: Math.min(timing.fade, per / 2.5) };
  }
  /** Which card is visible at t, and its opacity (fade in / out). */
  function cardAt(t, n, m) {
    if (n <= 0) return { index: -1, alpha: 0 };
    var i = Math.min(n - 1, Math.max(0, Math.floor(t / m.per)));
    var local = t - i * m.per, a = 1;
    if (m.fade > 0) a = Math.min(1, local / m.fade, (m.per - local) / m.fade);
    return { index: i, alpha: Math.max(0, Math.min(1, a)), local: local };
  }
  /** Global fade for still card / end of roll. */
  function fadeInOut(t, duration, fadeIn, fadeOut) {
    var a = 1;
    if (fadeIn > 0) a = Math.min(a, t / fadeIn);
    if (fadeOut > 0) a = Math.min(a, (duration - t) / fadeOut);
    return Math.max(0, Math.min(1, a));
  }

  function formatTime(sec) {
    sec = Math.max(0, sec || 0);
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function slug(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'generique';
  }
  function fileName(p, ext, suffix) { return 'generique-' + slug(p.title && p.title.title) + (suffix ? '-' + suffix : '') + '.' + ext; }

  var API = {
    VERSION: VERSION, RESOLUTIONS: RESOLUTIONS, resolution: resolution, unitsFor: unitsFor,
    FONTS: FONTS, font: font, fontStack: fontStack, fontSpec: fontSpec, THEMES: THEMES, theme: theme, applyTheme: applyTheme,
    MODES: MODES, LAYOUTS: LAYOUTS, BG_TYPES: BG_TYPES, FPS: FPS, LIMITS: LIMITS,
    defaultProject: defaultProject, defaultStyle: defaultStyle, validateProject: validateProject, clone: clone, clamp: clamp,
    parseBulk: parseBulk, serializeSections: serializeSections, projectToText: projectToText, isRTL: isRTL, wrap: wrap,
    buildGroups: buildGroups, stack: stack, buildCards: buildCards,
    rollMetrics: rollMetrics, rollOffset: rollOffset, crawlGeometry: crawlGeometry, crawlProject: crawlProject, crawlMetrics: crawlMetrics,
    cardMetrics: cardMetrics, cardAt: cardAt, fadeInOut: fadeInOut, formatTime: formatTime, slug: slug, fileName: fileName
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.GACore = API;
})(typeof self !== 'undefined' ? self : this);
