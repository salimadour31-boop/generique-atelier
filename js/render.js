/*
 * Générique Atelier — render.js
 * Canvas renderer: prepares the layout for a given frame size (measuring text
 * with the real fonts) and draws any instant t of the four modes (roll,
 * perspective crawl, cards, still), plus background, film grain, vignette and
 * the full-length credits sheet.
 * Original code — MIT licence © 2026 Amirouche Amwanes.
 */
(function (root) {
  'use strict';
  var C = root.GACore;

  /* ------------------------------------------------------ font per kind */
  // weight, size multiplier source and font family for every text kind
  function kindFont(kind, s, size) {
    switch (kind) {
      case 'title': return C.fontSpec(700, size, s.titleFont);
      case 'subtitle': return C.fontSpec(400, size, s.titleFont, true);
      case 'section': return C.fontSpec(600, size, s.font);
      case 'role': return C.fontSpec(400, size, s.font);
      case 'name': return C.fontSpec(600, size, s.font);
      case 'closing': return C.fontSpec(700, size, s.titleFont);
      case 'thanks': return C.fontSpec(400, size, s.font, true);
      default: return C.fontSpec(400, size, s.font);
    }
  }
  function kindColor(kind, s) {
    if (kind === 'title' || kind === 'closing') return s.colTitle;
    if (kind === 'subtitle' || kind === 'section') return s.colSection;
    if (kind === 'role' || kind === 'thanks') return s.colRole;
    return s.colName;
  }
  function kindSize(kind, s) {
    return { title: s.sizeTitle, subtitle: s.sizeTitle * 0.38, section: s.sizeSection, role: s.sizeRole, name: s.sizeName,
      closing: s.sizeTitle * 0.75, thanks: s.sizeRole }[kind] || s.sizeName;
  }
  // letter-spacing (em). Never applied to right-to-left text: it would break Arabic joining.
  function tracking(kind, s, text) {
    if (text && C.isRTL(text)) return 0;
    return kind === 'section' && s.upperSections ? 0.22 : (kind === 'title' ? 0.04 : 0);
  }

  var hasLetterSpacing = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

  /* ------------------------------------------------------------ prepare */
  var measureCtx = null;
  /** Build the layout model for a frame of w×h pixels. */
  function prepare(p, w, h) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    var U = C.unitsFor(w, h), s = p.style, ctx = measureCtx;
    var measure = function (text, kind) {
      var size = kindSize(kind, s);
      ctx.font = kindFont(kind, s, size);
      var tr = tracking(kind, s, text);
      if (hasLetterSpacing) ctx.letterSpacing = (tr * size) + 'px';
      var wdt = ctx.measureText(text).width;
      if (hasLetterSpacing) ctx.letterSpacing = '0px';
      else wdt += tr * size * text.length;
      return wdt;
    };
    var groups = C.buildGroups(p, measure, U.w);
    var st = C.stack(groups, s);
    var model = { w: w, h: h, U: U, groups: groups, stack: st, mode: s.mode };
    if (s.mode === 'roll') model.m = C.rollMetrics(st.height, st.closingCenter, U.h, p.timing);
    else if (s.mode === 'crawl') {
      // the crawl uses a narrower plane: re-layout at 72 % of the width
      var cw = U.w * 0.72;
      model.crawlGroups = C.buildGroups(p, measure, cw);
      model.crawlStack = C.stack(model.crawlGroups, s);
      model.m = C.crawlMetrics(model.crawlStack.height, U.w, U.h, p.timing);
    } else if (s.mode === 'cards') {
      model.cards = C.buildCards(groups, U.h * 0.78);
      model.m = C.cardMetrics(model.cards.length, p.timing);
    } else {
      // still: the title card (or the first group if there is no title)
      var g0 = groups.filter(function (g) { return g.kind === 'title'; })[0] || groups[0] || { blocks: [], h: 0 };
      model.cards = [{ kind: g0.kind, blocks: g0.blocks, h: g0.h }];
      var d = p.timing.duration;
      model.m = { duration: d, fade: Math.min(p.timing.fade, d / 3) };
    }
    return model;
  }

  /* --------------------------------------------------------- background */
  function drawBackground(ctx, w, h, s, opts) {
    ctx.save();
    if (s.bgType === 'transparent') {
      ctx.clearRect(0, 0, w, h);
      if (opts && opts.checker) drawChecker(ctx, w, h);
    } else if (s.bgType === 'linear') {
      var a = (s.bgAngle - 90) * Math.PI / 180, r = Math.abs(w / 2 * Math.cos(a)) + Math.abs(h / 2 * Math.sin(a));
      var gr = ctx.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 - Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      gr.addColorStop(0, s.bg1); gr.addColorStop(1, s.bg2); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    } else if (s.bgType === 'radial') {
      var rg = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.hypot(w, h) * 0.6);
      rg.addColorStop(0, s.bg1); rg.addColorStop(1, s.bg2); ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    } else { ctx.fillStyle = s.bg1; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
  }
  var checker = null;
  function drawChecker(ctx, w, h) {
    if (!checker) {
      checker = document.createElement('canvas'); checker.width = checker.height = 32;
      var c = checker.getContext('2d'); c.fillStyle = '#2b2b33'; c.fillRect(0, 0, 32, 32); c.fillStyle = '#3a3a44'; c.fillRect(0, 0, 16, 16); c.fillRect(16, 16, 16, 16);
    }
    ctx.fillStyle = ctx.createPattern(checker, 'repeat'); ctx.fillRect(0, 0, w, h);
  }

  /* --------------------------------------------------- grain / vignette */
  var grainTiles = null;
  function makeGrain() {
    grainTiles = [];
    var seed = 12345;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    for (var k = 0; k < 4; k++) {
      var c = document.createElement('canvas'); c.width = c.height = 192;
      var g = c.getContext('2d'), img = g.createImageData(192, 192), d = img.data;
      for (var i = 0; i < d.length; i += 4) { var v = (rnd() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      g.putImageData(img, 0, 0); grainTiles.push(c);
    }
  }
  function drawGrain(ctx, w, h, amount, frame) {
    if (amount <= 0) return;
    if (!grainTiles) makeGrain();
    var tile = grainTiles[frame % grainTiles.length], u = Math.max(1, Math.min(w, h) / 1080);
    ctx.save();
    ctx.globalAlpha = amount * 0.22; ctx.globalCompositeOperation = 'overlay';
    var pat = ctx.createPattern(tile, 'repeat');
    var ox = (frame * 73) % 192, oy = (frame * 131) % 192;
    ctx.translate(-ox, -oy); ctx.scale(u, u); ctx.fillStyle = pat; ctx.fillRect(0, 0, (w + 192 * u) / u, (h + 192 * u) / u);
    ctx.restore();
  }
  function drawVignette(ctx, w, h, amount) {
    if (amount <= 0) return;
    ctx.save();
    var g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.58);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + (0.85 * amount).toFixed(3) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  }

  /* -------------------------------------------------------------- text */
  /**
   * Draw one block. (cx, cy) is the centre of the frame column, k the units ->
   * pixels factor (k already includes the perspective scale for the crawl).
   */
  function drawBlock(ctx, b, s, cx, y, k, assets, alpha, sy) {
    // sy < 1 squashes the block vertically (perspective foreshortening of the crawl)
    if (sy !== undefined && sy !== 1) {
      ctx.save(); ctx.translate(0, y); ctx.scale(1, sy);
      drawBlock(ctx, b, s, cx, 0, k, assets, alpha);
      ctx.restore(); return;
    }
    if (b.kind === 'logo') {
      var img = assets && assets.logo;
      if (img && img.complete && img.naturalWidth) { ctx.globalAlpha = alpha; ctx.drawImage(img, cx + (b.x - b.w / 2) * k, y - b.h / 2 * k, b.w * k, b.h * k); }
      return;
    }
    var size = b.size * k;
    if (size < 0.6) return;
    ctx.globalAlpha = alpha;
    ctx.font = kindFont(b.kind, s, size);
    ctx.fillStyle = kindColor(b.kind, s);
    if (hasLetterSpacing) ctx.letterSpacing = (tracking(b.kind, s, b.text) * size) + 'px';
    // per-string direction: Arabic names are shaped and ordered right-to-left
    ctx.direction = b.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = b.align; // 'left' / 'right' / 'center' are absolute, whatever the direction
    ctx.textBaseline = 'middle';
    ctx.fillText(b.text, cx + b.x * k, y);
  }
  function setShadow(ctx, s, k) {
    if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 10 * k; ctx.shadowOffsetY = 2 * k; }
    else { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
  }

  /** Draw a card (group) centred vertically in the frame. */
  function drawCard(ctx, card, s, w, h, k, assets, alpha) {
    var top = h / 2 - card.h * k / 2;
    for (var i = 0; i < card.blocks.length; i++) { var b = card.blocks[i]; drawBlock(ctx, b, s, w / 2, top + b.y * k, k, assets, alpha); }
  }

  /* --------------------------------------------------------------- draw */
  /** Draw the frame at time t (seconds). opts: { checker, frame, assets } */
  function draw(ctx, p, model, t, opts) {
    opts = opts || {};
    var w = model.w, h = model.h, k = model.U.u, s = p.style, m = model.m;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    drawBackground(ctx, w, h, s, opts);
    setShadow(ctx, s, k);
    if (s.mode === 'roll') {
      var off = C.rollOffset(t, m) * k, alpha = m.hold > 0 ? C.fadeInOut(t, m.duration, 0, Math.min(p.timing.fade, m.hold)) : 1;
      var blocks = model.stack.blocks;
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i], y = h + b.y * k - off, ext = (b.kind === 'logo' ? b.h : b.size) * k;
        if (y < -ext || y > h + ext) continue;
        drawBlock(ctx, b, s, w / 2, y, k, opts.assets, alpha);
      }
    } else if (s.mode === 'crawl') {
      var g = m.geom, sP = Math.min(m.travel, Math.max(0, t) * m.speed), cb = model.crawlStack.blocks;
      var endA = C.fadeInOut(t, m.duration, 0, Math.min(1.5, m.duration / 4));
      for (var j = 0; j < cb.length; j++) {
        var bb = cb[j], pp = sP - bb.y;           // distance of this line beyond the bottom edge
        if (pp < -(bb.size || bb.h || 40) * 1.5) continue;
        var pr = C.crawlProject(pp, g);
        if (pr.scale < g.far) continue;
        var fade = Math.min(1, (pr.scale - g.far) / (g.far * 1.5)) * endA;
        drawBlock(ctx, bb, s, w / 2, pr.y * k, k * pr.scale, opts.assets, fade, pr.squash);
      }
    } else if (s.mode === 'cards') {
      var st = C.cardAt(Math.min(t, m.duration - 1e-6), model.cards.length, m);
      if (st.index >= 0) drawCard(ctx, model.cards[st.index], s, w, h, k, opts.assets, st.alpha);
    } else {
      var a = C.fadeInOut(t, m.duration, m.fade, m.fade);
      if (opts.noFade) a = 1;
      if (model.cards[0]) drawCard(ctx, model.cards[0], s, w, h, k, opts.assets, a);
    }
    ctx.globalAlpha = 1; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    if (hasLetterSpacing) ctx.letterSpacing = '0px';
    ctx.direction = 'ltr';
    drawVignette(ctx, w, h, s.bgType === 'transparent' ? 0 : s.vignette);
    drawGrain(ctx, w, h, s.bgType === 'transparent' ? 0 : s.grain, opts.frame || 0);
    ctx.restore();
  }

  /**
   * Full credits sheet: every group stacked on one tall image at width w.
   * Returns a canvas. Height is capped (browser canvas limits) by scaling down.
   */
  function sheet(p, w, h, assets) {
    var model = prepare(p, w, h), k = model.U.u, pad = 120 * k;
    var H = Math.ceil(model.stack.height * k + pad * 2), scale = 1, MAX = 16000;
    if (H > MAX) scale = MAX / H;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(H * scale));
    var ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    drawBackground(ctx, w, H, p.style, {});
    setShadow(ctx, p.style, k);
    var blocks = model.stack.blocks;
    for (var i = 0; i < blocks.length; i++) drawBlock(ctx, blocks[i], p.style, w / 2, pad + blocks[i].y * k, k, assets, 1);
    ctx.globalAlpha = 1; ctx.shadowColor = 'transparent';
    drawVignette(ctx, w, H, p.style.bgType === 'transparent' ? 0 : p.style.vignette * 0.5);
    return c;
  }

  root.GARender = { prepare: prepare, draw: draw, sheet: sheet, kindFont: kindFont };
})(typeof self !== 'undefined' ? self : this);
