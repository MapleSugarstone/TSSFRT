// Turns character packs into the skins, costumes, sounds and list entries the game appends. The site
// build (tools/characters/build.ts) and mods loaded in the page both use it, with their own way of
// reading files.
import type { Value } from '../engine/cast.ts';
import type { CostumeDef, SkinDef, SoundDef } from '../engine/defs.ts';
import { LISTS, type BuiltCharacter, type BuiltPacks } from './pack-data.ts';
import { ART, HITBOX_SPRITE, MOVE_FIELDS, packHitboxId, PLAYER_SPRITE, STAT_FIELDS, templateHitboxId, type CharacterPack, type Image, type Scalar } from './pack-format.ts';

/** A 1-bit touch mask, LSB first, in the game's silhouette format. */
export interface Mask {
  w: number;
  h: number;
  bits: string;
}

/** How the builder reads one pack's files. */
export interface PackSource {
  /** Pixel size and kind of an image file. */
  image(file: string): { width: number; height: number; kind: 'bitmap' | 'svg' };
  /** Where the game loads a file from: a path under assets/ or a full URL. */
  publish(file: string): string;
  /** A bitmap's touch mask, or null for a solid one. */
  mask(file: string): Mask | null;
  /** An original skin identical to this image, or -1. */
  sameSkin?(img: Image, res: number): number;
}

/** The game's own tables the packs are added to. */
export interface GameTables {
  /** Skins already in the game (the originals and anything installed before). */
  skinCount: number;
  costumes: readonly (readonly CostumeDef[])[];
  sounds(target: number): readonly SoundDef[];
  lists: Record<string, readonly Value[]>;
  /** Target index of a sprite by name. */
  target(name: string): number;
  /** Targets that test touching, so new skins they show need masks. */
  masked: ReadonlySet<number>;
  /** The original characters' names, in character number order. */
  names: string[];
}

export const emptyPacks = (): BuiltPacks => ({ characters: [], skins: [], costumes: {}, sounds: {}, lists: {}, listSuffixes: {}, silhouettes: {}, cues: {}, particles: {} });

/** Appends packs built separately (with skin numbers that already count the ones before). */
export function mergePacks(into: BuiltPacks, from: BuiltPacks): void {
  into.skins.push(...from.skins);
  for (const [t, l] of Object.entries(from.costumes)) (into.costumes[Number(t)] ??= []).push(...l);
  for (const [t, l] of Object.entries(from.sounds)) (into.sounds[Number(t)] ??= []).push(...l);
  for (const [p, l] of Object.entries(from.lists)) (into.lists[p] ??= []).push(...l);
  for (const [p, items] of Object.entries(from.listSuffixes)) {
    const to = (into.listSuffixes[p] ??= {});
    for (const [i, text] of Object.entries(items)) to[Number(i)] = `${to[Number(i)] ?? ''}${text}`;
  }
  Object.assign(into.silhouettes, from.silhouettes);
  Object.assign(into.cues, from.cues);
  Object.assign(into.particles, from.particles);
  into.characters.push(...from.characters);
}

/** A mask that is solid everywhere, for images whose shape cannot be read (SVG). */
export function solidMask(): Mask {
  return { w: 2, h: 2, bits: btoa(String.fromCharCode(15)) };
}

/** Packs an alpha test per pixel into a mask. */
export function packMask(w: number, h: number, opaque: (i: number) => boolean): Mask {
  const bytes = new Uint8Array(Math.ceil((w * h) / 8));
  for (let i = 0; i < w * h; i++) if (opaque(i)) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return { w, h, bits: btoa(s) };
}

/** Adds one pack to `out` as character `id` and returns its entry. */
export function addPack(out: BuiltPacks, pack: CharacterPack, id: number, slug: string, src: PackSource, game: GameTables): BuiltCharacter {
  const template = pack.template ? game.names.indexOf(pack.template) + 1 : null;
  const player = game.target(PLAYER_SPRITE);
  const hitboxes = game.target(HITBOX_SPRITE);
  const particles = game.target('Particles');
  const skinFiles = new Map<number, string>();

  const addCostume = (target: number, c: CostumeDef) => {
    (out.costumes[target] ??= []).push(c);
    const file = skinFiles.get(c.skin);
    if (game.masked.has(target) && file && !out.silhouettes[c.skin]) out.silhouettes[c.skin] = (/\.png$/i.test(file) && src.mask(file)) || solidMask();
  };
  const addSound = (target: number, s: SoundDef) => (out.sounds[target] ??= []).push(s);
  const addList = (prop: string, ...values: Scalar[]) => (out.lists[prop] ??= []).push(...values);

  /** Adds a skin for one image and returns its number in the game's skin table. */
  const skin = (img: Image): number => {
    const size = src.image(img.file);
    const res = size.kind === 'svg' ? 1 : img.resolution || 2;
    const same = src.sameSkin?.(img, res) ?? -1;
    if (same >= 0) return same;
    out.skins.push({
      w: size.width / res,
      h: size.height / res,
      rcx: img.center[0] / res,
      rcy: img.center[1] / res,
      kind: size.kind,
      file: src.publish(img.file),
      res,
      maxScale: size.kind === 'svg' ? 2 ** Math.floor(Math.log2(2048 / Math.max(size.width, size.height, 1))) : 1,
    } as SkinDef);
    const n = game.skinCount + out.skins.length - 1;
    skinFiles.set(n, img.file);
    return n;
  };

  for (const f of pack.animations) addCostume(player, { name: `${f.speed})${id}'${f.name}`, skin: skin(f) });

  // Art goes to every sprite that has the same costume for character 1. Missing art comes from the template.
  for (const [key, a] of Object.entries(ART)) {
    const img = pack.art[key];
    const own = img ? skin(img) : -1;
    game.costumes.forEach((list, ti) => {
      if (!list.some((c) => c.name === a.costume.replace('#', '1'))) return;
      const fallback = template ? list.find((c) => c.name === a.costume.replace('#', String(template))) : undefined;
      const s = own >= 0 ? own : fallback?.skin;
      if (s !== undefined) addCostume(ti, { name: a.costume.replace('#', String(id)), skin: s });
    });
  }

  addList(LISTS.stats, `${STAT_FIELDS.map(([key]) => pack.stats[key]).join("'")}'`);
  addList(LISTS.names, pack.name);
  addList(LISTS.text, pack.text.lore, pack.text.mechanics, ...pack.text.combo.flatMap((c) => [c.name, c.description]));

  // CPU data is keyed by name; a pack without its own takes the template's.
  const fromTemplate = (prop: string, n: number): Scalar[] | null => {
    if (!pack.template) return null;
    const l = game.lists[prop] as Scalar[];
    const i = l.indexOf(pack.template);
    return i < 0 ? null : l.slice(i + 1, i + 1 + n);
  };
  const behaviour = pack.cpu.behaviour ?? fromTemplate(LISTS.behaviour, 3);
  if (behaviour) addList(LISTS.behaviour, pack.name, ...behaviour);
  const usage = pack.cpu.comboUsage ?? fromTemplate(LISTS.comboUsage, 1)?.[0] ?? null;
  if (usage !== null) addList(LISTS.comboUsage, pack.name, usage);
  for (const c of pack.cpu.combos) addList(LISTS.combos, `${pack.name}_${c.slice(c.indexOf('_') + 1)}`);

  const owns: string[] = [];
  for (const [move, m] of Object.entries(pack.moves)) {
    owns.push(move);
    const moveId = packHitboxId(move, id);
    const templateId = template ? templateHitboxId(move, template) : null;
    addList(LISTS.moveData, `${moveId}'`, `${MOVE_FIELDS.map(([key]) => m.attributes[key] ?? '').join(':')}:`);
    if (m.active) addList(LISTS.frameData, moveId, m.active.start, m.active.end);
    if (m.aiSpacing) addList(LISTS.spacing, moveId, ...m.aiSpacing);
    if (m.cantMove) addList(LISTS.cantMove, moveId);
    if (m.uniqueAnimation) addList(LISTS.unique, moveId);
    if (m.shieldBreaking) addList(LISTS.shieldBreaking, moveId);
    if (m.ignoreVelocityLimit) addList(LISTS.ignoreVelocity, moveId);
    if (m.freeze !== null) addList(LISTS.freeze, moveId, m.freeze);
    if (m.hitSound !== null) {
      const groups = (out.listSuffixes[LISTS.hitsound] ??= {});
      groups[m.hitSound] = `${groups[m.hitSound] ?? ''}${moveId}'`;
    }
    m.hitboxes.forEach((f, n) => addCostume(hitboxes, { name: `${f.speed})${moveId}-${n + 1}`, skin: skin(f) }));
    if (!m.hitboxes.length && templateId) {
      // The template's hitbox frames, renamed, so its move script finds frames for this move.
      const re = new RegExp(`^(\\d)\\)?${templateId}-(\\d+)$`);
      for (const c of game.costumes[hitboxes]) {
        const mm = re.exec(c.name);
        if (mm) addCostume(hitboxes, { name: `${mm[1]})${moveId}-${mm[2]}`, skin: c.skin });
      }
    }
    (m.cues ?? []).forEach((c, n) => {
      const name = `${moveId}@${n + 1}`;
      addSound(hitboxes, { name, file: src.publish(c.sound.file), rate: c.sound.rate, sampleCount: c.sound.sampleCount });
      (out.cues[moveId] ??= []).push([Number(c.frame), name]);
    });
    if (m.sound) addSound(hitboxes, { name: moveId, file: src.publish(m.sound.file), rate: m.sound.rate, sampleCount: m.sound.sampleCount });
    else if (templateId) {
      const s = game.sounds(hitboxes).find((x) => x.name === templateId);
      if (s) addSound(hitboxes, { ...s, name: moveId });
    }
  }

  for (const [name, frames] of Object.entries(pack.particles ?? {})) {
    frames.forEach((f, n) => addCostume(particles, { name: `${f.speed})${name}@${id}-${n + 1}`, skin: skin(f) }));
    (out.particles[id] ??= []).push(name);
  }

  const rules = pack.rules ? game.names.indexOf(pack.rules) + 1 : null;
  const moveRules = Object.fromEntries(Object.entries(pack.moves ?? {}).flatMap(([move, m]) => (m.rules ? [[move, m.rules]] : [])));
  const c: BuiltCharacter = { id, slug, name: pack.name, template, rules, moveRules, owns, gimmick: pack.gimmick ? `${slug}/${pack.gimmick}` : null };
  out.characters.push(c);
  return c;
}
