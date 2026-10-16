// Copies costume and sound files into public/assets for the browser build.
// Vector costumes are written as the original loader normalized them (viewBox, injected fonts).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'out/ref-meta.json'), 'utf8'));
const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'sb3/project.json'), 'utf8'));
const costumeDir = path.join(ROOT, 'public/assets/costumes');
const soundDir = path.join(ROOT, 'public/assets/sounds');
fs.mkdirSync(costumeDir, { recursive: true });
fs.mkdirSync(soundDir, { recursive: true });

let svgs = 0;
let bitmaps = 0;
let sounds = 0;
for (const t of meta) {
  for (const c of t.costumes) {
    const out = path.join(costumeDir, c.md5ext);
    if (c.format === 'svg') {
      const comma = c.svgSrc.indexOf(',');
      fs.writeFileSync(out, decodeURIComponent(c.svgSrc.slice(comma + 1)));
      svgs++;
    } else {
      fs.copyFileSync(path.join(ROOT, 'sb3', c.md5ext), out);
      bitmaps++;
    }
  }
}
for (const t of project.targets) {
  for (const s of t.sounds) {
    fs.copyFileSync(path.join(ROOT, 'sb3', s.md5ext), path.join(soundDir, s.md5ext));
    sounds++;
  }
}
console.log(`svg ${svgs}, bitmap ${bitmaps}, sounds ${sounds}`);
