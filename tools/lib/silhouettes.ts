import fs from 'node:fs';
import path from 'node:path';
import type { Runtime } from '../../src/engine/runtime.ts';
import { installSilhouettes, type SilhouetteData } from '../../src/game/silhouettes.ts';

const FILE = path.resolve(import.meta.dirname, '../../src/game/silhouettes-data.json');

export function loadSilhouettes(rt: Runtime): void {
  if (!fs.existsSync(FILE)) return;
  installSilhouettes(rt, JSON.parse(fs.readFileSync(FILE, 'utf8')) as SilhouetteData);
}
