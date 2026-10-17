// End-to-end tests (Playwright + headless Chromium) against a local static server.
// Usage:  npm i playwright && npx playwright install chromium   (outside the repo is fine)
//         python3 -m http.server 8793 &   then   GA_URL=http://localhost:8793/ node tests/e2e.js
//         SHOTS=1 also writes screenshots/desktop.png and screenshots/mobile.png
'use strict';
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const URL0 = process.env.GA_URL || 'http://localhost:8793/';
const SHOTS = !!process.env.SHOTS;
let passes = 0, failures = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? passes++ : failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function download(page, action, timeout) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: timeout || 30000 }), action()]);
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(await dl.path()) };
}
const pngSize = b => ({ sig: b.slice(1, 4).toString('ascii'), w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
// count "ink" pixels in the preview canvas (pixels that differ from the corner background)
const inkCount = page => page.evaluate(() => {
  const c = document.getElementById('preview'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const r0 = d[0], g0 = d[1], b0 = d[2]; let n = 0;
  for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 90) n++;
  return n;
});

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function newPage(width, height, mobile) {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: !!mobile, hasTouch: !!mobile, acceptDownloads: true, deviceScaleFactor: mobile ? 2 : 1 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(URL0).origin });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    return page;
  }
  const api = (page, fn, arg) => page.evaluate(fn, arg);

  /* ------------------------------------------------ desktop 1440 × 900 */
  const page = await newPage(1440, 900);
  await page.goto(URL0);
  await page.waitForFunction(() => window.GeneriqueAtelier && GeneriqueAtelier.ready(), null, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
  ok(errors.length === 0, 'desktop 1440×900 loads without console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  ok((await page.textContent('#playBtn .play-label')).trim() === 'Lecture' && await page.getAttribute('html', 'lang') === 'fr', 'French by default');
  ok(await page.locator('#sections fieldset.section').count() === 7, 'demo project: 7 sections in the editor');
  ok(await page.locator('#theme option').count() >= 6 && await page.locator('[data-k="style.font"] option').count() >= 8, 'themes and fonts listed');
  const webFonts = await page.evaluate(async () => { await document.fonts.load('600 40px "Josefin Sans"'); return document.fonts.check('600 40px "Josefin Sans"'); });
  ok(webFonts, 'Google font (Josefin Sans, OFL) loaded');

  // preview draws text
  await api(page, () => GeneriqueAtelier.seek(GeneriqueAtelier.model().duration * 0.2));
  ok(await inkCount(page) > 50, 'roll preview draws text');

  // languages
  await page.selectOption('#lang', 'en');
  ok((await page.textContent('#playBtn .play-label')).trim() === 'Play' && (await page.textContent('#hSections')).trim() === 'Sections' && await page.getAttribute('html', 'lang') === 'en', 'switch to English');
  ok(await page.getAttribute('#sections input[data-f="role"]', 'placeholder') === 'Role', 'editor placeholders translated');
  await page.selectOption('#lang', 'kab');
  ok((await page.textContent('#playBtn .play-label')).trim() === 'Urar' && (await page.textContent('#hExport')).trim() === 'Sifeḍ', 'switch to Taqbaylit');
  await page.reload(); await page.waitForFunction(() => GeneriqueAtelier.ready());
  ok(await page.inputValue('#lang') === 'kab' && (await page.textContent('#playBtn .play-label')).trim() === 'Urar', 'language persisted (localStorage)');
  await page.selectOption('#lang', 'fr');

  // editing credits
  await page.fill('#fTitle', 'Les Oliviers');
  ok((await api(page, () => GeneriqueAtelier.project().title.title)) === 'Les Oliviers', 'title edit updates the project');
  await page.click('#addSection');
  const lastSec = page.locator('#sections fieldset.section').last();
  ok(await page.evaluate(() => document.activeElement.classList.contains('sec-title')), 'new section title focused');
  await lastSec.locator('.sec-title').fill('Production');
  await lastSec.locator('input[data-f="role"]').fill('Produit par');
  await lastSec.locator('input[data-f="name"]').fill('Atelier Tafat');
  await lastSec.locator('[data-act="rowAdd"]').click();
  await page.locator('#sections fieldset.section').last().locator('input[data-f="name"]').last().fill('حياة بن علي');
  let pj = await api(page, () => GeneriqueAtelier.project());
  ok(pj.sections.length === 8 && pj.sections[7].title === 'Production' && pj.sections[7].rows[0].name === 'Atelier Tafat' && pj.sections[7].rows[1].name === 'حياة بن علي', 'add section / rows and type credits (incl. Arabic)');
  await page.locator('#sections fieldset.section').last().locator('[data-act="secUp"]').click();
  pj = await api(page, () => GeneriqueAtelier.project());
  ok(pj.sections[6].title === 'Production' && pj.sections[7].title === 'Avec', 'move section up');
  await page.locator('#sections fieldset.section').nth(2).locator('[data-row="1"] [data-act="rowDown"]').click();
  pj = await api(page, () => GeneriqueAtelier.project());
  ok(pj.sections[2].rows[2].role === 'Cadre' && pj.sections[2].rows[1].role === 'Étalonnage', 'move row down');
  await page.locator('#sections fieldset.section').nth(2).locator('[data-row="2"] [data-act="rowDel"]').click();
  await page.locator('#sections fieldset.section').nth(0).locator('[data-act="secDel"]').click();
  pj = await api(page, () => GeneriqueAtelier.project());
  ok(pj.sections.length === 7 && pj.sections[1].rows.length === 2 && pj.sections[0].title === 'Scénario', 'delete row and section');

  // bulk paste
  await page.click('#bulkPanel summary');
  await page.fill('#bulkText', '# Remerciements\nMairie de Tizi : Service culturel\nFamille Amrani\n\nLumière\nChef électricien : Rayan Saïdi');
  await page.click('#bulkAppend');
  pj = await api(page, () => GeneriqueAtelier.project());
  ok(pj.sections.length === 9 && pj.sections[7].title === 'Remerciements' && pj.sections[7].rows[1].name === 'Famille Amrani' && pj.sections[8].title === 'Lumière', 'bulk paste appends parsed sections');
  await page.click('#bulkLoad');
  ok((await page.inputValue('#bulkText')).includes('# Lumière\nChef électricien : Rayan Saïdi'), 'load current credits as text');

  // play / pause / scrub / keyboard
  await api(page, () => GeneriqueAtelier.seek(0));
  await page.click('#playBtn'); await sleep(800);
  const t1 = await api(page, () => GeneriqueAtelier.time());
  ok(await api(page, () => GeneriqueAtelier.playing()) && t1 > 0.4 && (await page.textContent('#playBtn .play-label')).trim() === 'Pause', `play advances time (${t1.toFixed(2)} s)`);
  await page.click('#playBtn');
  const t2 = await api(page, () => GeneriqueAtelier.time()); await sleep(300);
  ok(!(await api(page, () => GeneriqueAtelier.playing())) && (await api(page, () => GeneriqueAtelier.time())) === t2, 'pause stops time');
  await page.evaluate(() => { const s = document.getElementById('scrub'); s.value = '500'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  const half = await api(page, () => GeneriqueAtelier.time() / GeneriqueAtelier.model().duration);
  ok(Math.abs(half - 0.5) < 0.01 && (await page.textContent('#time')).includes('/'), 'scrub to 50 %');
  await page.click('h1'); await page.keyboard.press('Home');
  ok((await api(page, () => GeneriqueAtelier.time())) === 0, 'Home key goes back to start');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  ok(Math.abs((await api(page, () => GeneriqueAtelier.time())) - 2) < 1e-6, 'arrow keys step one second');
  await page.keyboard.press('Space'); await sleep(300);
  ok(await api(page, () => GeneriqueAtelier.playing()), 'Space toggles playback');
  await page.keyboard.press('Space');
  await page.keyboard.press('?');
  ok(await page.evaluate(() => document.getElementById('help').open), '? opens help');
  await page.keyboard.press('Escape');

  // timing: speed mode
  await page.check('input[name=by][value=speed]');
  await page.fill('#fSpeed', '200');
  let md = await api(page, () => GeneriqueAtelier.model());
  pj = await api(page, () => GeneriqueAtelier.project());
  ok(pj.timing.by === 'speed' && Math.abs(md.speed - 200) < 1e-9 && await page.isDisabled('#fDuration'), 'fixed speed: duration computed, field disabled');
  const durText = Number(await page.inputValue('#fDuration'));
  ok(Math.abs(durText - md.duration) < 0.06, `computed duration shown (${durText} s)`);
  await page.check('input[name=by][value=duration]');
  await page.fill('#fDuration', '45');
  md = await api(page, () => GeneriqueAtelier.model());
  ok(Math.abs(md.duration - 45) < 1e-9 && Number(await page.inputValue('#fSpeed')) === Math.round(md.speed), 'fixed duration: speed computed and shown');

  // every mode draws something, durations finite
  for (const mode of ['crawl', 'cards', 'still', 'roll']) {
    await page.check(`input[name=mode][value=${mode}]`);
    md = await api(page, () => GeneriqueAtelier.model());
    await api(page, (f) => GeneriqueAtelier.seek(GeneriqueAtelier.model().duration * f), mode === 'crawl' ? 0.25 : 0.5);
    const ink = await inkCount(page);
    ok(isFinite(md.duration) && md.duration > 0 && ink > 30 && (mode !== 'cards' || md.cards >= 9), `mode ${mode}: duration ${md.duration.toFixed(1)} s, draws text (${ink})` + (mode === 'cards' ? `, ${md.cards} cards` : ''));
  }
  // layouts
  for (const lay of ['stack', 'names', 'two']) {
    await page.selectOption('[data-k="style.layout"]', lay);
    await api(page, () => GeneriqueAtelier.seek(GeneriqueAtelier.model().duration * 0.4));
    ok(await inkCount(page) > 30, `layout ${lay} draws text`);
  }
  // themes + custom colour
  await page.selectOption('#theme', 'argentique');
  pj = await api(page, () => GeneriqueAtelier.project());
  ok(pj.style.theme === 'argentique' && pj.style.font === 'cormorant' && pj.style.grain > 0, 'theme applies colours, fonts, grain');
  await page.evaluate(() => { const c = document.querySelector('[data-k="style.colName"]'); c.value = '#ff0000'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  ok((await api(page, () => GeneriqueAtelier.project().style.colName)) === '#ff0000' && await page.inputValue('#theme') === 'custom', 'colour edit switches theme to "custom"');
  await page.evaluate(() => { const r = document.getElementById('sN'); r.value = '60'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok((await api(page, () => GeneriqueAtelier.project().style.sizeName)) === 60 && (await page.textContent('output[for=sN]')).includes('60'), 'size slider updates project and readout');
  await page.selectOption('#theme', 'nuit');

  // exports: PNG frame (HD then scope), sheet, JSON, text
  await api(page, () => GeneriqueAtelier.seek(5));
  let d = await download(page, () => page.click('#pngBtn'));
  let ps = pngSize(d.buf);
  ok(ps.sig === 'PNG' && ps.w === 1920 && ps.h === 1080 && /^generique-les-oliviers-t5-0\.png$/.test(d.name), `PNG frame 1920×1080 (${d.name})`);
  await page.selectOption('#fRes', 'scope');
  const ar = await page.evaluate(() => { const c = document.getElementById('preview'); return c.width / c.height; });
  ok(Math.abs(ar - 1920 / 804) < 0.02, 'preview follows 2.39:1 aspect');
  d = await download(page, () => page.click('#pngBtn')); ps = pngSize(d.buf);
  ok(ps.w === 1920 && ps.h === 804, 'PNG frame 2.39:1 scope 1920×804');
  await page.selectOption('#fRes', 'vertical');
  d = await download(page, () => page.click('#pngBtn')); ps = pngSize(d.buf);
  ok(ps.w === 1080 && ps.h === 1920, 'PNG frame 9:16 1080×1920');
  await page.selectOption('#fRes', 'hd');
  d = await download(page, () => page.click('#sheetBtn')); ps = pngSize(d.buf);
  ok(ps.sig === 'PNG' && ps.w === 1920 && ps.h > 2500 && /complet\.png$/.test(d.name), `full credits sheet PNG ${ps.w}×${ps.h}`);
  // transparent background → alpha 0 in the corner of the exported PNG
  await page.selectOption('[data-k="style.bgType"]', 'transparent');
  d = await download(page, () => page.click('#pngBtn'));
  const alpha = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return x.getImageData(2, 2, 1, 1).data[3];
  }, d.buf.toString('base64'));
  ok(alpha === 0, 'transparent background exports a real alpha channel');
  await page.selectOption('[data-k="style.bgType"]', 'solid');

  d = await download(page, () => page.click('#jsonBtn'));
  const saved = JSON.parse(d.buf.toString('utf8'));
  ok(saved.app === 'generique-atelier' && saved.title.title === 'Les Oliviers' && saved.sections.length === 9 && /\.json$/.test(d.name), 'JSON project saved');
  saved.title.title = 'Projet rechargé'; saved.style.mode = 'cards';
  const tmp = path.join(os.tmpdir(), 'ga-project.json'); fs.writeFileSync(tmp, JSON.stringify(saved));
  await page.setInputFiles('#jsonFile', tmp);
  await page.waitForFunction(() => GeneriqueAtelier.project().title.title === 'Projet rechargé');
  ok(await page.inputValue('#fTitle') === 'Projet rechargé' && await page.isChecked('input[name=mode][value=cards]'), 'JSON project loaded back into the form');
  fs.writeFileSync(tmp, '{"nope": true}');
  await page.setInputFiles('#jsonFile', tmp); await sleep(200);
  ok((await api(page, () => GeneriqueAtelier.project().title.title)) === 'Projet rechargé', 'invalid JSON rejected without changes');

  await page.click('#copyBtn'); await sleep(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip.startsWith('Projet rechargé') && clip.includes('# Lumière') && clip.includes('Chef électricien : Rayan Saïdi'), 'copy as text puts the credits in the clipboard');

  // logo upload (generated PNG)
  const logoPng = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const x = c.getContext('2d'); x.fillStyle = '#e2735a'; x.fillRect(0, 0, 200, 100); return c.toDataURL('image/png').split(',')[1]; });
  const logoFile = path.join(os.tmpdir(), 'ga-logo.png'); fs.writeFileSync(logoFile, Buffer.from(logoPng, 'base64'));
  await page.setInputFiles('#logoFile', logoFile);
  await page.waitForFunction(() => !!GeneriqueAtelier.project().closing.logo);
  pj = await api(page, () => GeneriqueAtelier.project());
  ok(pj.closing.logo.startsWith('data:image/png') && Math.abs(pj.closing.logoAspect - 2) < 0.01 && await page.isVisible('#logoThumb'), 'local logo upload (aspect 2:1)');
  await page.click('#logoRemove');
  ok((await api(page, () => GeneriqueAtelier.project().closing.logo)) === '', 'logo removed');

  // WebM export (short: 3 s, cards mode)
  await page.fill('#fDuration', '3');
  const hasRec = await page.evaluate(() => typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream);
  if (hasRec) {
    const t0 = Date.now();
    d = await download(page, () => page.click('#webmBtn'), 30000);
    const ebml = d.buf.readUInt32BE(0).toString(16);
    ok(ebml === '1a45dfa3' && d.buf.length > 5000 && /\.webm$/.test(d.name), `WebM export (${(d.buf.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s, EBML header)`);
    const vid = await page.evaluate(async (b64) => {
      const v = document.createElement('video'); v.muted = true; v.src = 'data:video/webm;base64,' + b64;
      await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('video error')); setTimeout(r, 5000); });
      return { w: v.videoWidth, h: v.videoHeight };
    }, d.buf.toString('base64'));
    ok(vid.w === 1920 && vid.h === 1080, `WebM decodes as ${vid.w}×${vid.h}`);
  } else console.log('SKIP MediaRecorder unavailable');

  // autosave
  await page.reload(); await page.waitForFunction(() => GeneriqueAtelier.ready());
  ok(await page.inputValue('#fTitle') === 'Projet rechargé', 'project autosaved and restored after reload');
  // reset to example
  await page.click('#resetBtn');
  ok((await api(page, () => GeneriqueAtelier.project().title.title)) === 'Tafat n Yiḍ', 'new project restores the example');
  ok(errors.length === 0, 'no console errors during the desktop session' + (errors.length ? ': ' + errors.join(' | ') : ''));

  if (SHOTS) {
    await page.selectOption('#theme', 'atlas');
    await page.check('input[name=mode][value=roll]');
    await api(page, () => GeneriqueAtelier.seek(13));
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('toast').classList.remove('show'); });
    await sleep(500);
    await page.screenshot({ path: path.join(ROOT, 'screenshots/desktop.png') });
    await page.check('input[name=mode][value=crawl]');
    await api(page, () => GeneriqueAtelier.seek(GeneriqueAtelier.model().duration * 0.3));
    await page.locator('#screen').screenshot({ path: path.join(ROOT, 'screenshots/crawl.png') });
    await page.selectOption('#theme', 'sable');
    await page.check('input[name=mode][value=cards]');
    await api(page, () => GeneriqueAtelier.seek(GeneriqueAtelier.model().duration * (2.5 / GeneriqueAtelier.model().cards)));
    await page.locator('#screen').screenshot({ path: path.join(ROOT, 'screenshots/cards.png') });
  }

  /* ------------------------------------------------ mobile 390 × 844 */
  const errBefore = errors.length;
  const mp = await newPage(390, 844, true);
  await mp.goto(URL0);
  await mp.waitForFunction(() => window.GeneriqueAtelier && GeneriqueAtelier.ready(), null, { timeout: 20000 });
  await mp.evaluate(() => document.fonts.ready); await sleep(300);
  ok(errors.length === errBefore, 'mobile 390×844 loads without console errors');
  const ov = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(ov.sw <= ov.iw, `no horizontal overflow on mobile (${ov.sw} ≤ ${ov.iw})`);
  const box = await mp.locator('#preview').boundingBox();
  ok(box && box.width <= 390 && box.width > 250 && box.y < 300, `preview visible first on mobile (${Math.round(box.width)}×${Math.round(box.height)} at y=${Math.round(box.y)})`);
  await mp.selectOption('#lang', 'en');
  ok((await mp.textContent('#playBtn .play-label')).trim() === 'Play', 'mobile: language switch');
  await mp.tap('#playBtn'); await sleep(600);
  ok((await mp.evaluate(() => GeneriqueAtelier.time())) > 0.2, 'mobile: tap to play');
  await mp.tap('#playBtn');
  const tapTargets = await mp.evaluate(() => [...document.querySelectorAll('.icon-btn, .btn, .play')].filter(b => b.offsetParent).every(b => b.getBoundingClientRect().height >= 28));
  ok(tapTargets, 'mobile: buttons at least 28 px tall');
  await mp.locator('#sections fieldset.section').first().locator('input[data-f="name"]').first().fill('Ameziane');
  ok((await mp.evaluate(() => GeneriqueAtelier.project().sections[0].rows[0].name)) === 'Ameziane', 'mobile: edit a credit');
  await mp.selectOption('#lang', 'fr');
  if (SHOTS) {
    await mp.evaluate(() => GeneriqueAtelier.setProject((() => { const p = GACore.defaultProject(); p.style = GACore.applyTheme(p.style, 'aurore'); p.output.res = 'vertical'; return p; })()));
    await mp.evaluate(() => window.dispatchEvent(new Event('resize')));
    await mp.evaluate(() => { GeneriqueAtelier.seek(7.5); window.scrollTo(0, 0); document.getElementById('toast').classList.remove('show'); });
    await sleep(500);
    await mp.screenshot({ path: path.join(ROOT, 'screenshots/mobile.png') });
  }
  ok(errors.length === errBefore, 'no console errors during the mobile session');

  await browser.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
