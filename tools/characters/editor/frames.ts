// Animation slots and paint documents. A slot is the action an animation plays for: the fighter
// engine plays the frames whose names start with the action, so a frame belongs to the longest
// action its name starts with when the rest of the name is only a frame number or NL.
import { ANIMATION_STATES, type Frame, type Image } from '../../../src/game/pack-format.ts';
import type { PaintDocJson, PaintOutput, SourceFrame } from './paint.ts';
import { api, bumpVersion, fileUrl, pad2, randomId } from './util.ts';

const FRAME_SUFFIX = /^(?:NL|\d|-)*$/i;

/** The slot of a frame name, given the slot names already known. */
export function slotOf(name: string, known: string[]): string {
  const lower = name.toLowerCase();
  let best = '';
  for (const k of known) if (k.length > best.length && lower.startsWith(k.toLowerCase()) && FRAME_SUFFIX.test(name.slice(k.length))) best = k;
  return best || name.replace(/(?:NL\d*|-\d+|\d+)$/i, '') || name;
}

export interface Group {
  slot: string;
  frames: Frame[];
}

/** Frames grouped by slot, in order of each slot's first frame. */
export function groupFrames(frames: Frame[], known: string[]): Group[] {
  const out: Group[] = [];
  for (const f of frames) {
    const slot = slotOf(f.name ?? '', known);
    const g = out.find((x) => x.slot.toLowerCase() === slot.toLowerCase());
    if (g) g.frames.push(f);
    else out.push({ slot, frames: [f] });
  }
  return out;
}

export const knownSlots = (extra: string[] = []) => [...new Set([...ANIMATION_STATES, ...extra])];

/** A frame name moved from one slot to another, keeping its frame number and NL. */
export function renameFrame(name: string, from: string, to: string): string {
  return name.toLowerCase().startsWith(from.toLowerCase()) ? to + name.slice(from.length) : `${to}${name}`;
}

export function sources(dir: string, frames: (Frame | Image)[], slot: string): SourceFrame[] {
  return frames.map((f, i) => ({
    url: fileUrl(dir, f.file),
    center: f.center,
    resolution: f.resolution,
    speed: 'speed' in f ? f.speed : 5,
    name: ('name' in f && f.name) || `${slot}${i + 1}`,
  }));
}

/** The layered document these frames were painted from, if it still matches them. */
export async function findDoc(dir: string, files: string[]): Promise<PaintDocJson | null> {
  const id = /([a-z0-9]{8})-\d+\.png$/.exec(files[0] ?? '')?.[1];
  if (!id) return null;
  const text = await api.text(dir, `paint/${id}.json`);
  if (!text) return null;
  const doc = JSON.parse(text) as PaintDocJson;
  return doc.files.join('\n') === files.join('\n') ? doc : null;
}

/** Writes painted frames into a pack folder (new file names each time) with their paint document. */
export async function writeFrames(dir: string, folder: string, out: PaintOutput): Promise<Frame[]> {
  const id = randomId();
  const frames: Frame[] = [];
  for (const [i, f] of out.frames.entries()) {
    const file = `${folder}/${id}-${pad2(i + 1)}.png`;
    await api.put(dir, file, f.blob);
    frames.push({ name: f.name, file, speed: f.speed, center: f.center, resolution: 2 });
  }
  await api.put(dir, `paint/${id}.json`, JSON.stringify({ ...out.doc, files: frames.map((f) => f.file) }));
  bumpVersion();
  return frames;
}

/** A folder-safe form of a slot or move name. */
export const folderName = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
