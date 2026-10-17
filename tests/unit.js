// Unit tests for js/core.js (pure logic, no DOM). Run: node tests/unit.js
'use strict';
const C = require('../js/core.js');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-6);
// fake text measurement: 0.5 em per character, by kind
const SIZES = { title: 96, subtitle: 36, section: 30, role: 32, name: 44, closing: 72, thanks: 32 };
const measure = (t, kind) => t.length * (SIZES[kind] || 40) * 0.5;

/* ---------- bulk parser */
let s = C.parseBulk('# Image\nCadre : Massinissa\nÉtalonnage: Sami\n\n# Son\nMixage : Kahina');
ok(s.length === 2 && s[0].title === 'Image' && s[0].rows.length === 2 && s[1].title === 'Son', 'parseBulk: # headers make sections');
ok(s[0].rows[0].role === 'Cadre' && s[0].rows[0].name === 'Massinissa' && s[0].rows[1].role === 'Étalonnage' && s[0].rows[1].name === 'Sami', 'parseBulk: "Role : Name" and "Role: Name"');
s = C.parseBulk('Musique\nCompositeur : Idir\n\nA : B\nC : D');
ok(s.length === 2 && s[0].title === 'Musique' && s[0].rows.length === 1 && s[1].title === '' && s[1].rows.length === 2, 'parseBulk: blank line = new section, lone first line = title');
s = C.parseBulk('# Avec\nThiziri Mansouri\nMohand Arezki');
ok(s.length === 1 && s[0].rows.length === 2 && s[0].rows[0].role === '' && s[0].rows[0].name === 'Thiziri Mansouri', 'parseBulk: name-only rows after a title');
s = C.parseBulk('\uFEFFSon\r\nPrise de son\tYanis\r\nMix — Kahina\r\nMontage：Sonia\r\n\r\n\r\n#   Fin  ');
ok(s.length === 2 && s[0].rows.length === 3 && s[0].rows[0].name === 'Yanis' && s[0].rows[1].role === 'Mix' && s[0].rows[1].name === 'Kahina' && s[0].rows[2].name === 'Sonia' && s[1].title === 'Fin',
  'parseBulk: BOM, CRLF, tab, em dash, full-width colon, multiple blank lines');
s = C.parseBulk('Production :\nAtelier Tafat\nRealisation : ياسمين بلقاسم');
ok(s[0].title === 'Production' && s[0].rows[0].name === 'Atelier Tafat' && s[0].rows[1].name === 'ياسمين بلقاسم', 'parseBulk: trailing colon title, Arabic names kept');
ok(C.parseBulk('').length === 0 && C.parseBulk('\n\n  \n').length === 0, 'parseBulk: empty input gives no sections');
ok(C.parseBulk(Array.from({ length: 200 }, (_, i) => '# S' + i).join('\n')).length === C.LIMITS.sections, 'parseBulk: section count capped');

/* ---------- serialize / text */
const demo = C.defaultProject();
const txt = C.serializeSections(demo.sections), back = C.parseBulk(txt);
ok(JSON.stringify(back) === JSON.stringify(demo.sections), 'serializeSections ⇄ parseBulk round-trip');
const pt = C.projectToText(demo);
ok(pt.startsWith('Tafat n Yiḍ\n') && pt.includes('# Image') && pt.includes('Cadre : Massinissa Ouali') && pt.trim().endsWith('Tanemmirt'), 'projectToText: title, sections, closing');

/* ---------- RTL */
ok(C.isRTL('ياسمين بلقاسم') && C.isRTL('  «فاطمة» ') && !C.isRTL('Nadia') && !C.isRTL('ⴰⵎⴰⵣⵉⵖ') && !C.isRTL('123') && !C.isRTL('Ali علي') && C.isRTL('علي Ali'), 'isRTL: first strong character decides (Arabic RTL, Latin/Tifinagh LTR)');

/* ---------- wrap */
const m1 = t => t.length * 10;
ok(JSON.stringify(C.wrap('un deux trois quatre', 110, m1)) === JSON.stringify(['un deux', 'trois', 'quatre']), 'wrap: greedy word wrap');
ok(C.wrap('Supercalifragilistic', 50, m1).length === 1 && C.wrap('', 100, m1).length === 0, 'wrap: long single word kept, empty gives nothing');

/* ---------- validation */
const v = C.validateProject({ sections: [{ title: 'A', rows: [{ role: 1, name: 'X' }, null] }, 'junk'], style: { mode: 'zzz', sizeName: 9999, bg1: 'red', grain: -1, font: 'cinzel' },
  timing: { duration: 0, speed: 'fast', by: 'speed' }, output: { res: '8k', fps: 23 }, closing: { logo: 'javascript:alert(1)' } });
ok(v.sections.length === 1 && v.sections[0].rows.length === 1 && v.sections[0].rows[0].role === '' && v.sections[0].rows[0].name === 'X', 'validate: bad rows / sections dropped, non-strings emptied');
ok(v.style.mode === 'roll' && v.style.sizeName === 160 && v.style.bg1 === demo.style.bg1 && v.style.grain === 0 && v.style.font === 'cinzel', 'validate: enums, clamps, colours');
ok(v.timing.duration === 3 && v.timing.speed === demo.timing.speed && v.timing.by === 'speed' && v.output.res === 'hd' && v.output.fps === 25, 'validate: timing and output');
ok(v.closing.logo === '', 'validate: non data-URL logo rejected');
ok(C.validateProject({ sections: [], closing: { logo: 'data:image/png;base64,iVBORw0KGgo=' } }).closing.logo.startsWith('data:image/png'), 'validate: data-URL PNG logo kept');
let threw = 0; for (const junk of [null, 5, 'x', [], { foo: 1 }]) { try { C.validateProject(junk); } catch (e) { threw++; } }
ok(threw === 5, 'validate: rejects junk');
ok(JSON.stringify(C.validateProject(JSON.parse(JSON.stringify(demo)))) === JSON.stringify(demo), 'validate: default project is a fixed point (JSON round-trip)');

/* ---------- themes / fonts / resolutions */
ok(C.THEMES.length >= 5 && C.THEMES.every(t => t.name.fr && t.name.en && t.name.kab), 'themes named in FR / EN / Taqbaylit');
const th = C.applyTheme(demo.style, 'sable');
ok(th.theme === 'sable' && th.bg1 === C.theme('sable').s.bg1 && th.sizeName === demo.style.sizeName, 'applyTheme: colours replaced, sizes kept');
ok(C.FONTS.some(f => f.id === 'tifinagh') && C.FONTS.some(f => f.id === 'naskh') && C.fontStack('oswald').includes('Noto Naskh Arabic') && C.fontStack('sans').includes('Noto Sans Tifinagh'), 'font stacks include Arabic + Tifinagh fallbacks');
ok(/^700 40px "Cormorant Garamond"/.test(C.fontSpec(700, 40, 'cormorant')), 'fontSpec builds a canvas font shorthand');
const uh = C.unitsFor(3840, 2160), uv = C.unitsFor(1080, 1920), us = C.unitsFor(1920, 804);
ok(uh.u === 2 && uh.h === 1080 && uv.u === 1 && uv.w === 1080 && near(us.h, 1080) && near(us.w, 1920 * 1080 / 804), 'unitsFor: short side = 1080 units');
ok(C.RESOLUTIONS.map(r => r.id).join() === 'hd,scope,vertical,square,uhd' && near(C.resolution('scope').w / C.resolution('scope').h, 2.388, 0.01), 'resolutions incl. 2.39:1 scope');

/* ---------- layout */
let g = C.buildGroups(demo, measure, 1920);
ok(g[0].kind === 'title' && g[g.length - 1].kind === 'closing' && g.filter(x => x.kind === 'section').length === demo.sections.length, 'buildGroups: title + sections + closing');
const rowBlocks = g[1].blocks.filter(b => b.kind !== 'section');
ok(rowBlocks.some(b => b.kind === 'role' && b.align === 'right' && b.x < 0) && rowBlocks.some(b => b.kind === 'name' && b.align === 'left' && b.x > 0), 'two-column: role right-aligned left of centre, name left-aligned right of centre');
const arName = g.flatMap(x => x.blocks).find(b => b.text === 'ياسمين بلقاسم');
ok(arName && arName.rtl === true, 'Arabic name block flagged rtl');
const pr = C.clone(demo); pr.sections = [{ title: 'التصوير', rows: [{ role: 'مدير التصوير', name: 'نادية فرحات' }] }];
const ga = C.buildGroups(pr, measure, 1920).find(x => x.kind === 'section').blocks;
ok(ga.find(b => b.kind === 'role').align === 'left' && ga.find(b => b.kind === 'role').x > 0 && ga.find(b => b.kind === 'name').x < 0, 'Arabic role mirrors the columns (role on the right)');
const up = C.clone(demo); up.style.upperSections = true;
ok(C.buildGroups(up, measure, 1920)[1].blocks[0].text === 'RÉALISATION', 'uppercase section titles (French accents kept)');
const nm = C.clone(demo); nm.style.layout = 'names';
ok(!C.buildGroups(nm, measure, 1920).some(x => x.blocks.some(b => b.kind === 'role')), 'names-only layout drops roles');
const stk = C.clone(demo); stk.style.layout = 'stack';
ok(C.buildGroups(stk, measure, 1920).every(x => x.blocks.every(b => b.kind === 'logo' || b.align === 'center')), 'stacked layout is centred');
const emp = C.clone(demo); emp.sections.push({ title: '', rows: [{ role: ' ', name: '' }] }); emp.title.show = false; emp.closing.show = false;
const ge = C.buildGroups(emp, measure, 1920);
ok(ge.length === demo.sections.length && ge.every(x => x.kind === 'section'), 'empty sections, hidden title / closing skipped');
const narrow = C.clone(demo); narrow.sections = [{ title: '', rows: [{ role: 'R', name: 'Un nom vraiment très long qui ne tient pas sur une ligne' }] }];
const gn = C.buildGroups(narrow, measure, 1080).find(x => x.kind === 'section');
ok(gn.blocks.filter(b => b.kind === 'name').length > 1, 'long names wrap inside their column');

/* ---------- stack / cards */
const st = C.stack(g, demo.style);
ok(st.height > 0 && st.closingCenter > st.height / 2 && st.closingCenter < st.height && st.blocks.every((b, i, a) => i === 0 || b.y >= a[i - 1].y - 200), 'stack: positive height, closing anchor near the end');
const cards = C.buildCards(g, 300);
ok(cards.length > g.length && cards.every(c => c.h <= 300 + 1e-6 || c.blocks.filter(b => b.kind !== 'section').length <= 2), 'buildCards: long sections split to fit');
ok(cards.filter(c => c.cont).every(c => c.blocks[0].kind === 'section'), 'continued cards repeat the section header');
const allRows = g.filter(x => x.kind === 'section').reduce((a, x) => a + x.blocks.filter(b => b.kind === 'name').length, 0);
ok(cards.reduce((a, c) => a + c.blocks.filter(b => b.kind === 'name').length, 0) === allRows, 'buildCards: no name lost or duplicated');

/* ---------- timing */
const T = { by: 'duration', duration: 60, speed: 100, stopOnEnd: true, hold: 4, fade: 1 };
let rm = C.rollMetrics(2000, 1900, 1080, T);
ok(near(rm.duration, 60) && near(rm.travel, 540 + 1900) && near(rm.speed, 2440 / 56), 'roll by duration: travel to centred closing card, speed = travel / (duration − hold)');
rm = C.rollMetrics(2000, 1900, 1080, Object.assign({}, T, { by: 'speed', speed: 122 }));
ok(near(rm.duration, 2440 / 122 + 4) && near(rm.scroll, 20), 'roll by speed: duration = travel / speed + hold');
rm = C.rollMetrics(2000, 1900, 1080, Object.assign({}, T, { stopOnEnd: false }));
ok(near(rm.travel, 3080) && near(rm.duration, 60) && rm.hold === 0, 'roll without stop: everything scrolls out');
ok(C.rollOffset(-1, rm) === 0 && near(C.rollOffset(10, rm), 10 * rm.speed) && C.rollOffset(1e6, rm) === rm.travel, 'rollOffset clamped to [0, travel]');
ok(C.rollMetrics(2000, null, 1080, T).hold === 0, 'no closing card: no hold');
const cm = C.crawlMetrics(2000, 1920, 1080, T), cg = cm.geom;
ok(near(cm.duration, 60) && cm.travel > 2000 && near(cm.speed * cm.duration, cm.travel), 'crawl metrics consistent');
const p0 = C.crawlProject(0, cg), p1 = C.crawlProject(500, cg), p2 = C.crawlProject(5000, cg);
ok(near(p0.scale, 1) && near(p0.y, cg.bottom) && p1.scale < 1 && p2.scale < p1.scale && p2.y < p1.y && p2.y > cg.horizon && p2.squash < p1.squash, 'crawl projection shrinks and rises toward the horizon');
const k = C.cardMetrics(10, { duration: 30, fade: 1 });
ok(near(k.per, 3) && k.fade === 1, 'cardMetrics: equal share');
ok(C.cardAt(0, 10, k).alpha === 0 && near(C.cardAt(1.5, 10, k).alpha, 1) && C.cardAt(4.5, 10, k).index === 1 && near(C.cardAt(2.5, 10, k).alpha, 0.5), 'cardAt: index and fade in / out');
ok(C.cardAt(1e9, 10, k).index === 9 && C.cardAt(1, 0, k).index === -1, 'cardAt: clamped, empty list');
ok(C.cardMetrics(4, { duration: 2, fade: 3 }).fade <= 0.5 / 2.5 * 1.0001 + 0.0001, 'card fade never longer than a card allows');
ok(C.fadeInOut(0, 10, 1, 1) === 0 && C.fadeInOut(5, 10, 1, 1) === 1 && near(C.fadeInOut(9.5, 10, 1, 1), 0.5) && C.fadeInOut(3, 10, 0, 0) === 1, 'fadeInOut');

/* ---------- misc */
ok(C.formatTime(0) === '00:00.0' && C.formatTime(75.25) === '01:15.3' && C.formatTime(-3) === '00:00.0', 'formatTime');
ok(C.fileName(demo, 'webm') === 'generique-tafat-n-yid.webm' && C.fileName({ title: { title: 'ياسمين' } }, 'png', 'x') === 'generique-generique-x.png', 'file names are ASCII slugs');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
