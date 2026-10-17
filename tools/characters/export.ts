// Exports the original characters as packs in characters/_templates/, the starting point for new
// characters. Each move keeps the template's behavior script and is exported with its data,
// hitbox frames and sound, which a new character made from the template can change.
// Usage: npx tsx tools/characters/export.ts
import fs from 'node:fs';
import path from 'node:path';
import { ART, EXTRA_HITBOXES, HITBOX_SPRITE, MOVE_FIELDS, MOVE_NAMES, PACK_FORMAT, PLAYER_SPRITE, STAT_FIELDS, type CharacterPack, type Frame, type Image, type Move, type Scalar } from '../../src/game/pack-format.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SB3 = path.join(ROOT, 'sb3');
const OUT = path.join(ROOT, 'characters', '_templates');

interface Costume { name: string; md5ext: string; rotationCenterX: number; rotationCenterY: number; bitmapResolution?: number }
interface Sound { name: string; md5ext: string; rate: number; sampleCount: number }
interface Target { name: string; isStage: boolean; costumes: Costume[]; sounds: Sound[]; lists: Record<string, [string, Scalar[]]> }

const project = JSON.parse(fs.readFileSync(path.join(SB3, 'project.json'), 'utf8')) as { targets: Target[] };
const stage = project.targets.find((t) => t.isStage)!;
const list = (name: string): Scalar[] => Object.values(stage.lists).find(([n]) => n === name)![1];
const sprite = (name: string): Target => project.targets.find((t) => t.name === name)!;

const L = {
  stats: list("!!CharData:SP'FC'JH'Fall'JA'AirSP'hitwidth'hitheight"),
  names: list('Data_Character_Names'),
  text: list('Data_Txt_CharacterDescription'),
  shmoves: list('CPU_character_shmoves'),
  comboUsage: list('CPU_combo_usage'),
  combos: list('CPU_combos'),
  moveData: list("!MoveData'L'W'XYD'XYK'EXYK'iframe'stun"),
  frameData: list('!FrameData'),
  spacing: list('CPU_I_AM_LOOSING_IT_DISPLACEMENT_THING_IDK_ANYMORE'),
  cantMove: list("!Can'tMove"),
  unique: list('!UniqueAnimation'),
  shieldBreaking: list('Attacks_ShieldBreaking'),
  ignoreVelocity: list('Attacks_IgnoreVelocityLimit'),
  freeze: list('FREEZE'),
  hitsound: list('Hitsound'),
};

/** A list value as a number when that loses nothing, otherwise as written. */
function scalar(v: Scalar): Scalar {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return v.trim() !== '' && String(n) === v ? n : v;
}

/** Splits a costume name into its speed code and the rest ("4)NPunch-1-1" gives 4 and "NPunch-1-1"). */
function speedAndName(costume: string): { speed: number; rest: string } {
  const m = /^(\d)\)?(.*)$/.exec(costume);
  return m ? { speed: Number(m[1]), rest: m[2] } : { speed: 5, rest: costume };
}

function copyAsset(c: { md5ext: string }, dir: string, base: string): string {
  const ext = path.extname(c.md5ext);
  const rel = `${base}${ext}`;
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.copyFileSync(path.join(SB3, c.md5ext), path.join(dir, rel));
  return rel;
}

function image(c: Costume, dir: string, base: string): Image {
  return { file: copyAsset(c, dir, base), center: [c.rotationCenterX, c.rotationCenterY], resolution: c.bitmapResolution ?? 1 };
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_');

function exportCharacter(id: number): void {
  const name = String(L.names[id - 1]);
  const slug = safe(name.toLowerCase());
  const dir = path.join(OUT, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const statValues = String(L.stats[id - 1]).split("'");
  const stats: Record<string, Scalar> = {};
  STAT_FIELDS.forEach(([key], i) => (stats[key] = scalar(statValues[i] ?? '')));

  const t = L.text.slice((id - 1) * 8, id * 8).map(String);
  const at = (l: Scalar[], key: Scalar, n: number) => {
    const i = l.indexOf(key);
    return i < 0 ? null : l.slice(i + 1, i + 1 + n);
  };
  const behaviour = at(L.shmoves, name, 3);
  const usage = at(L.comboUsage, name, 1);

  const hitboxes = sprite(HITBOX_SPRITE);
  const moves: Record<string, Move> = {};
  // The character's moves ("E1" is "E1-<id>" in the game), then the extra hitboxes its moves create.
  const exported = [...MOVE_NAMES.map((m) => [m, `${m}-${id}`]), ...EXTRA_HITBOXES.filter((x) => x.character === name).map((x) => [x.name, x.name])];
  for (const [m, moveId] of exported) {
    const di = L.moveData.indexOf(`${moveId}'`);
    // Hitbox frames are the run of costumes named "<move>-<id>-<frame>".
    const frames: Frame[] = [];
    const first = hitboxes.costumes.findIndex((c) => new RegExp(`^${moveId}-\\d`).test(speedAndName(c.name).rest));
    for (let k = first; k >= 0 && k < hitboxes.costumes.length; k++) {
      const c = hitboxes.costumes[k];
      const { speed, rest } = speedAndName(c.name);
      if (!new RegExp(`^${moveId}-\\d`).test(rest)) break;
      const img = image(c, dir, `moves/${m}/${String(frames.length + 1).padStart(2, '0')}`);
      frames.push({ file: img.file, speed, center: img.center, resolution: img.resolution });
    }
    const snd = hitboxes.sounds.find((s) => s.name === moveId);
    const hasAnything = di >= 0 || frames.length > 0 || L.cantMove.includes(moveId) || snd;
    if (!hasAnything) continue;
    const attrs = di >= 0 ? String(L.moveData[di + 1]).split(':') : [];
    const attributes: Record<string, Scalar> = {};
    MOVE_FIELDS.forEach(([key], i) => (attributes[key] = scalar(attrs[i] ?? '')));
    const fd = at(L.frameData, moveId, 2);
    const sp = at(L.spacing, moveId, 2);
    const fr = at(L.freeze, moveId, 1);
    const hs = L.hitsound.findIndex((g) => String(g).includes(`${moveId}'`));
    moves[m] = {
      attributes,
      hitboxes: frames,
      active: fd ? { start: scalar(fd[0]), end: scalar(fd[1]) } : null,
      aiSpacing: sp ? [sp[0], sp[1]] : null,
      cantMove: L.cantMove.includes(moveId),
      uniqueAnimation: L.unique.includes(moveId),
      shieldBreaking: L.shieldBreaking.includes(moveId),
      ignoreVelocityLimit: L.ignoreVelocity.includes(moveId),
      freeze: fr ? fr[0] : null,
      hitSound: hs >= 0 ? hs + 1 : null,
      sound: snd ? { file: copyAsset(snd, dir, `sounds/${m}`), rate: snd.rate, sampleCount: snd.sampleCount } : null,
      cues: [],
    };
  }

  // Animation frames are the player sprite's costumes named "<speed>)<id>'<animation>", in order.
  const animations: Frame[] = [];
  for (const c of sprite(PLAYER_SPRITE).costumes) {
    const { speed, rest } = speedAndName(c.name);
    const prefix = `${id}'`;
    if (!rest.startsWith(prefix)) continue;
    const frameName = rest.slice(prefix.length);
    const img = image(c, dir, `animations/${String(animations.length + 1).padStart(2, '0')}_${safe(frameName)}`);
    animations.push({ name: frameName, file: img.file, speed, center: img.center, resolution: img.resolution });
  }

  const art = {} as CharacterPack['art'];
  for (const [key, a] of Object.entries(ART)) {
    const costume = a.costume.replace('#', String(id));
    const holder = project.targets.find((tg) => tg.costumes.some((c) => c.name === costume));
    const c = holder?.costumes.find((x) => x.name === costume);
    art[key] = c ? image(c, dir, `art/${key}`) : null;
  }

  const pack: CharacterPack = {
    format: PACK_FORMAT,
    name,
    template: name,
    stats,
    text: {
      lore: t[0] ?? '',
      mechanics: t[1] ?? '',
      combo: [
        { name: t[2] ?? '', description: t[3] ?? '' },
        { name: t[4] ?? '', description: t[5] ?? '' },
        { name: t[6] ?? '', description: t[7] ?? '' },
      ],
    },
    cpu: {
      behaviour: behaviour ? [behaviour[0], behaviour[1], behaviour[2]] : null,
      comboUsage: usage ? usage[0] : null,
      combos: L.combos.map(String).filter((c) => c.startsWith(`${name}_`)),
    },
    moves,
    animations,
    art,
    gimmick: null,
  };
  fs.writeFileSync(path.join(dir, 'character.json'), `${JSON.stringify(pack, null, 2)}\n`);
  const kept = MOVE_NAMES.filter((m) => !moves[m]).join(', ');
  console.log(`${name.padEnd(8)} ${animations.length} frames, own moves: ${Object.keys(moves).join(', ') || 'none'}; from template: ${kept}`);
}

for (let id = 1; id <= L.names.length; id++) exportCharacter(id);
