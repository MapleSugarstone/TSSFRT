// Dumps costume metadata and touching silhouettes from the reference renderer.
import fs from 'node:fs';
import path from 'node:path';
import { openReference, ROOT } from './lib/reference.ts';

const ref = await openReference();
const meta = await ref.page.evaluate(() => (window as any).H.meta());
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out', 'ref-meta.json'), JSON.stringify(meta));
const sil = await ref.page.evaluate(() => (window as any).H.silhouettes(['MainMenu', 'P1', 'P2', 'P3', 'P4']));
fs.writeFileSync(path.join(ROOT, 'src', 'game', 'silhouettes-data.json'), JSON.stringify(sil));
console.log('meta targets', meta.length, 'silhouette sprites', Object.keys(sil).length);
await ref.close();
