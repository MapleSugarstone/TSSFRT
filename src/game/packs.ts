// Adds character packs to the game: the ones built into the site (packs-data.json, made by
// tools/characters/build.ts) and then any mods the page built from players' uploads. Their costumes,
// skins, sounds and list entries go after the originals'. The page installs them once before creating
// a runtime. Parity tests never do, since the original has no packs.
import type { Value } from '../engine/cast.ts';
import type { Runtime } from '../engine/runtime.ts';
import { allCostumes, skins, sounds } from './assets.ts';
import { modules } from './generated/index.ts';
import { def as stageDef } from './generated/Stage_.ts';
import { fighterTint, gimmickHandler, type GimmickScript } from './gimmick-api.ts';
import type { GameTables } from './pack-build.ts';
import { LISTS, type BuiltPacks } from './pack-data.ts';
import { isMoveName } from './pack-format.ts';
import { gimmicks } from './pack-gimmicks.ts';
import { installSkinSilhouettes } from './silhouettes.ts';
import silhouetteData from './silhouettes-data.json' with { type: 'json' };
import data from './packs-data.json' with { type: 'json' };

const built = data as unknown as BuiltPacks;
const originalNames = (stageDef.lists[LISTS.names] as Value[]).map(String);
let staticInstalled = false;
let modsInstalled = false;
let mods: { built: BuiltPacks; gimmicks: Record<number, GimmickScript> } | null = null;

export const packCharacters = built.characters ?? [];

function install(b: BuiltPacks): void {
  skins.push(...b.skins);
  for (const [t, list] of Object.entries(b.costumes)) {
    const into = allCostumes[Number(t)];
    // The game has an empty placeholder named for an eighth character's sprite, and a sprite shows the first costume of a name.
    const names = new Map(into.map((c, i) => [c.name, i]));
    for (const c of list) {
      const i = names.get(c.name);
      if (i === undefined) into.push(c);
      else into[i] = c;
    }
  }
  for (const [t, list] of Object.entries(b.sounds)) sounds(Number(t)).push(...list);
  const lists = stageDef.lists as Record<string, Value[]>;
  for (const [prop, values] of Object.entries(b.lists)) lists[prop].push(...(values as Value[]));
  for (const [prop, items] of Object.entries(b.listSuffixes)) {
    for (const [item, text] of Object.entries(items)) lists[prop][Number(item) - 1] = `${String(lists[prop][Number(item) - 1])}${text}`;
  }
}

/** Adds the packs built into the site. */
export function installStaticPacks(): void {
  if (staticInstalled) return;
  staticInstalled = true;
  if (packCharacters.length) install(built);
}

/** The game's tables with the site's packs added, for building mods in the page. */
export function modTables(): GameTables {
  installStaticPacks();
  const target = (name: string) => allCostumes.indexOf(modules.find((m) => m.def.name === name)!.def.costumes);
  return {
    skinCount: skins.length,
    costumes: allCostumes,
    sounds,
    lists: stageDef.lists as GameTables['lists'],
    target,
    masked: new Set(Object.keys(silhouetteData).map(target)),
    names: originalNames,
  };
}

/** Sets the mods to add after the site's packs. Call before the first runtime. */
export function setModPacks(b: BuiltPacks, g: Record<number, GimmickScript>): void {
  mods = { built: b, gimmicks: g };
}

/** The number the next character gets: after the originals, the site's packs and the mods so far. */
export const nextCharacterId = (modCount: number) => originalNames.length + packCharacters.length + 1 + modCount;

export function installPacks(): void {
  installStaticPacks();
  if (mods && !modsInstalled) {
    modsInstalled = true;
    install(mods.built);
  }
}

/** Tells a runtime which characters come from packs, so they use their templates' move scripts, and gives it their menu masks and gimmick scripts. */
export function registerPackCharacters(rt: Runtime): void {
  const all = mods ? [built, mods.built] : [built];
  for (const b of all) {
    for (const c of b.characters ?? [])
      rt.characters.set(String(c.id), {
        template: String(c.template ?? 0),
        rules: c.rules ? String(c.rules) : undefined,
        moveRules: new Map(Object.entries(c.moveRules ?? {})),
        owns: new Set(c.owns),
        named: new Set(c.owns.filter((m) => !isMoveName(m))),
      });
    installSkinSilhouettes(rt, b.silhouettes ?? {});
  }
  // The site's own packs are project code and run as it is. Mod scripts come already sandboxed.
  const scripts: Record<number, GimmickScript> = { ...Object.fromEntries(Object.entries(gimmicks).map(([id, gimmick]) => [id, { gimmick }])), ...mods?.gimmicks };
  const cues = Object.assign({}, ...all.map((b) => b.cues ?? {}));
  const particles = Object.assign({}, ...all.map((b) => b.particles ?? {}));
  if (Object.keys(scripts).length || Object.keys(cues).length || Object.keys(particles).length) rt.gimmickHandler = gimmickHandler(rt, scripts, cues, particles);
  if (Object.keys(scripts).length) rt.tintOf = fighterTint(rt);
}
