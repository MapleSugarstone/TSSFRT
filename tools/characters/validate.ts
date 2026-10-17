// Checks a character pack folder before it is built (see src/game/pack-validate.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { CharacterPack } from '../../src/game/pack-format.ts';
import { checkPack, type Problem } from '../../src/game/pack-validate.ts';

export type { Problem };

export function validatePack(pack: CharacterPack, dir: string, originalNames: string[]): Problem[] {
  return checkPack(pack, (file) => fs.existsSync(path.join(dir, file)), originalNames);
}
