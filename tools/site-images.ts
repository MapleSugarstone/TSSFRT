// Renders the site's favicon, touch icon and link preview image from the game's own costumes.
// Usage: npx tsx tools/site-images.ts
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { allCostumes, skins } from '../src/game/assets.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public');

function costume(name: string): string {
  for (const list of allCostumes) {
    for (const c of list) {
      if (c.name !== name) continue;
      const file = path.join(OUT, 'assets', skins[c.skin].file);
      const mime = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    }
  }
  throw new Error(`missing costume ${name}`);
}

const gem = costume('SFrT_Logo_GemAnim_1');
const text = costume('SFrT_Logo_TextAnim_14');
const art = costume('VERSUS_sfrt');

// The gem's glow spans x 168-319 and y 115-252 of its 480x360 frame.
const GEM_X = 243.5;
const GEM_Y = 183.5;
const GEM_SIZE = 152;

/** Places a 480x360 costume frame so frame point (fx, fy) lands at (x, y), at `scale` pixels per frame pixel. */
function frame(src: string, fx: number, fy: number, x: number, y: number, scale: number): string {
  return `<img src="${src}" style="position:absolute;left:${x - fx * scale}px;top:${y - fy * scale}px;width:${480 * scale}px;height:${360 * scale}px">`;
}

function page(w: number, h: number, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:transparent"><div style="position:relative;width:${w}px;height:${h}px;overflow:hidden">${body}</div></body></html>`;
}

const icon = (size: number): string => page(size, size, frame(gem, GEM_X, GEM_Y, size / 2, size / 2, size / GEM_SIZE));

const preview = page(
  1200,
  630,
  `<img src="${art}" style="position:absolute;left:0;top:-135px;width:1200px;height:900px">` +
    '<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(22,18,40,0.25), rgba(10,10,18,0.75))"></div>' +
    frame(gem, GEM_X, GEM_Y, 600, 315, 3.9) +
    frame(text, GEM_X, GEM_Y, 600, 315, 3.9),
);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const tab = await browser.newPage();
const jobs: [string, number, number, string, boolean][] = [
  ['favicon.png', 64, 64, icon(64), true],
  ['apple-touch-icon.png', 180, 180, icon(180), true],
  ['preview.png', 1200, 630, preview, false],
];
for (const [file, w, h, html, transparent] of jobs) {
  await tab.setViewportSize({ width: w, height: h });
  await tab.setContent(html);
  await tab.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await tab.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: w, height: h }, omitBackground: transparent });
  console.log(`wrote public/${file} (${w}x${h})`);
}
await browser.close();
