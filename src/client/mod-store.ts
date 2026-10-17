// The mods kept in this browser (IndexedDB), without the game code that builds them. The Mods screen
// and the mod maker page both use it.
import type { CharacterPack } from '../game/pack-format.ts';

export interface ModInfo {
  id: string;
  /** The character's name. */
  name: string;
  /** The uploaded file's name. */
  file: string;
  enabled: boolean;
  added: number;
  hasScript: boolean;
  /** The player turned the script on. Scripts in mods from elsewhere start off. */
  scriptAllowed: boolean;
}

export interface ModRecord extends ModInfo {
  zip: Blob;
  /** The mod maker character this mod was made from, which a newer version replaces. */
  maker?: string;
}

const DB = 'sfrt-mods';
const STORE = 'mods';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const modRecords = () => tx<ModRecord[]>('readonly', (s) => s.getAll() as IDBRequest<ModRecord[]>);

const info = ({ zip: _zip, maker: _maker, ...m }: ModRecord): ModInfo => ({ ...m, scriptAllowed: !!m.scriptAllowed });

export async function listMods(): Promise<ModInfo[]> {
  try {
    return (await modRecords()).map(info).sort((a, b) => a.added - b.added);
  } catch {
    return [];
  }
}

export interface Unpacked {
  pack: CharacterPack;
  files: Map<string, Uint8Array>;
}

export async function unpackMod(zip: Blob): Promise<Unpacked> {
  const { default: JSZip } = await import('jszip');
  const z = await JSZip.loadAsync(zip);
  const found = Object.keys(z.files).find((n) => /(^|\/)character\.json$/.test(n) && n.split('/').length <= 2);
  if (!found) throw new Error('The file has no character.json. Export the character from the mod maker.');
  const prefix = found.slice(0, found.length - 'character.json'.length);
  const files = new Map<string, Uint8Array>();
  for (const [name, entry] of Object.entries(z.files)) {
    if (entry.dir || !name.startsWith(prefix)) continue;
    files.set(name.slice(prefix.length), await entry.async('uint8array'));
  }
  const pack = JSON.parse(new TextDecoder().decode(files.get('character.json'))) as CharacterPack;
  return { pack, files };
}

/** A hash of a mod's files, the same however the zip was made. */
async function hashFiles(files: Map<string, Uint8Array>): Promise<string> {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const name of [...files.keys()].sort()) parts.push(enc.encode(`${name}\0${files.get(name)!.length}\0`), files.get(name)!);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) all.set(p, (o += p.length) - p.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const scriptFile = (pack: CharacterPack) => pack.gimmick?.replace(/\.ts$/i, '.js') ?? null;

/** Adds a mod zip. A mod from the mod maker (`maker` set) replaces the one made before from the same character. */
export async function addMod(file: File, maker?: string): Promise<ModInfo> {
  const { pack, files } = await unpackMod(file);
  if (!pack?.name) throw new Error('character.json has no character name.');
  const script = scriptFile(pack);
  if (script && !files.has(script)) throw new Error(`${pack.name} has a gimmick script but no ${script}. Export it again from the mod maker.`);
  const id = (await hashFiles(files)).slice(0, 16);
  const all = await modRecords();
  const same = all.find((m) => m.id === id);
  if (same && !maker) throw new Error(`${pack.name} is already added.`);
  if (maker) for (const m of all) if (m.maker === maker && m.id !== id) await tx('readwrite', (s) => s.delete(m.id));
  // The player's own mod from the mod maker runs its script. A zip from anywhere else waits for the player to turn it on.
  const rec: ModRecord = same
    ? { ...same, enabled: true, maker, scriptAllowed: same.scriptAllowed || !!maker }
    : { id, name: pack.name, file: file.name, enabled: true, added: Date.now(), hasScript: !!script, scriptAllowed: !!script && !!maker, zip: file, maker };
  await tx('readwrite', (s) => s.put(rec));
  return info(rec);
}

export async function setModEnabled(id: string, enabled: boolean): Promise<void> {
  const rec = (await modRecords()).find((m) => m.id === id);
  if (rec) await tx('readwrite', (s) => s.put({ ...rec, enabled }));
}

export async function setModScriptAllowed(id: string, scriptAllowed: boolean): Promise<void> {
  const rec = (await modRecords()).find((m) => m.id === id);
  if (rec) await tx('readwrite', (s) => s.put({ ...rec, scriptAllowed }));
}

/** The source of a mod's gimmick script, for the player to read before turning it on. */
export async function modScript(id: string): Promise<string | null> {
  const rec = (await modRecords()).find((m) => m.id === id);
  if (!rec) return null;
  const { pack, files } = await unpackMod(rec.zip);
  const script = scriptFile(pack);
  return script && files.has(script) ? new TextDecoder().decode(files.get(script)) : null;
}

export async function deleteMod(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}
