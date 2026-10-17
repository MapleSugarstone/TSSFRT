// Moving one animation in and out of the editor: a zip of its frame images with an animation.json that
// keeps names, speeds and centers, or a set of plain image files.
import JSZip from 'jszip';
import type { Frame } from '../../../src/game/pack-format.ts';
import { api, bumpVersion, fileUrl, h, loadImage, pad2, randomId } from './util.ts';

export interface AnimationFrame {
  name: string;
  speed: number;
  center: [number, number];
  resolution: number;
  blob: Blob;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');

export async function downloadAnimation(name: string, frames: AnimationFrame[]): Promise<void> {
  const zip = new JSZip();
  const meta = frames.map((f, i) => {
    const file = `${pad2(i + 1)}-${safe(f.name || name)}${f.blob.type === 'image/svg+xml' ? '.svg' : '.png'}`;
    zip.file(file, f.blob);
    return { file, name: f.name, speed: f.speed, center: f.center, resolution: f.resolution };
  });
  zip.file('animation.json', `${JSON.stringify({ format: 1, name, frames: meta }, null, 2)}\n`);
  const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
  h('a', { href: url, download: `${safe(name)}.zip` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Downloads frames that are already in a pack. */
export async function downloadPackFrames(dir: string, name: string, frames: Frame[]): Promise<void> {
  const out = await Promise.all(
    frames.map(async (f) => ({ name: f.name ?? name, speed: f.speed, center: f.center, resolution: f.resolution, blob: await (await fetch(fileUrl(dir, f.file))).blob() })),
  );
  await downloadAnimation(name, out);
}

/** Frames from an exported zip, or one frame per image file in file name order (centered, at the game's resolution). */
export async function readAnimation(files: File[], speed: number): Promise<AnimationFrame[]> {
  const zipFile = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
  if (zipFile) {
    const zip = await JSZip.loadAsync(zipFile);
    const metaFile = zip.file('animation.json');
    if (metaFile) {
      const meta = JSON.parse(await metaFile.async('string')) as { frames: (Omit<AnimationFrame, 'blob'> & { file: string })[] };
      return Promise.all(meta.frames.map(async (f) => ({ ...f, blob: await zip.file(f.file)!.async('blob') })));
    }
    const images = Object.values(zip.files).filter((f) => !f.dir && /\.(png|svg)$/i.test(f.name));
    files = await Promise.all(images.map(async (f) => new File([await f.async('blob')], f.name.split('/').pop()!, { type: f.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png' })));
  }
  const images = files.filter((f) => /\.(png|svg)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return Promise.all(
    images.map(async (f) => {
      const url = URL.createObjectURL(f);
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      const svg = f.name.toLowerCase().endsWith('.svg');
      return { name: '', speed, center: [img.naturalWidth / 2, img.naturalHeight / 2] as [number, number], resolution: svg ? 1 : 2, blob: f };
    }),
  );
}

/** Writes imported frames into a pack folder and returns them as pack frames. */
export async function writeImported(dir: string, folder: string, frames: AnimationFrame[], name: (f: AnimationFrame, i: number) => string): Promise<Frame[]> {
  const id = randomId();
  const out: Frame[] = [];
  for (const [i, f] of frames.entries()) {
    const file = `${folder}/${id}-${pad2(i + 1)}${f.resolution === 1 ? '.svg' : '.png'}`;
    await api.put(dir, file, f.blob);
    out.push({ name: name(f, i), file, speed: f.speed, center: f.center, resolution: f.resolution });
  }
  bumpVersion();
  return out;
}
