// The mod maker's store on the published site: packs kept in this browser (IndexedDB), started from the
// original characters and examples the site publishes (tools/characters/site-files.ts). Play adds a pack
// to the Mods screen's store, the same one a player's uploaded zips go to.
import JSZip from 'jszip';
import { addMod, unpackMod } from '../../../src/client/mod-store.ts';
import { CHARACTER_FILE, type CharacterPack } from '../../../src/game/pack-format.ts';
import { checkPack, type Problem } from '../../../src/game/pack-validate.ts';
import { INDEX_FILE, SLUG, STARTER_GIMMICK_JS, slugify, unusedFiles, type SiteCharacter, type SiteIndex } from '../pack-files.ts';
import type { Store } from './util.ts';

interface PackRow {
  slug: string;
  pack: CharacterPack;
  updated: number;
}

interface FileRow {
  slug: string;
  path: string;
  blob: Blob;
}

const DB = 'sfrt-mod-maker';
const TYPES: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', json: 'application/json', js: 'text/javascript' };
const typed = (data: BlobPart, path: string) => new Blob([data], { type: TYPES[path.split('.').pop()!.toLowerCase()] ?? '' });

let dbOpen: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbOpen ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('packs', { keyPath: 'slug' });
      r.result.createObjectStore('files', { keyPath: ['slug', 'path'] });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error(`This browser cannot keep characters: ${r.error?.message ?? 'storage is blocked'}`));
  }));
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const read = async (name: 'packs' | 'files') => (await db()).transaction(name, 'readonly').objectStore(name);

/** Runs writes to both stores in one transaction. */
async function write(fn: (packs: IDBObjectStore, files: IDBObjectStore) => void): Promise<void> {
  const t = (await db()).transaction(['packs', 'files'], 'readwrite');
  fn(t.objectStore('packs'), t.objectStore('files'));
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('the browser did not save the change'));
  });
}

/** Every file key of one pack: arrays sort after strings, so [slug, []] is past its last path. */
const filesOf = (slug: string) => IDBKeyRange.bound([slug], [slug, []]);

async function packRow(slug: string): Promise<PackRow> {
  const row = (await req((await read('packs')).get(slug))) as PackRow | undefined;
  if (!row) throw new Error('no such character');
  return row;
}

let index: SiteIndex | null = null;
let indexLoad: Promise<SiteIndex> | null = null;
function siteIndex(): Promise<SiteIndex> {
  return (indexLoad ??= fetch(INDEX_FILE)
    .then((r) => {
      if (!r.ok) throw new Error(`could not load the original characters (${r.status})`);
      return r.json() as Promise<SiteIndex>;
    })
    .then((v) => (index = v)));
}

/** The original character or example a folder names, or null for a pack in this browser. */
async function siteCharacter(dir: string): Promise<SiteCharacter | null> {
  const m = /^_(templates|examples)\/(.+)$/.exec(dir);
  if (!m) return null;
  const idx = await siteIndex();
  const c = (m[1] === 'templates' ? idx.templates : idx.examples).find((x) => x.slug === m[2]);
  if (!c) throw new Error('no such character');
  return c;
}

const fetchBlob = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not load ${url}`);
  return r.blob();
};

/** The open pack's files, with a URL for each, so images can show without waiting. */
let cache: { slug: string; files: Map<string, { blob: Blob; url: string }> } | null = null;

async function load(slug: string): Promise<Map<string, { blob: Blob; url: string }>> {
  if (cache?.slug === slug) return cache.files;
  const rows = (await req((await read('files')).getAll(filesOf(slug)))) as FileRow[];
  if (cache) for (const f of cache.files.values()) URL.revokeObjectURL(f.url);
  cache = { slug, files: new Map(rows.map((r) => [r.path, { blob: r.blob, url: URL.createObjectURL(r.blob) }])) };
  return cache.files;
}

function cachePut(slug: string, path: string, blob: Blob): void {
  if (cache?.slug === slug) cache.files.set(path, { blob, url: URL.createObjectURL(blob) });
}

/** Why a gimmick script does not load, or null when it does. */
async function scriptError(code: string): Promise<string | null> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    const m = (await import(/* @vite-ignore */ url)) as { default?: unknown };
    return m.default && typeof m.default === 'object' ? null : 'it has no default export';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function problems(pack: CharacterPack, exists: (file: string) => boolean, text: (file: string) => Promise<string>): Promise<Problem[]> {
  const out = checkPack(
    pack,
    exists,
    (await siteIndex()).templates.map((t) => t.name),
  );
  if (pack.gimmick && exists(pack.gimmick)) {
    if (!/\.js$/i.test(pack.gimmick)) out.push({ level: 'error', message: `gimmick script ${pack.gimmick}: the mod maker on the site runs JavaScript, so the script must be a .js file` });
    else {
      const err = await scriptError(await text(pack.gimmick));
      if (err) out.push({ level: 'error', message: `gimmick script ${pack.gimmick} does not load: ${err}` });
    }
  }
  return out;
}

async function checkOwn(slug: string, pack: CharacterPack): Promise<Problem[]> {
  const files = await load(slug);
  return problems(pack, (f) => files.has(f), (f) => files.get(f)!.blob.text());
}

async function freeSlug(base: string): Promise<string> {
  const start = SLUG.test(base) ? base : 'character';
  const taken = new Set((await req((await read('packs')).getAllKeys())) as string[]);
  let slug = start;
  for (let n = 2; taken.has(slug); n++) slug = `${start}-${n}`;
  return slug;
}

function editable(dir: string): string {
  if (dir.startsWith('_')) throw new Error('The original characters and examples are read-only.');
  return dir;
}

async function zipOf(dir: string): Promise<File> {
  const slug = dir.split('/').pop()!;
  const zip = new JSZip();
  const c = await siteCharacter(dir);
  const pack = c ? c.pack : (await packRow(dir)).pack;
  zip.file(`${slug}/character.json`, `${JSON.stringify(pack, null, 2)}\n`);
  if (c) for (const [path, url] of Object.entries(c.files)) zip.file(`${slug}/${path}`, await fetchBlob(url));
  else for (const [path, f] of await load(dir)) zip.file(`${slug}/${path}`, f.blob);
  return new File([await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })], `${slug}${CHARACTER_FILE}`, { type: 'application/octet-stream' });
}

export const browserStore: Store = {
  browser: true,

  async list() {
    const idx = await siteIndex();
    const rows = (await req((await read('packs')).getAll())) as PackRow[];
    const brief = (c: SiteCharacter) => ({ slug: c.slug, name: c.name });
    return {
      packs: rows.map((r) => ({ slug: r.slug, name: r.pack.name, template: r.pack.template })).sort((a, b) => (a.slug < b.slug ? -1 : 1)),
      templates: idx.templates.map(brief),
      examples: idx.examples.map(brief),
    };
  },

  async pack(dir) {
    const c = await siteCharacter(dir);
    if (c) {
      const text = async (f: string) => (await fetchBlob(c.files[f])).text();
      return { pack: structuredClone(c.pack), problems: await problems(c.pack, (f) => f in c.files, text), readOnly: true };
    }
    const { pack } = await packRow(dir);
    return { pack, problems: await checkOwn(dir, pack), readOnly: false };
  },

  async save(dir, pack) {
    const slug = editable(dir);
    await write((packs) => packs.put({ slug, pack, updated: Date.now() } satisfies PackRow));
    return { problems: await checkOwn(slug, pack) };
  },

  async create(name, slug, from) {
    slug = await freeSlug(slug);
    const c = await siteCharacter(from);
    let pack: CharacterPack;
    let rows: FileRow[];
    if (c) {
      pack = structuredClone(c.pack);
      // Moves start the same as the original's, so only the ones a user customizes get copies.
      const skip = from.startsWith('_templates/') ? /^(moves|sounds)\// : null;
      if (skip) pack.moves = {};
      const entries = Object.entries(c.files).filter(([path]) => !skip?.test(path));
      rows = await Promise.all(entries.map(async ([path, url]) => ({ slug, path, blob: typed(await fetchBlob(url), path) })));
    } else {
      pack = (await packRow(from)).pack;
      rows = ((await req((await read('files')).getAll(filesOf(from)))) as FileRow[]).map((r) => ({ ...r, slug }));
    }
    pack.name = name;
    await write((packs, files) => {
      for (const r of rows) files.put(r);
      packs.put({ slug, pack, updated: Date.now() } satisfies PackRow);
    });
    // Without this the browser may clear its storage when the disk runs low.
    void navigator.storage?.persist?.()?.catch(() => false);
    return { slug };
  },

  async remove(dir) {
    const slug = editable(dir);
    await write((packs, files) => {
      packs.delete(slug);
      files.delete(filesOf(slug));
    });
    if (cache?.slug === slug) cache = null;
  },

  async put(dir, path, data) {
    const slug = editable(dir);
    if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`bad file path "${path}"`);
    const blob = typed(data, path);
    await write((_packs, files) => files.put({ slug, path, blob } satisfies FileRow));
    cachePut(slug, path, blob);
    return { ok: true };
  },

  async exists(dir, path) {
    const c = await siteCharacter(dir);
    return c ? path in c.files : (await load(dir)).has(path);
  },

  async text(dir, path) {
    const c = await siteCharacter(dir);
    if (c) return path in c.files ? (await fetchBlob(c.files[path])).text() : null;
    return (await load(dir)).get(path)?.blob.text() ?? null;
  },

  fileUrl(dir, path) {
    if (dir.startsWith('_')) {
      const [kind, slug] = dir.split('/');
      return (kind === '_templates' ? index?.templates : index?.examples)?.find((c) => c.slug === slug)?.files[path] ?? '';
    }
    return cache?.slug === dir ? (cache.files.get(path)?.url ?? '') : '';
  },

  changed() {},

  async gimmick(dir) {
    const file = 'gimmick.js';
    if (!(await browserStore.exists(dir, file))) await browserStore.put(dir, file, STARTER_GIMMICK_JS);
    return { file, path: file };
  },

  async unused(dir, remove) {
    const c = await siteCharacter(dir);
    if (c) return { files: unusedFiles(c.pack, Object.keys(c.files)) };
    const slug = dir;
    const { pack } = await packRow(slug);
    const files = await load(slug);
    const out = unusedFiles(pack, [...files.keys()]);
    if (remove) {
      await write((_packs, store) => {
        for (const f of out) store.delete([slug, f]);
      });
      for (const f of out) files.delete(f);
    }
    return { files: out };
  },

  async importZip(file) {
    const { pack, files } = await unpackMod(file);
    if (!pack?.name) throw new Error('character.json has no character name.');
    if (pack.gimmick && /\.ts$/i.test(pack.gimmick)) {
      // A zip from the project's mod maker carries its TypeScript script compiled to JavaScript too.
      const js = pack.gimmick.replace(/\.ts$/i, '.js');
      if (!files.has(js)) throw new Error(`${pack.name} has a TypeScript gimmick script and no ${js}. Export it from the mod maker again.`);
      files.delete(pack.gimmick);
      pack.gimmick = js;
    }
    const slug = await freeSlug(slugify(pack.name));
    await write((packs, store) => {
      for (const [path, data] of files) if (path !== 'character.json') store.put({ slug, path, blob: typed(data as Uint8Array<ArrayBuffer>, path) } satisfies FileRow);
      packs.put({ slug, pack, updated: Date.now() } satisfies PackRow);
    });
    return { slug };
  },

  async exportZip(dir) {
    const file = await zipOf(dir);
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  async play(dir) {
    const { pack } = await packRow(dir);
    const errors = (await checkOwn(dir, pack)).filter((p) => p.level === 'error');
    if (errors.length) return { ok: false, output: errors.map((p) => `error: ${p.message}`).join('\n') };
    await addMod(await zipOf(dir), dir);
    return { ok: true, output: `Added ${pack.name} to the Mods list in this browser, turned on.` };
  },
};
