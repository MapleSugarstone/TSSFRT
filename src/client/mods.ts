// Character mods players add on the page: zips kept in this browser (mod-store.ts) and built into the
// game when the page loads, after the site's own characters. Enabled mods change the build id, so online
// rooms only pair players with the same mods.
import type { GimmickScript } from '../game/gimmick-api.ts';
import { addPack, emptyPacks, mergePacks, packMask } from '../game/pack-build.ts';
import type { Image } from '../game/pack-format.ts';
import { checkPack } from '../game/pack-validate.ts';
import { modTables, nextCharacterId, setModPacks } from '../game/packs.ts';
import { setModTag } from '../net/room-client.ts';
import { modRecords, scriptFile, unpackMod, type ModRecord } from './mod-store.ts';

export { addMod, deleteMod, listMods, modScript, setModEnabled, setModScriptAllowed, type ModInfo } from './mod-store.ts';

/** What loading the enabled mods did, for the mods screen. */
export interface ModLoad {
  loaded: string[];
  problems: string[];
}

const TYPES: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', js: 'text/javascript' };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('an image could not be read'));
    img.src = url;
  });
}

/** Builds the enabled mods into the game. Call once, before the first runtime. */
export async function loadMods(): Promise<ModLoad> {
  const result: ModLoad = { loaded: [], problems: [] };
  let mods: ModRecord[];
  try {
    mods = (await modRecords()).filter((m) => m.enabled).sort((a, b) => (a.id < b.id ? -1 : 1));
  } catch {
    return result;
  }
  if (!mods.length) return result;
  const tables = modTables();
  const out = emptyPacks();
  const gimmicks: Record<number, GimmickScript> = {};
  const ids: string[] = [];
  for (const mod of mods) {
    try {
      const { pack, files } = await unpackMod(mod.zip);
      const problems = checkPack(pack, (f) => files.has(f), tables.names).filter((p) => p.level === 'error');
      if (problems.length) throw new Error(problems.map((p) => p.message).join('; '));
      const urls = new Map<string, string>();
      const url = (f: string) => {
        let u = urls.get(f);
        if (!u) urls.set(f, (u = URL.createObjectURL(new Blob([files.get(f) as Uint8Array<ArrayBuffer>], { type: TYPES[f.split('.').pop()!.toLowerCase()] ?? '' }))));
        return u;
      };
      const images: (Image | undefined | null)[] = [...pack.animations, ...Object.values(pack.art), ...Object.values(pack.moves).flatMap((m) => m.hitboxes), ...Object.values(pack.particles ?? {}).flat()];
      const sizes = new Map<string, { width: number; height: number; kind: 'bitmap' | 'svg' }>();
      const masks = new Map<string, { w: number; h: number; bits: string }>();
      const art = new Set(Object.values(pack.art).map((a) => a?.file));
      for (const img of images) {
        if (!img || sizes.has(img.file)) continue;
        const el = await loadImage(url(img.file));
        const svg = img.file.toLowerCase().endsWith('.svg');
        sizes.set(img.file, { width: el.naturalWidth, height: el.naturalHeight, kind: svg ? 'svg' : 'bitmap' });
        if (art.has(img.file) && !svg) {
          const c = document.createElement('canvas');
          c.width = el.naturalWidth;
          c.height = el.naturalHeight;
          const g = c.getContext('2d', { willReadFrequently: true })!;
          g.drawImage(el, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          masks.set(img.file, packMask(c.width, c.height, (i) => d[i * 4 + 3] > 0));
        }
      }
      const id = nextCharacterId(out.characters.length);
      const one = emptyPacks();
      addPack(one, pack, id, `mod-${mod.id}`, { image: (f) => sizes.get(f)!, publish: url, mask: (f) => masks.get(f) ?? null }, { ...tables, skinCount: tables.skinCount + out.skins.length });
      const script = scriptFile(pack);
      // A script runs only after the player turns it on for this mod, and then only in the sandbox.
      let gimmick: GimmickScript | undefined;
      if (script && mod.scriptAllowed) {
        const { sandboxGimmick } = await import('./mod-sandbox.ts');
        gimmick = sandboxGimmick(new TextDecoder().decode(files.get(script)), pack.name);
      }
      mergePacks(out, one);
      if (gimmick) gimmicks[id] = gimmick;
      ids.push(gimmick ? `${mod.id}+script` : mod.id);
      result.loaded.push(pack.name);
    } catch (e) {
      result.problems.push(`${mod.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!out.characters.length) return result;
  setModPacks(out, gimmicks);
  const tag = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ids.join(',')));
  setModTag([...new Uint8Array(tag)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join(''));
  return result;
}
