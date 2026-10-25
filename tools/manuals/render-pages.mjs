// Renders selected PDF pages to PNG with pdf.js inside the browser, for visual validation.
// Usage: node render-pages.mjs <pdf> <outDir> 1,2,5
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const [pdf, outDir, list] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const browser = await puppeteer.launch({ executablePath: BROWSERS.find((b) => fs.existsSync(b)), headless: true, args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
const lib = pathToFileURL(path.join(here, 'node_modules/pdfjs-dist/build/pdf.mjs')).href;
const worker = pathToFileURL(path.join(here, 'node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;
const htmlFile = path.join(here, 'build', '_render.html');
fs.writeFileSync(htmlFile, `<!doctype html><body style="margin:0"><canvas id="c"></canvas><script type="module">
import * as pdfjs from '${lib}'; pdfjs.GlobalWorkerOptions.workerSrc = '${worker}';
window.renderPage = async (data, n) => { const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) }).promise;
  const p = await doc.getPage(n); const vp = p.getViewport({ scale: 1.4 }); const c = document.getElementById('c'); c.width = vp.width; c.height = vp.height;
  await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; return [vp.width, vp.height, doc.numPages]; };
window.ready = true;</script></body>`);
await page.goto(pathToFileURL(htmlFile).href);
await page.waitForFunction('window.ready');
const data = fs.readFileSync(pdf).toString('base64');
for (const n of list.split(',').map(Number)) {
  const [w, h] = await page.evaluate((d, n) => window.renderPage(d, n), data, n);
  await page.setViewport({ width: Math.ceil(w), height: Math.ceil(h) });
  await (await page.$('#c')).screenshot({ path: path.join(outDir, `${path.basename(pdf, '.pdf')}-p${n}.png`) });
  console.log('rendered page', n);
}
await browser.close();
