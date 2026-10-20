// Saved replays, kept in this browser (IndexedDB). The list and the recordings are separate stores,
// so the Replays screen reads only the short entries. A recording is stored gzipped.
import type { FinishedReplay, ReplayBody, ReplayMeta } from './replay.ts';

const DB = 'sfrt-replays';
const META = 'meta';
const DATA = 'data';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(META, { keyPath: 'id' });
      r.result.createObjectStore(DATA);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function gzip(text: string): Promise<Blob> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

async function gunzip(blob: Blob): Promise<string> {
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

export async function saveReplay(r: FinishedReplay): Promise<ReplayMeta> {
  const meta: ReplayMeta = { id: crypto.randomUUID(), saved: Date.now(), ...r.meta };
  const blob = await gzip(JSON.stringify(r.body));
  const d = await db();
  const t = d.transaction([META, DATA], 'readwrite');
  t.objectStore(META).put(meta);
  t.objectStore(DATA).put(blob, meta.id);
  await done(t);
  return meta;
}

/** Saved replays, newest first. */
export async function listReplays(): Promise<ReplayMeta[]> {
  try {
    const d = await db();
    const all = await request(d.transaction(META, 'readonly').objectStore(META).getAll() as IDBRequest<ReplayMeta[]>);
    return all.sort((a, b) => b.saved - a.saved);
  } catch {
    return [];
  }
}

export async function loadReplay(id: string): Promise<{ meta: ReplayMeta; body: ReplayBody } | null> {
  const d = await db();
  const t = d.transaction([META, DATA], 'readonly');
  const [meta, blob] = await Promise.all([request(t.objectStore(META).get(id) as IDBRequest<ReplayMeta | undefined>), request(t.objectStore(DATA).get(id) as IDBRequest<Blob | undefined>)]);
  if (!meta || !blob) return null;
  return { meta, body: JSON.parse(await gunzip(blob)) as ReplayBody };
}

/** Gives a replay a name, or takes it away when `name` is empty. */
export async function renameReplay(id: string, name: string): Promise<void> {
  const d = await db();
  const t = d.transaction(META, 'readwrite');
  const store = t.objectStore(META);
  const meta = await request(store.get(id) as IDBRequest<ReplayMeta | undefined>);
  if (!meta) return;
  if (name) meta.name = name;
  else delete meta.name;
  store.put(meta);
  await done(t);
}

export async function deleteReplay(id: string): Promise<void> {
  const d = await db();
  const t = d.transaction([META, DATA], 'readwrite');
  t.objectStore(META).delete(id);
  t.objectStore(DATA).delete(id);
  await done(t);
}
