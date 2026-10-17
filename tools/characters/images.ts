// Reads an image's pixel size without decoding it (PNG from its header, SVG from its root element),
// and a PNG's alpha channel for touch masks.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { packMask, type Mask } from '../../src/game/pack-build.ts';

/** The touch mask of an 8-bit, non-interlaced PNG (any color type), or null for other PNGs. */
export function pngMask(file: string): Mask | null {
  const buf = fs.readFileSync(file);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const depth = buf[24];
  const type = buf[25];
  if (depth !== 8 || buf[28] !== 0) return null;
  const idat: Buffer[] = [];
  let trns: Buffer | null = null;
  for (let p = 8; p < buf.length; ) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString('latin1', p + 4, p + 8);
    if (kind === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    if (kind === 'tRNS') trns = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6];
  if (!channels) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = new Uint8Array(stride * h);
  // Undo the per-row filters (none, sub, up, average, Paeth).
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (v + pred) & 255;
    }
  }
  const opaque = (i: number): boolean => {
    if (type === 6) return px[i * 4 + 3] > 0;
    if (type === 4) return px[i * 2 + 1] > 0;
    if (type === 3) return !trns || (trns[px[i]] ?? 255) > 0;
    return true;
  };
  return packMask(w, h, opaque);
}

export interface ImageSize {
  kind: 'bitmap' | 'svg';
  width: number;
  height: number;
}

export function imageSize(file: string): ImageSize {
  const buf = fs.readFileSync(file);
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { kind: 'bitmap', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  const text = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  const root = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (root) {
    const attr = (n: string) => {
      const v = new RegExp(`\\s${n}="([\\d.]+)`).exec(root)?.[1];
      return v === undefined ? NaN : Number(v);
    };
    let width = attr('width');
    let height = attr('height');
    const vb = /viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(root);
    if (Number.isNaN(width) && vb) width = Number(vb[1]);
    if (Number.isNaN(height) && vb) height = Number(vb[2]);
    if (!Number.isNaN(width) && !Number.isNaN(height)) return { kind: 'svg', width, height };
  }
  throw new Error(`${file} is not a PNG or an SVG with a size`);
}
