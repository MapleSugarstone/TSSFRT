// Unzips the source project into sb3/ (project.json plus costume and sound files).
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, process.argv[2] ?? 'Port_to_TypeScript.sb3');
const out = path.join(root, 'sb3');
const zip = await JSZip.loadAsync(fs.readFileSync(src));
fs.mkdirSync(out, { recursive: true });
let n = 0;
for (const [name, entry] of Object.entries(zip.files)) {
  if (entry.dir) continue;
  fs.writeFileSync(path.join(out, path.basename(name)), await entry.async('nodebuffer'));
  n++;
}
console.log(`extracted ${n} files to ${out}`);
