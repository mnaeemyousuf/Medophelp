// Generates the Medophelp logo set (SVG with outlined text, PNG, ICO) from one definition.
// Output: branding/logo/ (master set) and the copies the web client serves from client/public/.
// Usage: node tools/brand/build-brand.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const requireManuals = createRequire(path.join(root, 'tools/manuals/package.json'));
const puppeteer = requireManuals('puppeteer-core');

// Brand values — keep in sync with shared/src/brand.ts (checked at the end of this script).
const C = { blue: '#1A56DB', navy: '#0B1F44', teal: '#0EA5A4', slate: '#475569', white: '#FFFFFF', mist: '#C7D6F5' };
const NAME = 'Medophelp';
const TAGLINE = 'Smarter Healthcare. Seamless Operations.';

const fontDir = path.join(here, 'node_modules/@fontsource/plus-jakarta-sans/files');
const font = (w) => opentype.loadSync(path.join(fontDir, `plus-jakarta-sans-latin-${w}-normal.woff`));
const heavy = font(800);
const medium = font(500);

const OUT = path.join(root, 'branding/logo');
const PUB = path.join(root, 'client/public');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(PUB, 'brand'), { recursive: true });

/**
 * The mark: a rounded square in a blue→teal gradient carrying a white heartbeat line that draws
 * the letter M, with a small medical cross in the upper right. 64×64 units.
 */
function mark({ id = 'mpg', x = 0, y = 0, size = 64, reversed = false } = {}) {
  const s = size / 64;
  const bg = reversed ? C.white : `url(#${id})`;
  const fg = reversed ? C.blue : C.white;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.blue}"/><stop offset="1" stop-color="${C.teal}"/></linearGradient></defs>
    <rect width="64" height="64" rx="16" fill="${bg}"/>
    <polyline points="10,41 19,41 24.5,23 32,39 39.5,23 45,41 54,41" fill="none" stroke="${fg}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M48.5 9.5h3v4h4v3h-4v4h-3v-4h-4v-3h4z" fill="${fg}"/>
  </g>`;
}

const textPath = (f, text, x, y, size, fill) => {
  const p = f.getPath(text, x, y, size);
  const bb = p.getBoundingBox();
  return { d: p.toPathData(2), bb, svg: `<path d="${p.toPathData(2)}" fill="${fill}"/>` };
};

function horizontal({ reversed = false, tagline = true } = {}) {
  const word = textPath(heavy, NAME, 82, tagline ? 37 : 45, 38, reversed ? C.white : C.navy);
  const tag = tagline ? textPath(medium, TAGLINE, 83.5, 57, 12.2, reversed ? C.mist : C.slate) : null;
  const w = Math.ceil(Math.max(word.bb.x2, tag?.bb.x2 ?? 0) + 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 64" width="${w}" height="64" role="img" aria-label="${NAME}${tagline ? ` — ${TAGLINE}` : ''}"><title>${NAME}</title>${mark({ id: reversed ? 'mpgR' : 'mpg' })}${word.svg}${tag?.svg ?? ''}</svg>`;
}

function stacked({ reversed = false } = {}) {
  const W = 360;
  const word0 = heavy.getPath(NAME, 0, 0, 48).getBoundingBox();
  const tag0 = medium.getPath(TAGLINE, 0, 0, 15).getBoundingBox();
  const word = textPath(heavy, NAME, (W - (word0.x2 - word0.x1)) / 2 - word0.x1, 170, 48, reversed ? C.white : C.navy);
  const tag = textPath(medium, TAGLINE, (W - (tag0.x2 - tag0.x1)) / 2 - tag0.x1, 200, 15, reversed ? C.mist : C.slate);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 216" width="${W}" height="216" role="img" aria-label="${NAME} — ${TAGLINE}"><title>${NAME}</title>${mark({ id: reversed ? 'mpgSR' : 'mpgS', x: (W - 104) / 2, y: 8, size: 104 })}${word.svg}${tag.svg}</svg>`;
}

const markSvg = (reversed = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${NAME}"><title>${NAME}</title>${mark({ reversed })}</svg>`;

const svgs = {
  'medophelp-mark.svg': markSvg(),
  'medophelp-mark-reversed.svg': markSvg(true),
  'medophelp-logo.svg': horizontal(),
  'medophelp-logo-reversed.svg': horizontal({ reversed: true }),
  'medophelp-wordmark.svg': horizontal({ tagline: false }),
  'medophelp-wordmark-reversed.svg': horizontal({ reversed: true, tagline: false }),
  'medophelp-logo-stacked.svg': stacked(),
  'medophelp-logo-stacked-reversed.svg': stacked({ reversed: true }),
};
for (const [f, s] of Object.entries(svgs)) fs.writeFileSync(path.join(OUT, f), s);

// ── PNG rendering ────────────────────────────────────────────────────────
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const browser = await puppeteer.launch({ executablePath: BROWSERS.find((b) => fs.existsSync(b)), headless: true });
const page = await browser.newPage();
async function png(svg, file, width, { background } = {}) {
  const [, vw, vh] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const height = Math.round((width * Number(vh)) / Number(vw));
  const sized = svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${width}" height="${height}"`);
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:${background ?? 'transparent'}">${sized}</body></html>`);
  await page.screenshot({ path: file, omitBackground: !background, clip: { x: 0, y: 0, width, height } });
}
const pngs = [
  ['medophelp-mark.svg', 'medophelp-mark-512.png', 512],
  ['medophelp-mark.svg', 'medophelp-mark-192.png', 192],
  ['medophelp-mark.svg', 'medophelp-mark-180.png', 180],
  ['medophelp-mark.svg', 'medophelp-mark-48.png', 48],
  ['medophelp-mark.svg', 'medophelp-mark-32.png', 32],
  ['medophelp-mark.svg', 'medophelp-mark-16.png', 16],
  ['medophelp-mark-reversed.svg', 'medophelp-mark-reversed-512.png', 512],
  ['medophelp-logo.svg', 'medophelp-logo-1200.png', 1200],
  ['medophelp-logo.svg', 'medophelp-logo-600.png', 600],
  ['medophelp-logo-reversed.svg', 'medophelp-logo-reversed-1200.png', 1200],
  ['medophelp-wordmark.svg', 'medophelp-wordmark-800.png', 800],
  ['medophelp-logo-stacked.svg', 'medophelp-logo-stacked-1080.png', 1080],
  ['medophelp-logo-stacked-reversed.svg', 'medophelp-logo-stacked-reversed-1080.png', 1080],
];
for (const [src, out, w] of pngs) await png(svgs[src], path.join(OUT, out), w);
// Social / app preview on brand navy.
await png(svgs['medophelp-logo-stacked-reversed.svg'], path.join(OUT, 'medophelp-social-1080-navy.png'), 1080, { background: C.navy });
await browser.close();

// ── favicon.ico (PNG-in-ICO, 16/32/48) ───────────────────────────────────
const icoImages = [16, 32, 48].map((n) => fs.readFileSync(path.join(OUT, `medophelp-mark-${n}.png`)));
const header = Buffer.alloc(6 + 16 * icoImages.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoImages.length, 4);
let offset = header.length;
icoImages.forEach((img, i) => {
  const n = [16, 32, 48][i];
  const e = 6 + i * 16;
  header.writeUInt8(n, e); header.writeUInt8(n, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6); header.writeUInt32LE(img.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
fs.writeFileSync(path.join(OUT, 'favicon.ico'), Buffer.concat([header, ...icoImages]));

// ── Copies served by the web app ─────────────────────────────────────────
const copy = (from, to) => fs.copyFileSync(path.join(OUT, from), path.join(PUB, to));
copy('medophelp-mark.svg', 'favicon.svg');
copy('favicon.ico', 'favicon.ico');
copy('medophelp-mark-180.png', 'apple-touch-icon.png');
copy('medophelp-mark-192.png', 'brand/medophelp-mark-192.png');
copy('medophelp-mark-512.png', 'brand/medophelp-mark-512.png');
for (const f of ['medophelp-mark.svg', 'medophelp-logo.svg', 'medophelp-logo-reversed.svg', 'medophelp-wordmark.svg', 'medophelp-wordmark-reversed.svg']) copy(f, `brand/${f}`);
fs.writeFileSync(path.join(PUB, 'site.webmanifest'), JSON.stringify({
  name: `${NAME} — ${TAGLINE}`, short_name: NAME, start_url: '/', display: 'standalone', background_color: '#F6F8FB', theme_color: C.navy,
  icons: [{ src: '/brand/medophelp-mark-192.png', sizes: '192x192', type: 'image/png' }, { src: '/brand/medophelp-mark-512.png', sizes: '512x512', type: 'image/png' }],
}, null, 2));

// Guard against drift from the shared brand module.
const shared = fs.readFileSync(path.join(root, 'shared/src/brand.ts'), 'utf8');
for (const v of [NAME, TAGLINE, C.blue, C.navy, C.teal, C.slate]) if (!shared.includes(v)) throw new Error(`brand value ${v} not found in shared/src/brand.ts`);
console.log(`Wrote ${Object.keys(svgs).length} SVG, ${pngs.length + 1} PNG and favicon.ico to branding/logo; web copies in client/public.`);
