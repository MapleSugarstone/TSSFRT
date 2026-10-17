// Builds every character pack in characters/ (except _templates) into src/game/packs-data.json and
// copies their images and sounds to public/assets/packs/. The game adds them after the original
// roster, as characters 8, 9 and so on in folder name order.
// Usage: npx tsx tools/characters/build.ts
import fs from 'node:fs';
import path from 'node:path';
import { allCostumes, skins as baseSkins, sounds as soundsOf } from '../../src/game/assets.ts';
import { modules } from '../../src/game/generated/index.ts';
import { def as stageDef } from '../../src/game/generated/Stage_.ts';
import { addPack, emptyPacks, type GameTables } from '../../src/game/pack-build.ts';
import { LISTS, type BuiltCharacter } from '../../src/game/pack-data.ts';
import type { CharacterPack, Scalar } from '../../src/game/pack-format.ts';
import { createHash } from 'node:crypto';
import silhouetteData from '../../src/game/silhouettes-data.json' with { type: 'json' };
import { imageSize, pngMask } from './images.ts';
import { validatePack } from './validate.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const PACKS_DIR = path.join(ROOT, 'characters');
const OUT_JSON = path.join(ROOT, 'src', 'game', 'packs-data.json');
const OUT_ASSETS = path.join(ROOT, 'public', 'assets', 'packs');
const OUT_GIMMICKS = path.join(ROOT, 'src', 'game', 'pack-gimmicks.ts');

/** Pack folders that the game includes: every folder but the templates. */
export function packFolders(): string[] {
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs
    .readdirSync(PACKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.') && fs.existsSync(path.join(PACKS_DIR, d.name, 'character.json')))
    .map((d) => d.name)
    .sort();
}

export function readPack(slug: string): CharacterPack {
  return JSON.parse(fs.readFileSync(path.join(PACKS_DIR, slug, 'character.json'), 'utf8')) as CharacterPack;
}

const baseNames = (stageDef.lists[LISTS.names] as Scalar[]).map(String);
const targetIndex = (name: string): number => {
  const m = modules.find((x) => x.def.name === name);
  if (!m) throw new Error(`no sprite named ${name}`);
  return allCostumes.indexOf(m.def.costumes);
};

/** The original game's tables, for building packs before the game runs. */
export const gameTables = (): GameTables => ({
  skinCount: baseSkins.length,
  costumes: allCostumes,
  sounds: soundsOf,
  lists: stageDef.lists as GameTables['lists'],
  target: targetIndex,
  masked: new Set(Object.keys(silhouetteData).map(targetIndex)),
  names: baseNames,
});

export function buildPacks(log: (s: string) => void = console.log): { ok: boolean; errors: string[] } {
  const slugs = packFolders();
  const errors: string[] = [];
  const out = emptyPacks();
  const game = gameTables();
  fs.rmSync(OUT_ASSETS, { recursive: true, force: true });

  for (const slug of slugs) {
    const pack = readPack(slug);
    const dir = path.join(PACKS_DIR, slug);
    const problems = validatePack(pack, dir, baseNames).filter((p) => p.level === 'error');
    if (problems.length) {
      errors.push(...problems.map((p) => `${slug}: ${p.message}`));
      continue;
    }
    const id = baseNames.length + 1 + out.characters.length;
    const c = addPack(out, pack, id, slug, {
      image: (file) => imageSize(path.join(dir, file)),
      mask: (file) => pngMask(path.join(dir, file)),
      publish: (file) => {
        const dest = path.join(OUT_ASSETS, slug, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(dir, file), dest);
        return `packs/${slug}/${file.replace(/\\/g, '/')}`;
      },
      // An image identical to an original asset (whose file is named by its hash) reuses that skin and its mask.
      sameSkin: (img, res) => {
        const original = `costumes/${createHash('md5').update(fs.readFileSync(path.join(dir, img.file))).digest('hex')}${path.extname(img.file).toLowerCase()}`;
        return baseSkins.findIndex((s) => s.file === original && s.res === res && Math.abs(s.rcx - img.center[0] / res) < 1e-6 && Math.abs(s.rcy - img.center[1] / res) < 1e-6);
      },
    }, game);
    log(`${String(id).padStart(2)} ${pack.name} (${slug})${pack.template ? `, from ${pack.template}` : ''}: ${pack.animations.length} frames, own moves ${c.owns.join(', ') || 'none'}`);
  }

  if (errors.length) return { ok: false, errors };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(out)}\n`);
  writeGimmicks(out.characters);
  return { ok: true, errors };
}

/** Writes the module that imports each pack's gimmick script, so the bundler includes them. */
function writeGimmicks(characters: BuiltCharacter[]): void {
  const withScript = characters.filter((c) => c.gimmick);
  const lines = [
    '// Made by tools/characters/build.ts from the gimmick scripts of the character packs. Do not edit.',
    "import type { Gimmick } from './gimmick-api.ts';",
    // A pack made on the site has its script in JavaScript, which the type checker has no types for.
    ...withScript.flatMap((c) => [...(/\.js$/i.test(c.gimmick!) ? ['// @ts-ignore'] : []), `import g${c.id} from '../../characters/${c.gimmick}';`]),
    '',
    `export const gimmicks: Record<number, Gimmick> = {${withScript.length ? ` ${withScript.map((c) => `${c.id}: g${c.id}`).join(', ')} ` : ''}};`,
    '',
  ];
  const text = lines.join('\n');
  if (!fs.existsSync(OUT_GIMMICKS) || fs.readFileSync(OUT_GIMMICKS, 'utf8') !== text) fs.writeFileSync(OUT_GIMMICKS, text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const r = buildPacks();
  if (!r.ok) {
    for (const e of r.errors) console.error(`error: ${e}`);
    process.exitCode = 1;
  } else console.log(`wrote src/game/packs-data.json`);
}
