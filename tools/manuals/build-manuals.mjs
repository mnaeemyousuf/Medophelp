// Builds one A4 PDF user manual per role from content/*.mjs, real screenshots in
// deliverables/user_manuals/assets and the role data exported by export-roles.ts.
// TOC page numbers are filled in a second pass by locating each heading in the first-pass PDF.
// Usage: node build-manuals.mjs [roleNumber]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ROLES } from './content/roles.mjs';
import { FEATURES } from './content/features.mjs';
import * as C from './content/common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'deliverables/user_manuals');
const ASSETS = path.join(OUT, 'assets');
const BUILD = path.join(here, 'build');
const roleData = JSON.parse(fs.readFileSync(path.join(BUILD, 'roles.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const TODAY = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Medophelp brand (values from shared/src/brand.ts; logo files from tools/brand/build-brand.mjs).
const B = { blue: '#1A56DB', navy: '#0B1F44', teal: '#0EA5A4', slate: '#475569', soft: '#E0EAFF', line: '#E2E8F0', tint: '#F1F5F9' };
{
  const shared = fs.readFileSync(path.join(root, 'shared/src/brand.ts'), 'utf8');
  for (const v of [C.PRODUCT, C.TAGLINE, ...Object.values(B)]) if (!shared.includes(v)) throw new Error(`Brand value ${v} is not in shared/src/brand.ts`);
}
const LOGO = path.join(root, 'branding/logo');
const svgInline = (file, id) => fs.readFileSync(path.join(LOGO, file), 'utf8').replace(/id="(\w+)"/g, `id="$1${id}"`).replace(/url\(#(\w+)\)/g, `url(#$1${id})`);
const fontFile = (pkg, file) => pathToFileURL(path.join(root, 'tools/brand/node_modules/@fontsource', pkg, 'files', file)).href;
const FONTS = [
  ['Plus Jakarta Sans', 700, fontFile('plus-jakarta-sans', 'plus-jakarta-sans-latin-700-normal.woff2')],
  ['Plus Jakarta Sans', 800, fontFile('plus-jakarta-sans', 'plus-jakarta-sans-latin-800-normal.woff2')],
  ['Inter', 400, fontFile('inter', 'inter-latin-400-normal.woff2')],
  ['Inter', 600, fontFile('inter', 'inter-latin-600-normal.woff2')],
].map(([f, w, u]) => `@font-face { font-family: '${f}'; font-weight: ${w}; src: url('${u}') format('woff2'); }`).join('\n');

const CSS = `
${FONTS}
@page { size: A4; margin: 22mm 18mm 20mm 18mm; }
* { box-sizing: border-box; }
body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; font-size: 9.6pt; line-height: 1.5; color: ${B.navy}; margin: 0; }
h1, h2, h3, .display { font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; word-spacing: 0.06em; }
h1 { font-size: 18pt; font-weight: 800; color: ${B.navy}; margin: 0 0 4mm; padding-bottom: 2.2mm; border-bottom: 2.5px solid transparent; border-image: linear-gradient(90deg, ${B.blue}, ${B.teal}) 1; break-after: avoid; }
h2 { font-size: 13pt; font-weight: 700; color: ${B.blue}; margin: 7mm 0 2mm; break-after: avoid; }
h3 { font-size: 10.5pt; font-weight: 700; margin: 4mm 0 1.5mm; color: ${B.navy}; break-after: avoid; }
.chapter { break-before: page; }
p { margin: 0 0 2mm; }
ol, ul { margin: 0 0 2mm; padding-left: 6mm; }
li { margin-bottom: 1mm; }
table { border-collapse: collapse; width: 100%; margin: 1mm 0 3mm; table-layout: fixed; word-wrap: break-word; }
th, td { border: 1px solid ${B.line}; padding: 1.5mm 2mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: ${B.tint}; font-weight: 600; color: ${B.navy}; }
table.kv th { width: 34mm; }
tr { break-inside: avoid; }
figure { margin: 3mm 0 4mm; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; max-height: 125mm; border: 1px solid ${B.line}; border-radius: 1.5mm; object-fit: contain; }
figure img.mobile { max-height: 140mm; max-width: 70mm; }
figcaption { font-size: 8.5pt; color: ${B.slate}; margin-top: 1.5mm; }
.callout { border-left: 3px solid #d97706; background: #fffbeb; padding: 2mm 3mm; margin: 2mm 0 3mm; break-inside: avoid; }
.note { border-left: 3px solid ${B.blue}; background: ${B.soft}; padding: 2mm 3mm; margin: 2mm 0 3mm; break-inside: avoid; }
.muted { color: ${B.slate}; }
code { font-family: Consolas, monospace; font-size: 8.6pt; color: ${B.navy}; background: ${B.tint}; padding: 0 1mm; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: space-between; }
.cover .panel { position: relative; overflow: hidden; border-radius: 5mm; padding: 14mm 12mm 16mm; color: #fff; background: linear-gradient(135deg, ${B.navy} 0%, #13306b 58%, ${B.blue} 100%); }
.cover .panel::after { content: ''; position: absolute; right: -30mm; top: -30mm; width: 90mm; height: 90mm; border-radius: 50%; background: radial-gradient(circle, rgba(14,165,164,.45), rgba(14,165,164,0) 70%); }
.cover .panel svg { position: relative; z-index: 1; width: 112mm; height: auto; display: block; }
.cover .kicker { position: relative; z-index: 1; margin-top: 22mm; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 9pt; letter-spacing: .22em; text-transform: uppercase; color: rgba(255,255,255,.75); }
.cover h1 { position: relative; z-index: 1; font-size: 32pt; color: #fff; border: 0; padding: 0; margin: 2mm 0 1mm; }
.cover .role { position: relative; z-index: 1; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 18pt; color: #C7D6F5; }
.cover .meta { margin-top: 10mm; }
.cover table { width: 125mm; }
.cover .tagline { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; color: ${B.blue}; font-size: 11pt; margin-bottom: 2mm; }
.toc { list-style: none; padding: 0; }
.toc li { display: flex; align-items: baseline; margin: 0 0 1.2mm; }
.toc li.l2 { padding-left: 7mm; font-size: 9.5pt; }
.toc li .t { flex: 0 1 auto; }
.toc li .dots { flex: 1 1 auto; border-bottom: 1px dotted #94a3b8; margin: 0 2mm; transform: translateY(-1mm); }
.toc li .p { flex: 0 0 auto; min-width: 8mm; text-align: right; font-variant-numeric: tabular-nums; }
.feature { break-before: auto; }
`;

function figureHtml(state, key, caption) {
  const m = manifest[key];
  const file = path.join(ASSETS, `${key}.png`);
  if (!m || !fs.existsSync(file)) {
    state.missing.push(key);
    return `<div class="callout">Screenshot “${esc(key)}” was not captured; see the screenshot README for the reason.</div>`;
  }
  state.fig += 1;
  state.figures.push(key);
  const mobile = key.includes('mobile');
  return `<figure><img class="${mobile ? 'mobile' : ''}" src="${pathToFileURL(file).href}" alt="${esc(caption)}"><figcaption>Figure ${state.chapter}.${state.fig} — ${esc(caption)}</figcaption></figure>`;
}

function featureHtml(state, f, num) {
  const list = (a, empty) => (a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`);
  const id = `s${num.replace(/\./g, '-')}`;
  state.toc.push({ level: 2, num, title: f.name, id });
  return `<section class="feature">
  <h2 id="${id}">${num} ${esc(f.name)}</h2>
  <table class="kv">
    <tr><th>Feature</th><td>${esc(f.name)}</td></tr>
    <tr><th>Purpose</th><td>${esc(f.purpose)}</td></tr>
    <tr><th>Who can use it</th><td>${esc(f.permission)}</td></tr>
    <tr><th>Before you start</th><td>${esc(f.prereq)}</td></tr>
    <tr><th>Where to find it</th><td>${esc(f.nav)}</td></tr>
  </table>
  <h3>Steps</h3><ol>${f.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
  ${figureHtml(state, f.shot[0], f.shot[1])}
  ${(f.extraShots ?? []).map(([k, c]) => figureHtml(state, k, c)).join('')}
  <h3>Fields</h3>${f.fields.length ? `<table><tr><th style="width:42mm">Field</th><th>Meaning / rules</th></tr>${f.fields.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>` : '<p class="muted">No data entry on this screen.</p>'}
  <h3>Example (synthetic data)</h3><p>${esc(f.example)}</p>
  <h3>Expected result</h3><p>${esc(f.result === '—' ? 'The information is displayed; nothing is changed.' : f.result)}</p>
  <h3>Validation rules</h3>${list(f.validation.map((v) => `“${v}”`), 'No feature-specific validation messages.')}
  <h3>Common errors</h3>${f.errors.length ? `<table><tr><th style="width:70mm">Message shown</th><th>What it means / what to do</th></tr>${f.errors.map(([a, b]) => `<tr><td>“${esc(a)}”</td><td>${esc(b || 'Follow the message; the action was refused and nothing was changed.')}</td></tr>`).join('')}</table>` : '<p class="muted">No feature-specific error messages.</p>'}
  <h3>Warnings</h3>${f.warnings.length ? `<div class="callout">${f.warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : '<p class="muted">None specific to this feature.</p>'}
  <h3>Next steps</h3>${list(f.next, 'Continue with the next task in your workflow (see the Workflows chapter).')}
</section>`;
}

function chapter(state, title, body) {
  state.chapter += 1;
  state.fig = 0;
  const id = `c${state.chapter}`;
  state.toc.push({ level: 1, num: `${state.chapter}`, title, id });
  return `<section class="chapter"><h1 id="${id}">${state.chapter}. ${esc(title)}</h1>${typeof body === 'function' ? body() : body}</section>`;
}

function buildHtml(r, pages) {
  const data = roleData.roles.find((x) => x.role === r.role);
  if (!data) throw new Error(`role ${r.role} missing from roles.json`);
  const state = { chapter: 0, fig: 0, toc: [], figures: [], missing: [] };
  const sub = (i) => `${state.chapter}.${i}`;
  const parts = [];

  parts.push(chapter(state, 'Introduction', () => `
    <p>${esc(r.intro)}</p>
    ${r.combined ? `<div class="note"><b>How this role is set up in the system.</b> ${esc(r.combined)}</div>` : ''}
    <h2>Menus available to this role</h2>
    <table><tr><th style="width:45mm">Section</th><th>Menu items</th></tr>${data.menus.map((m) => `<tr><td>${esc(m.section)}</td><td>${m.items.map((i) => esc(i.label)).join(', ')}</td></tr>`).join('')}</table>
    ${r.patient ? '' : `<h2>Permissions held by default</h2><table><tr><th style="width:45mm">Permission</th><th>Allows</th></tr>${data.permissions.map((p) => `<tr><td><code>${esc(p.key)}</code></td><td>${esc(p.description)}</td></tr>`).join('')}</table>
    <p class="muted">Administrators can change role permissions at runtime (Roles & permissions). If your screens differ from this manual, your hospital may have customised your role.</p>`}
    ${r.restrictions ? `<h2>What this role cannot do</h2><p>${esc(r.restrictions)}</p>` : ''}
    <h2>Reports available</h2>${data.reports.length ? `<p>${data.reports.map((x) => esc(x.title)).join(' · ')}</p>` : '<p class="muted">None.</p>'}
    <h2>About this manual</h2>
    <p>Screens in this manual are real screenshots of the Medophelp demonstration build, captured with synthetic (made-up) data. Names, CNICs and phone numbers shown are not real people. Error messages are quoted exactly as the system shows them.</p>`));

  parts.push(chapter(state, 'Signing in and first-time setup', () => {
    const feats = r.patient ? [C.login, C.firstTime] : [C.login, C.firstTime, C.forgot];
    const login = { ...C.login, example: `Email: ${r.account} (demonstration account — development environment only; the password is in the deployment guide, never in this manual).` };
    feats[0] = login;
    return feats.map((f, i) => featureHtml(state, f, sub(i + 1))).join('') + `<h2>Signing out</h2><ul>${C.signOut.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
  }));

  parts.push(chapter(state, 'Your dashboard', () => `
    <p>${esc(r.dashboard[1])}</p>
    ${figureHtml(state, r.dashboard[0], `${r.role} dashboard`)}
    <h2>Finding your way around</h2>
    <ul><li>The left sidebar shows only the menus your role can use, grouped by section. On a phone, use the menu button (top left) or the bottom bar.</li>
    <li>The search box at the top (Ctrl K) finds records you are allowed to see.</li>
    <li>The bell shows notifications; the moon/sun icon switches dark and light mode.</li>
    <li>Your name and role are at the top right; click to change password or sign out.</li>
    <li>Click a dashboard card to open the related list.</li></ul>`));

  for (const [title, keys] of r.modules) {
    parts.push(chapter(state, title, () => keys.map((k, i) => {
      if (!FEATURES[k]) throw new Error(`feature ${k} missing`);
      return featureHtml(state, FEATURES[k], sub(i + 1));
    }).join('') + (r.extraShots && title === 'Reports' ? r.extraShots.map(([k, c]) => figureHtml(state, k, c)).join('') : '')));
  }

  parts.push(chapter(state, r.patient ? 'Notifications' : 'My workspace, notifications and search', () =>
    (r.patient ? [C.notifications] : [C.myWorkspace, C.notifications, C.search]).map((f, i) => featureHtml(state, f, sub(i + 1))).join('')));

  parts.push(chapter(state, 'Workflows', () => r.workflows.map(([t, steps], i) => {
    const num = sub(i + 1);
    state.toc.push({ level: 2, num, title: t, id: `w${num.replace('.', '-')}` });
    return `<h2 id="w${num.replace('.', '-')}">${num} ${esc(t)}</h2><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  }).join('')));

  parts.push(chapter(state, 'Troubleshooting', () => {
    const rows = [...C.commonTroubleshooting, ...(r.extraTrouble ?? [])];
    return `<p>Each row says whether the guidance was verified against this build. Unverified rows are general guidance.</p>
    <table><tr><th style="width:42mm">Problem</th><th style="width:42mm">Likely cause</th><th>What to do</th><th style="width:20mm">Verified</th></tr>${rows.map(([a, b, c, v]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td><td>${v ? 'Yes' : 'Unverified'}</td></tr>`).join('')}</table>
    <p>Feature-specific messages and their meaning are listed under “Common errors” in each feature section.</p>`;
  }));

  parts.push(chapter(state, 'Best practices and security', () => `<ul>${(r.patient
    ? ['Keep your password private and change it if you think someone knows it.', 'Sign out on shared or public computers.', 'The hospital will never ask for your password by phone or SMS.', 'Use the portal for information only; for urgent symptoms contact the hospital or emergency services.']
    : C.bestPracticesCommon).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="note">This system supports good practice (role-based access, audit trail, two-person approvals) but using it does not by itself make a hospital compliant with any law or regulation. Follow your hospital’s policies.</div>`));

  parts.push(chapter(state, 'Glossary', () => `<table><tr><th style="width:40mm">Term</th><th>Meaning</th></tr>${C.glossaryCommon.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>`));

  parts.push(chapter(state, 'Support', () => `
    <table class="kv"><tr><th>Support contact</th><td>[To be provided by the hospital — not configured in this demonstration build]</td></tr>
    <tr><th>Support hours</th><td>[To be provided by the hospital]</td></tr>
    <tr><th>How to report a problem</th><td>Note the date and time, the screen, what you did and the exact message, then contact your administrator. Do not send screenshots that contain real patient data by email.</td></tr></table>`));

  const tocHtml = `<section class="chapter"><h1>Contents</h1><ul class="toc">${state.toc.map((t) => `<li class="l${t.level}"><span class="t">${t.level === 1 ? `<b>${t.num}. ${esc(t.title)}</b>` : `${t.num} ${esc(t.title)}`}</span><span class="dots"></span><span class="p">${pages ? pages[t.id] ?? '?' : '00'}</span></li>`).join('')}</ul></section>`;

  const cover = `<section class="cover">
    <div class="panel">
      ${svgInline('medophelp-logo-reversed.svg', 'cv')}
      <div class="kicker">${esc(C.PRODUCT)} user guide</div>
      <h1>User Manual</h1>
      <div class="role">${esc(r.role === 'Patient' ? 'Patient Portal' : r.role)}${r.n === 8 ? ' (Inventory & Procurement)' : ''}${r.n === 14 ? ' (Reporting)' : ''}</div>
    </div>
    <div class="meta">
      <p class="tagline">${esc(C.TAGLINE)}</p>
      <table class="kv"><tr><th>Product</th><td>${esc(C.PRODUCT)}</td></tr><tr><th>Role</th><td>${esc(r.role)}</td></tr><tr><th>Software version</th><td>${esc(C.VERSION)}</td></tr><tr><th>Manual date</th><td>${TODAY}</td></tr><tr><th>Document</th><td>${esc(r.file)}.pdf</td></tr></table>
    </div>
    <p class="muted">Screenshots show synthetic demonstration data only. This manual describes the demonstration build; it is not a certification of regulatory compliance or clinical safety.</p>
  </section>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.file)}</title><style>${CSS}</style></head><body>${cover}${tocHtml}${parts.join('')}</body></html>`;
  return { html, state };
}

async function pdfText(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
  const pages = [];
  let images = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    pages.push(tc.items.map((x) => x.str).join(' ').replace(/\s+/g, ' '));
    const ops = await p.getOperatorList();
    images += ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length;
  }
  return { numPages: doc.numPages, pages, images };
}

const norm = (s) => s.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

function locate(toc, pages) {
  const found = {};
  const start = pages.findIndex((t, i) => i > 0 && t.includes('Contents')) + 1; // skip cover + TOC pages
  for (const t of toc) {
    const needle = norm(t.level === 1 ? `${t.num}. ${t.title}` : `${t.num} ${t.title}`);
    let idx = -1;
    for (let i = start; i < pages.length; i++) {
      if (norm(pages[i]).includes(needle) && !norm(pages[i]).startsWith('Contents')) { idx = i; break; }
    }
    found[t.id] = idx >= 0 ? idx + 1 : undefined;
  }
  return found;
}

async function render(browser, r, pages) {
  const { html, state } = buildHtml(r, pages);
  const htmlFile = path.join(BUILD, `${r.file}.html`);
  fs.writeFileSync(htmlFile, html);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle0' });
  // Overflow check: nothing may stick out beyond the printable width.
  const overflow = await page.evaluate(() => {
    const w = document.body.clientWidth;
    return [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1).map((e) => e.tagName + (e.className ? '.' + e.className : '')).slice(0, 5);
  });
  const pdfFile = path.join(OUT, `${r.file}.pdf`);
  const title = r.role === 'Patient' ? 'Patient Portal' : r.role;
  await page.pdf({
    path: pdfFile, format: 'A4', printBackground: true, displayHeaderFooter: true,
    margin: { top: '22mm', bottom: '20mm', left: '18mm', right: '18mm' },
    // Header/footer templates render in their own context: inline SVG, system font stack, explicit colours.
    headerTemplate: `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:7.5pt;color:${B.slate};width:100%;padding:0 18mm;display:flex;justify-content:space-between;align-items:center"><span style="display:flex;align-items:center;gap:5px;color:${B.navy};font-weight:700">${svgInline('medophelp-mark.svg', 'hd').replace('width="64" height="64"', 'width="13" height="13"')}${esc(C.PRODUCT)}</span><span>${esc(title)} User Manual</span></div>`,
    footerTemplate: `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:7.5pt;color:${B.slate};width:100%;padding:0 18mm;display:flex;justify-content:space-between"><span>${esc(C.PRODUCT)} — ${esc(C.TAGLINE)}  &nbsp;|&nbsp; Version ${esc(C.VERSION)} · ${TODAY}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    outline: true, tagged: true,
  });
  await page.close();
  return { pdfFile, state, overflow };
}

const browser = await puppeteer.launch({ executablePath: BROWSERS.find((b) => fs.existsSync(b)), headless: true, args: ['--allow-file-access-from-files'] });
const only = process.argv[2] ? Number(process.argv[2]) : null;
const report = [];
for (const r of ROLES) {
  if (only && r.n !== only) continue;
  let pass = await render(browser, r, null);
  let text = await pdfText(pass.pdfFile);
  let pages = locate(pass.state.toc, text.pages);
  pass = await render(browser, r, pages);
  text = await pdfText(pass.pdfFile);
  const check = locate(pass.state.toc, text.pages);
  const tocMismatch = pass.state.toc.filter((t) => check[t.id] !== pages[t.id] || !pages[t.id]).map((t) => `${t.num} ${t.title}: toc ${pages[t.id]} actual ${check[t.id]}`);
  const emptyPages = text.pages.map((t, i) => (t.trim().length < 20 ? i + 1 : null)).filter(Boolean);
  const res = {
    file: path.relative(root, pass.pdfFile).replace(/\\/g, '/'), role: r.role, pages: text.numPages,
    bytes: fs.statSync(pass.pdfFile).size, figures: pass.state.figures.length, imagesInPdf: text.images,
    textChars: text.pages.join('').length, tocEntries: pass.state.toc.length, tocMismatch, emptyPages,
    missingScreenshots: pass.state.missing, overflow: pass.overflow,
  };
  res.ok = res.pages > 5 && res.textChars > 5000 && res.imagesInPdf >= res.figures && !tocMismatch.length && !emptyPages.length && !res.missingScreenshots.length && !res.overflow.length;
  report.push(res);
  console.log(`${res.ok ? '✓' : '✗'} ${res.file} — ${res.pages} pages, ${res.figures} figures (${res.imagesInPdf} images), TOC ${res.tocEntries} entries${tocMismatch.length ? `, TOC mismatches: ${tocMismatch.join('; ')}` : ''}${emptyPages.length ? `, empty pages ${emptyPages}` : ''}${res.missingScreenshots.length ? `, missing ${res.missingScreenshots}` : ''}${res.overflow.length ? `, overflow ${res.overflow}` : ''}`);
}
await browser.close();
const prev = fs.existsSync(path.join(BUILD, 'validation.json')) ? JSON.parse(fs.readFileSync(path.join(BUILD, 'validation.json'), 'utf8')) : [];
const merged = [...prev.filter((p) => !report.some((x) => x.file === p.file)), ...report].sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(path.join(BUILD, 'validation.json'), JSON.stringify(merged, null, 2));
