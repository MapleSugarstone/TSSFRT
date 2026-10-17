// A pixel paint editor for a pack's frames. Layers are shared by every frame, and each frame has one
// cel per layer. Selections move, flip and rotate with nearest-neighbor sampling. Saving flattens the
// visible layers of each frame, crops it, and keeps the layered document in the pack's paint folder.
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, Crosshair, Download, Eraser, Expand, FilePlus, FlipHorizontal2, FlipVertical2, ImagePlus, Images, Merge, Move, PaintBucket, Pencil, Pipette, Play, Plus, RotateCcw, RotateCw, Save, Shrink, Square, SquareDashed, Trash2, Wand, X, type IconNode } from 'lucide';
import { downloadAnimation } from './export.ts';
import { closeReference, toggleReference } from './reference.ts';
import { canvas, ctx2d, field, fill, frameTicks, FRAME_MS, h, loadImage, pickFile, speedSelect, toBlob, icon, setButton } from './util.ts';

export interface SourceFrame {
  url: string | null;
  center: [number, number];
  resolution: number;
  speed: number;
  name: string;
}

export interface PaintDocJson {
  format: 1;
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** Image pixels per art pixel: the document is drawn at the art's own resolution and scaled up on save. */
  scale: number;
  layers: Layer[];
  frames: { cels: (string | null)[]; speed: number; name: string; shift: [number, number] }[];
  /** The frame files this document was saved as, to tell whether it still matches the pack. */
  files: string[];
}

export interface PaintOutput {
  frames: { blob: Blob; center: [number, number]; speed: number; name: string }[];
  doc: Omit<PaintDocJson, 'files'>;
}

export interface PaintOptions {
  title: string;
  frames: SourceFrame[];
  doc: PaintDocJson | null;
  /** One frame only (menu and match art). */
  single?: boolean;
  /** Name for new frames, followed by a number. */
  slot: string;
  /** A frame to show faintly behind the drawing, with its center moved by `offset` pixels from this one's. */
  reference?: (SourceFrame & { offset?: [number, number] }) | null;
  onSave(out: PaintOutput): Promise<void>;
}

interface Layer {
  name: string;
  visible: boolean;
  opacity: number;
}

interface PFrame {
  cels: ImageData[];
  speed: number;
  name: string;
  /** Image pixels the frame's art pixel grid starts at, so imported frames keep their exact place. */
  shift: [number, number];
}

interface Snapshot {
  k: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  layers: Layer[];
  frames: PFrame[];
  cur: number;
  layer: number;
}

interface Floating {
  src: ImageData;
  /** Where the lifted pixels came from, to put them back on cancel, or null for pasted pixels. */
  from: [number, number] | null;
  cx: number;
  cy: number;
  angle: number;
}

type Tool = 'pencil' | 'eraser' | 'fill' | 'wand' | 'rect' | 'move' | 'center' | 'pick';
type RGBA = [number, number, number, number];

const TOOLS: [Tool, string, string, IconNode][] = [
  ['pencil', 'Pencil', 'B', Pencil],
  ['eraser', 'Eraser', 'E', Eraser],
  ['fill', 'Fill', 'G', PaintBucket],
  ['pick', 'Pick color', 'I', Pipette],
  ['rect', 'Select box', 'M', SquareDashed],
  ['wand', 'Select color', 'W', Wand],
  ['move', 'Move', 'V', Move],
  ['center', 'Set center', 'C', Crosshair],
];
const UNDO_BYTES = 96 * 1024 * 1024;
const HOLD_PREVIEW_TICKS = 10;

const blank = (w: number, h: number) => new ImageData(w, h);
const copyImage = (img: ImageData) => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
const hex = (c: RGBA) => `#${c
  .slice(0, 3)
  .map((v) => v.toString(16).padStart(2, '0'))
  .join('')}`;
const fromHex = (s: string, a: number): RGBA => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), a];

async function imageDataFromUrl(url: string, w: number, h0: number, x = 0, y = 0, scale = 1): Promise<ImageData> {
  const img = await loadImage(url);
  const c = canvas(w, h0);
  const g = ctx2d(c);
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, img.naturalWidth * scale, img.naturalHeight * scale);
  return g.getImageData(0, 0, w, h0);
}

/** Bounds of the pixels with any alpha, or null when the image is empty. */
function opaqueBounds(img: ImageData): [number, number, number, number] | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

const SCALES = [8, 6, 5, 4, 3, 2];
/** Share of blocks allowed to hold more than one color when detecting the art pixel size. */
const ODD_BLOCKS = 0.02;

/** Pixels as 32-bit values, with every fully transparent pixel as 0. */
function pixels(img: ImageData): Uint32Array {
  const p = new Uint32Array(img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.width * img.height * 4));
  for (let i = 0; i < p.length; i++) if (!(p[i] >>> 24)) p[i] = 0;
  return p;
}

/** Where a grid of k x k blocks of one color lines up with the image, or null when it is not made of them. */
function blockPhase(img: ImageData, k: number): [number, number] | null {
  const p = pixels(img);
  const { width: w, height: hh } = img;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= hh ? 0 : p[y * w + x]);
  let opaque = 0;
  for (const v of p) if (v) opaque++;
  if (!opaque) return [0, 0];
  const allowed = Math.max(1, Math.floor((opaque / (k * k)) * ODD_BLOCKS));
  for (let py = 0; py < k; py++)
    for (let px = 0; px < k; px++) {
      let bad = 0;
      for (let by = py - k; by < hh && bad <= allowed; by += k)
        for (let bx = px - k; bx < w && bad <= allowed; bx += k) {
          const c = at(bx, by);
          let odd = false;
          for (let dy = 0; dy < k && !odd; dy++) for (let dx = 0; dx < k && !odd; dx++) if (at(bx + dx, by + dy) !== c) odd = true;
          if (odd) bad++;
        }
      if (bad <= allowed) return [px, py];
    }
  return null;
}

/** The largest art pixel size every image is drawn at, and where each image's blocks line up. */
function detectScale(imgs: (ImageData | null)[]): { k: number; phases: [number, number][] } {
  for (const k of SCALES) {
    const phases = imgs.map((img) => (img ? blockPhase(img, k) : [0, 0]));
    if (phases.every((ph) => ph)) return { k, phases: phases as [number, number][] };
  }
  return { k: 1, phases: imgs.map(() => [0, 0]) };
}

/** A W x H art pixel image from an image whose left edge sits `dx` image pixels right of the art grid. */
function downsample(img: ImageData, k: number, W: number, H: number, dx: number, dy: number): ImageData {
  const p = pixels(img);
  const out = blank(W, H);
  const o = new Uint32Array(out.data.buffer);
  const counts = new Map<number, number>();
  for (let ay = 0; ay < H; ay++)
    for (let ax = 0; ax < W; ax++) {
      counts.clear();
      let best = 0;
      let bestN = 0;
      for (let y = ay * k - dy; y < ay * k - dy + k; y++)
        for (let x = ax * k - dx; x < ax * k - dx + k; x++) {
          const v = x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : p[y * img.width + x];
          const n = (counts.get(v) ?? 0) + 1;
          counts.set(v, n);
          if (n > bestN) (best = v), (bestN = n);
        }
      o[ay * W + ax] = best;
    }
  return out;
}

/** An image drawn with nearest-neighbor scaling. */
function raster(img: CanvasImageSource, w: number, h0: number, x = 0, y = 0, dw = w, dh = h0): ImageData {
  const c = canvas(w, h0);
  const g = ctx2d(c);
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, dw, dh);
  return g.getImageData(0, 0, w, h0);
}

const mod = (a: number, k: number) => ((a % k) + k) % k;

/** Rotates clockwise by `deg` around the image center, sampling the nearest source pixel. */
function rotateNearest(src: ImageData, deg: number): ImageData {
  const a = (deg * Math.PI) / 180;
  const snap = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-9 ? Math.sign(v) : v);
  const cos = snap(Math.cos(a));
  const sin = snap(Math.sin(a));
  const w = src.width;
  const hh = src.height;
  const W = Math.max(1, Math.ceil(Math.abs(w * cos) + Math.abs(hh * sin) - 1e-6));
  const H = Math.max(1, Math.ceil(Math.abs(w * sin) + Math.abs(hh * cos) - 1e-6));
  const out = blank(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2;
      const dy = y + 0.5 - H / 2;
      const sx = Math.floor(dx * cos + dy * sin + w / 2);
      const sy = Math.floor(-dx * sin + dy * cos + hh / 2);
      if (sx < 0 || sy < 0 || sx >= w || sy >= hh) continue;
      const si = (sy * w + sx) * 4;
      out.data.set(src.data.subarray(si, si + 4), (y * W + x) * 4);
    }
  return out;
}

export async function openPaint(opts: PaintOptions): Promise<void> {
  const p = new Paint(opts);
  await p.load();
  p.mount();
}

class Paint {
  /** Image pixels per art pixel. */
  k = 1;
  w = 64;
  h = 64;
  ox = 32;
  oy = 32;
  layers: Layer[] = [{ name: 'Layer 1', visible: true, opacity: 1 }];
  frames: PFrame[] = [];
  cur = 0;
  layer = 0;
  tool: Tool = 'pencil';
  color: RGBA = [255, 255, 255, 255];
  size = 1;
  zoom = 8;
  grid = true;
  sel: Uint8Array | null = null;
  float: Floating | null = null;
  floatCache: { angle: number; src: ImageData; img: ImageData; cv: HTMLCanvasElement } | null = null;
  clipboard: ImageData | null = null;
  contiguous = true;
  onion = { on: true, prev: 1, next: 1, prevColor: '#ff5a6e', nextColor: '#4aa8ff', opacity: 0.35 };
  undoStack: Snapshot[] = [];
  redoStack: Snapshot[] = [];
  last: [number, number] | null = null;
  hover: [number, number] | null = null;
  drag: { kind: 'paint' | 'rect' | 'move'; x0: number; y0: number; cx0?: number; cy0?: number; add?: boolean } | null = null;
  rectPreview: [number, number, number, number] | null = null;
  playing = 0;
  dirty = false;
  recent: RGBA[] = [];
  palette: RGBA[] = [];
  reference: { img: HTMLImageElement; cx: number; cy: number; scale: number; offset: [number, number] } | null = null;
  showReference = true;

  root!: HTMLDivElement;
  view!: HTMLCanvasElement;
  scroller!: HTMLDivElement;
  status!: HTMLDivElement;
  side!: HTMLDivElement;
  strip!: HTMLDivElement;
  toolbar!: HTMLDivElement;
  layerCache: HTMLCanvasElement[] = [];
  layerDirty = new Set<number>();
  onionCache = new Map<string, HTMLCanvasElement>();
  keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(readonly opts: PaintOptions) {}

  // Loading and saving

  async load(): Promise<void> {
    const { doc, frames } = this.opts;
    const ref = this.opts.reference;
    if (ref?.url) this.reference = { img: await loadImage(ref.url), cx: ref.center[0], cy: ref.center[1], scale: 2 / (ref.resolution || 2), offset: ref.offset ?? [0, 0] };
    if (doc) {
      Object.assign(this, { k: doc.scale ?? 1, w: doc.w, h: doc.h, ox: doc.ox, oy: doc.oy });
      this.layers = doc.layers.map((l) => ({ ...l }));
      this.frames = await Promise.all(
        doc.frames.map(async (f) => ({
          speed: f.speed,
          name: f.name,
          shift: f.shift ?? [0, 0],
          cels: await Promise.all(this.layers.map((_, i) => (f.cels[i] ? imageDataFromUrl(f.cels[i]!, doc.w, doc.h) : blank(doc.w, doc.h)))),
        })),
      );
    } else if (frames.length) {
      // Frames come in at the game's image resolution and go into the document at their art pixel size.
      const imgs = await Promise.all(
        frames.map(async (f) => {
          if (!f.url) return null;
          const img = await loadImage(f.url);
          const s = 2 / (f.resolution || 2);
          const w = Math.max(1, Math.round(img.naturalWidth * s));
          const hh = Math.max(1, Math.round(img.naturalHeight * s));
          return { data: raster(img, w, hh), cx: f.center[0] * s, cy: f.center[1] * s };
        }),
      );
      const { k, phases } = detectScale(imgs.map((i) => i?.data ?? null));
      const pad = this.opts.single ? 0 : Math.ceil(16 / k);
      let left = 0;
      let top = 0;
      let right = 0;
      let bottom = 0;
      for (const i of imgs) {
        if (!i) continue;
        left = Math.max(left, Math.ceil(i.cx));
        top = Math.max(top, Math.ceil(i.cy));
        right = Math.max(right, Math.ceil(i.data.width - i.cx));
        bottom = Math.max(bottom, Math.ceil(i.data.height - i.cy));
      }
      const OX = left + pad * k;
      const OY = top + pad * k;
      this.k = k;
      this.w = Math.max(4, Math.ceil((OX + right) / k) + pad + 1);
      this.h = Math.max(4, Math.ceil((OY + bottom) / k) + pad + 1);
      this.ox = OX / k;
      this.oy = OY / k;
      this.frames = frames.map((f, i) => {
        const im = imgs[i];
        if (!im) return { speed: f.speed, name: f.name, shift: [0, 0], cels: [blank(this.w, this.h)] };
        const fx = Math.round(OX - im.cx);
        const fy = Math.round(OY - im.cy);
        const sx = mod(fx + phases[i][0], k);
        const sy = mod(fy + phases[i][1], k);
        return { speed: f.speed, name: f.name, shift: [sx, sy], cels: [downsample(im.data, k, this.w, this.h, fx - sx, fy - sy)] };
      });
    } else {
      const r = this.reference;
      this.k = r ? detectScale([raster(r.img, Math.round(r.img.naturalWidth * r.scale), Math.round(r.img.naturalHeight * r.scale))]).k : 1;
      this.w = this.h = Math.ceil(64 / this.k);
      this.ox = this.oy = Math.floor(this.w / 2);
    }
    if (!this.frames.length) this.frames = [{ speed: 5, name: this.newName(), shift: [0, 0], cels: [blank(this.w, this.h)] }];
    this.buildPalette();
  }

  newName(): string {
    const names = new Set(this.frames.map((f) => f.name));
    let n = this.frames.length + 1;
    while (names.has(`${this.opts.slot}${n}`)) n++;
    return `${this.opts.slot}${n}`;
  }

  flatten(i: number, visibleOnly = true): HTMLCanvasElement {
    const c = canvas(this.w, this.h);
    const g = ctx2d(c);
    const tmp = canvas(this.w, this.h);
    const tg = ctx2d(tmp);
    this.layers.forEach((l, li) => {
      if (visibleOnly && !l.visible) return;
      tg.putImageData(this.frames[i].cels[li], 0, 0);
      g.globalAlpha = l.opacity;
      g.drawImage(tmp, 0, 0);
    });
    return c;
  }

  async save(): Promise<void> {
    this.commitFloat();
    const frames: PaintOutput['frames'] = [];
    const k = this.k;
    for (const [i, f] of this.frames.entries()) {
      const { crop, center } = this.exportFrame(i);
      frames.push({ blob: await toBlob(crop), center, speed: f.speed, name: f.name });
    }
    const celUrl = (img: ImageData) => {
      if (!opaqueBounds(img)) return null;
      const c = canvas(img.width, img.height);
      ctx2d(c).putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    };
    const doc = {
      format: 1 as const,
      scale: k,
      w: this.w,
      h: this.h,
      ox: this.ox,
      oy: this.oy,
      layers: this.layers.map((l) => ({ ...l })),
      frames: this.frames.map((f) => ({ speed: f.speed, name: f.name, shift: f.shift, cels: f.cels.map(celUrl) })),
    };
    await this.opts.onSave({ frames, doc });
    this.dirty = false;
  }

  /** A frame scaled up to the game's image resolution and cropped, with its center in that image. */
  exportFrame(i: number): { crop: HTMLCanvasElement; center: [number, number] } {
    const k = this.k;
    const flat = this.flatten(i);
    const fx = Math.floor(this.ox);
    const fy = Math.floor(this.oy);
    const [x0, y0, x1, y1] = opaqueBounds(ctx2d(flat).getImageData(0, 0, this.w, this.h)) ?? [fx, fy, fx + 1, fy + 1];
    const crop = canvas((x1 - x0) * k, (y1 - y0) * k);
    const g = ctx2d(crop);
    g.imageSmoothingEnabled = false;
    g.drawImage(flat, x0, y0, x1 - x0, y1 - y0, 0, 0, (x1 - x0) * k, (y1 - y0) * k);
    const [sx, sy] = this.frames[i].shift;
    return { crop, center: [this.ox * k - (x0 * k + sx), this.oy * k - (y0 * k + sy)] };
  }

  /** Changes the art pixel size, resampling every frame. */
  setScale(nk: number): void {
    if (nk === this.k || nk < 1) return;
    this.commitFloat();
    this.pushUndo();
    const k = this.k;
    const W = Math.ceil((this.w * k + k) / nk);
    const H = Math.ceil((this.h * k + k) / nk);
    for (const f of this.frames) {
      f.cels = f.cels.map((cel) => {
        const c = canvas(this.w, this.h);
        ctx2d(c).putImageData(cel, 0, 0);
        const up = raster(c, this.w * k + k, this.h * k + k, f.shift[0], f.shift[1], this.w * k, this.h * k);
        return downsample(up, nk, W, H, 0, 0);
      });
      f.shift = [0, 0];
    }
    this.ox = (this.ox * k) / nk;
    this.oy = (this.oy * k) / nk;
    this.w = W;
    this.h = H;
    this.k = nk;
    this.sel = null;
    this.invalidateAll();
    this.refreshAll();
  }

  // Undo

  snapshot(): Snapshot {
    return {
      k: this.k,
      w: this.w,
      h: this.h,
      ox: this.ox,
      oy: this.oy,
      layers: this.layers.map((l) => ({ ...l })),
      frames: this.frames.map((f) => ({ speed: f.speed, name: f.name, shift: [...f.shift] as [number, number], cels: f.cels.map(copyImage) })),
      cur: this.cur,
      layer: this.layer,
    };
  }

  restore(s: Snapshot): void {
    Object.assign(this, { k: s.k, w: s.w, h: s.h, ox: s.ox, oy: s.oy, layers: s.layers, frames: s.frames, cur: s.cur, layer: s.layer });
    this.sel = null;
    this.float = null;
    this.invalidateAll();
    this.refreshAll();
  }

  pushUndo(): void {
    this.undoStack.push(this.snapshot());
    this.redoStack = [];
    this.dirty = true;
    const size = (s: Snapshot) => s.frames.length * s.layers.length * s.w * s.h * 4;
    let total = this.undoStack.reduce((n, s) => n + size(s), 0);
    while (this.undoStack.length > 1 && total > UNDO_BYTES) total -= size(this.undoStack.shift()!);
  }

  undo(): void {
    if (this.float) return this.cancelFloat();
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }

  // Pixels

  get cel(): ImageData {
    return this.frames[this.cur].cels[this.layer];
  }

  touched(): void {
    this.layerDirty.add(this.layer);
    for (const k of [...this.onionCache.keys()]) if (k.startsWith(`${this.cur}|`)) this.onionCache.delete(k);
    this.dirty = true;
  }

  setPixel(img: ImageData, x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    if (this.sel && !this.sel[y * this.w + x]) return;
    img.data.set(c, (y * img.width + x) * 4);
  }

  dab(x: number, y: number): void {
    const c: RGBA = this.tool === 'eraser' ? [0, 0, 0, 0] : this.color;
    const off = Math.floor((this.size - 1) / 2);
    for (let dy = 0; dy < this.size; dy++) for (let dx = 0; dx < this.size; dx++) this.setPixel(this.cel, x - off + dx, y - off + dy, c);
  }

  line(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.dab(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Pixels of the same color as (x, y): connected ones, or all of them when `contiguous` is off. */
  region(img: ImageData, x: number, y: number, contiguous: boolean): Uint8Array {
    const { width: w, height: hh, data } = img;
    const out = new Uint8Array(w * hh);
    const at = (y * w + x) * 4;
    const same = (i: number) => data[i * 4] === data[at] && data[i * 4 + 1] === data[at + 1] && data[i * 4 + 2] === data[at + 2] && data[i * 4 + 3] === data[at + 3];
    if (!contiguous) {
      for (let i = 0; i < w * hh; i++) if (same(i)) out[i] = 1;
      return out;
    }
    const stack = [y * w + x];
    out[y * w + x] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const px = i % w;
      const py = (i - px) / w;
      const visit = (j: number) => {
        if (!out[j] && same(j)) {
          out[j] = 1;
          stack.push(j);
        }
      };
      if (px > 0) visit(i - 1);
      if (px < w - 1) visit(i + 1);
      if (py > 0) visit(i - w);
      if (py < hh - 1) visit(i + w);
    }
    return out;
  }

  fill(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (this.sel && !this.sel[y * this.w + x]) return;
    this.pushUndo();
    this.useColor();
    const mask = this.region(this.cel, x, y, true);
    for (let i = 0; i < mask.length; i++) if (mask[i] && (!this.sel || this.sel[i])) this.cel.data.set(this.color, i * 4);
    this.touched();
    this.render();
  }

  pick(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const d = ctx2d(this.flatten(this.cur)).getImageData(x, y, 1, 1).data;
    this.setColor([d[0], d[1], d[2], d[3]]);
  }

  setColor(c: RGBA): void {
    this.color = c;
    this.refreshTools();
  }

  /** Puts the current color first in the recent colors once something is drawn with it. */
  useColor(): void {
    const c = this.color;
    if (!c[3] || this.recent[0]?.join() === c.join()) return;
    this.recent = [c, ...this.recent.filter((r) => r.join() !== c.join())].slice(0, 16);
    this.refreshTools();
  }

  buildPalette(): void {
    const counts = new Map<string, number>();
    for (const f of this.frames)
      for (const cel of f.cels)
        for (let i = 0; i < cel.data.length; i += 4) {
          if (!cel.data[i + 3]) continue;
          const k = `${cel.data[i]},${cel.data[i + 1]},${cel.data[i + 2]},${cel.data[i + 3]}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
    this.palette = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 48)
      .map(([k]) => k.split(',').map(Number) as RGBA);
  }

  // Selection and floating pixels

  selectRect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const sel = add && this.sel ? this.sel : new Uint8Array(this.w * this.h);
    const [ax, bx] = [Math.max(0, Math.min(x0, x1)), Math.min(this.w - 1, Math.max(x0, x1))];
    const [ay, by] = [Math.max(0, Math.min(y0, y1)), Math.min(this.h - 1, Math.max(y0, y1))];
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) sel[y * this.w + x] = 1;
    this.sel = sel;
  }

  selectAll(): void {
    this.commitFloat();
    this.sel = new Uint8Array(this.w * this.h).fill(1);
    this.render();
  }

  deselect(): void {
    this.commitFloat();
    this.sel = null;
    this.render();
  }

  selBounds(): [number, number, number, number] | null {
    if (!this.sel) return null;
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let i = 0; i < this.sel.length; i++)
      if (this.sel[i]) {
        const x = i % this.w;
        const y = (i - x) / this.w;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  }

  /** Copies the selected pixels of the active layer, and clears them when `cut` is set. */
  grab(cut: boolean): { img: ImageData; at: [number, number] } | null {
    const b = this.selBounds();
    if (!b) return null;
    const [x0, y0, x1, y1] = b;
    const img = blank(x1 - x0, y1 - y0);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * this.w + x;
        if (!this.sel![i]) continue;
        img.data.set(this.cel.data.subarray(i * 4, i * 4 + 4), ((y - y0) * img.width + (x - x0)) * 4);
        if (cut) this.cel.data.fill(0, i * 4, i * 4 + 4);
      }
    return { img, at: [x0, y0] };
  }

  lift(): boolean {
    if (this.float) return true;
    if (!this.sel) this.sel = new Uint8Array(this.w * this.h).fill(1);
    this.pushUndo();
    const g = this.grab(true);
    if (!g) return false;
    this.float = { src: g.img, from: g.at, cx: g.at[0] + g.img.width / 2, cy: g.at[1] + g.img.height / 2, angle: 0 };
    this.touched();
    return true;
  }

  floating(): { img: ImageData; x: number; y: number; cv: HTMLCanvasElement } | null {
    const f = this.float;
    if (!f) return null;
    if (!this.floatCache || this.floatCache.angle !== f.angle || this.floatCache.src !== f.src) {
      const img = f.angle % 360 === 0 ? f.src : rotateNearest(f.src, f.angle);
      const cv = canvas(img.width, img.height);
      ctx2d(cv).putImageData(img, 0, 0);
      this.floatCache = { angle: f.angle, src: f.src, img, cv };
    }
    const { img, cv } = this.floatCache;
    return { img, cv, x: Math.round(f.cx - img.width / 2), y: Math.round(f.cy - img.height / 2) };
  }

  commitFloat(): void {
    const fl = this.floating();
    if (!fl) return;
    const sel = new Uint8Array(this.w * this.h);
    for (let y = 0; y < fl.img.height; y++)
      for (let x = 0; x < fl.img.width; x++) {
        const si = (y * fl.img.width + x) * 4;
        const tx = fl.x + x;
        const ty = fl.y + y;
        if (!fl.img.data[si + 3] || tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        this.cel.data.set(fl.img.data.subarray(si, si + 4), (ty * this.w + tx) * 4);
        sel[ty * this.w + tx] = 1;
      }
    this.float = null;
    this.sel = sel;
    this.touched();
    this.render();
  }

  cancelFloat(): void {
    const f = this.float;
    if (!f) return;
    if (f.from)
      for (let y = 0; y < f.src.height; y++)
      for (let x = 0; x < f.src.width; x++) {
        const si = (y * f.src.width + x) * 4;
        if (f.src.data[si + 3]) this.cel.data.set(f.src.data.subarray(si, si + 4), ((f.from[1] + y) * this.w + f.from[0] + x) * 4);
      }
    this.float = null;
    this.touched();
    this.render();
  }

  insideFloat(x: number, y: number): boolean {
    const fl = this.floating();
    return !!fl && x >= fl.x && y >= fl.y && x < fl.x + fl.img.width && y < fl.y + fl.img.height;
  }

  rotate(deg: number): void {
    if (!this.lift() || !this.float) return;
    this.float.angle = (((this.float.angle + deg) % 360) + 360) % 360;
    this.render();
    this.refreshSide();
  }

  flip(horizontal: boolean): void {
    if (!this.lift() || !this.float) return;
    const s = this.float.src;
    const out = blank(s.width, s.height);
    for (let y = 0; y < s.height; y++)
      for (let x = 0; x < s.width; x++) {
        const tx = horizontal ? s.width - 1 - x : x;
        const ty = horizontal ? y : s.height - 1 - y;
        const si = (y * s.width + x) * 4;
        out.data.set(s.data.subarray(si, si + 4), (ty * s.width + tx) * 4);
      }
    this.float.src = out;
    this.render();
  }

  clearSelection(): void {
    if (this.float) {
      this.float = null;
      this.sel = null;
      this.render();
      return;
    }
    if (!this.sel) return;
    this.pushUndo();
    for (let i = 0; i < this.sel.length; i++) if (this.sel[i]) this.cel.data.fill(0, i * 4, i * 4 + 4);
    this.touched();
    this.render();
  }

  copy(): void {
    if (this.float) this.clipboard = copyImage(this.floating()!.img);
    else this.clipboard = this.grab(false)?.img ?? null;
  }

  paste(img = this.clipboard, at?: [number, number]): void {
    if (!img) return;
    this.commitFloat();
    this.pushUndo();
    const cx = at ? at[0] : this.ox;
    const cy = at ? at[1] : this.oy;
    this.float = { src: copyImage(img), from: null, cx, cy, angle: 0 };
    this.tool = 'move';
    this.refreshTools();
    this.render();
  }

  /** A file's image at this document's art pixel size: images made of k x k blocks are taken as game resolution. */
  async artOf(file: File): Promise<ImageData> {
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    const data = raster(img, img.naturalWidth, img.naturalHeight);
    const phase = this.k > 1 ? blockPhase(data, this.k) : null;
    if (!phase) return data;
    const dx = phase[0] ? phase[0] - this.k : 0;
    const dy = phase[1] ? phase[1] - this.k : 0;
    return downsample(data, this.k, Math.ceil((data.width - dx) / this.k), Math.ceil((data.height - dy) / this.k), -dx, -dy);
  }

  /** Grows the canvas until an image of this size fits around the center. */
  fit(w: number, h0: number): void {
    const need = (n: number, o: number, size: number) => Math.max(0, Math.ceil(size / 2 - o), Math.ceil(o + size / 2 - n));
    const grow = Math.max(need(this.w, this.ox, w), need(this.h, this.oy, h0));
    if (grow) this.resize(grow);
  }

  async importImage(): Promise<void> {
    const [file] = await pickFile('image/png,image/svg+xml,image/gif,image/jpeg');
    if (!file) return;
    const art = await this.artOf(file);
    this.fit(art.width, art.height);
    this.paste(art, [this.ox, this.oy]);
  }

  /** Adds one frame per image file after the current frame, in file name order, centered on the center. */
  async importFrames(): Promise<void> {
    const files = (await pickFile('image/png,image/svg+xml,image/gif,image/jpeg', true)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) return;
    this.commitFloat();
    const arts = await Promise.all(files.map((f) => this.artOf(f)));
    this.fit(Math.max(...arts.map((a) => a.width)), Math.max(...arts.map((a) => a.height)));
    this.pushUndo();
    const src = this.frames[this.cur];
    arts.forEach((art, n) => {
      const cels = this.layers.map(() => blank(this.w, this.h));
      const x0 = Math.round(this.ox - art.width / 2);
      const y0 = Math.round(this.oy - art.height / 2);
      for (let y = 0; y < art.height; y++)
        for (let x = 0; x < art.width; x++) {
          const si = (y * art.width + x) * 4;
          if (art.data[si + 3] && x0 + x >= 0 && y0 + y >= 0 && x0 + x < this.w && y0 + y < this.h) cels[this.layer].data.set(art.data.subarray(si, si + 4), ((y0 + y) * this.w + x0 + x) * 4);
        }
      this.frames.splice(this.cur + 1 + n, 0, { speed: src.speed, name: this.newName(), shift: [...src.shift], cels });
    });
    this.goTo(this.cur + 1);
    this.invalidateAll();
    this.buildPalette();
    this.refreshAll();
  }

  /** Downloads the frames at game resolution, with their centers and speeds. */
  async exportFrames(): Promise<void> {
    const frames = await Promise.all(
      this.frames.map(async (f, i) => {
        const { crop, center } = this.exportFrame(i);
        return { name: f.name, speed: f.speed, center, resolution: 2, blob: await toBlob(crop) };
      }),
    );
    await downloadAnimation(this.opts.slot, frames);
  }

  // Canvas, layers and frames

  /** Adds `n` pixels on every side (or removes them when negative), keeping the drawing in place. */
  resize(n: number, crop?: [number, number, number, number]): void {
    this.commitFloat();
    this.pushUndo();
    const [x0, y0, x1, y1] = crop ?? [-n, -n, this.w + n, this.h + n];
    const w = x1 - x0;
    const hh = y1 - y0;
    const move = (img: ImageData) => {
      const out = blank(w, hh);
      for (let y = 0; y < hh; y++)
        for (let x = 0; x < w; x++) {
          const sx = x + x0;
          const sy = y + y0;
          if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) continue;
          const si = (sy * this.w + sx) * 4;
          out.data.set(img.data.subarray(si, si + 4), (y * w + x) * 4);
        }
      return out;
    };
    for (const f of this.frames) f.cels = f.cels.map(move);
    this.w = w;
    this.h = hh;
    this.ox -= x0;
    this.oy -= y0;
    this.sel = null;
    this.invalidateAll();
    this.refreshAll();
  }

  trim(): void {
    let b: [number, number, number, number] | null = null;
    for (const f of this.frames)
      for (const cel of f.cels) {
        const c = opaqueBounds(cel);
        if (c) b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])] : c;
      }
    if (!b) return;
    const m = 2;
    this.resize(0, [b[0] - m, b[1] - m, b[2] + m, b[3] + m]);
  }

  addLayer(duplicate = false): void {
    this.commitFloat();
    this.pushUndo();
    const at = this.layer + 1;
    const src = this.layers[this.layer];
    this.layers.splice(at, 0, duplicate ? { ...src, name: `${src.name} copy` } : { name: `Layer ${this.layers.length + 1}`, visible: true, opacity: 1 });
    for (const f of this.frames) f.cels.splice(at, 0, duplicate ? copyImage(f.cels[this.layer]) : blank(this.w, this.h));
    this.layer = at;
    this.invalidateAll();
    this.refreshAll();
  }

  deleteLayer(): void {
    if (this.layers.length < 2) return;
    this.commitFloat();
    this.pushUndo();
    this.layers.splice(this.layer, 1);
    for (const f of this.frames) f.cels.splice(this.layer, 1);
    this.layer = Math.max(0, this.layer - 1);
    this.invalidateAll();
    this.refreshAll();
  }

  moveLayer(d: number): void {
    const to = this.layer + d;
    if (to < 0 || to >= this.layers.length) return;
    this.commitFloat();
    this.pushUndo();
    const swap = <T>(a: T[]) => ([a[this.layer], a[to]] = [a[to], a[this.layer]]);
    swap(this.layers);
    for (const f of this.frames) swap(f.cels);
    this.layer = to;
    this.invalidateAll();
    this.refreshAll();
  }

  mergeDown(): void {
    if (this.layer === 0) return;
    this.commitFloat();
    this.pushUndo();
    const top = this.layers[this.layer];
    for (const f of this.frames) {
      const c = canvas(this.w, this.h);
      const g = ctx2d(c);
      g.putImageData(f.cels[this.layer - 1], 0, 0);
      const t = canvas(this.w, this.h);
      ctx2d(t).putImageData(f.cels[this.layer], 0, 0);
      g.globalAlpha = top.visible ? top.opacity : 0;
      g.drawImage(t, 0, 0);
      f.cels[this.layer - 1] = g.getImageData(0, 0, this.w, this.h);
      f.cels.splice(this.layer, 1);
    }
    this.layers.splice(this.layer, 1);
    this.layer--;
    this.invalidateAll();
    this.refreshAll();
  }

  addFrame(duplicate: boolean): void {
    if (this.opts.single) return;
    this.commitFloat();
    this.pushUndo();
    const src = this.frames[this.cur];
    const f: PFrame = { speed: src.speed, name: this.newName(), shift: [...src.shift], cels: duplicate ? src.cels.map(copyImage) : this.layers.map(() => blank(this.w, this.h)) };
    this.frames.splice(this.cur + 1, 0, f);
    this.goTo(this.cur + 1);
    this.onionCache.clear();
    this.refreshAll();
  }

  deleteFrame(): void {
    if (this.frames.length < 2) return;
    this.commitFloat();
    this.pushUndo();
    this.frames.splice(this.cur, 1);
    this.cur = Math.min(this.cur, this.frames.length - 1);
    this.invalidateAll();
    this.refreshAll();
  }

  moveFrame(from: number, to: number): void {
    if (to < 0 || to >= this.frames.length || from === to) return;
    this.commitFloat();
    this.pushUndo();
    const [f] = this.frames.splice(from, 1);
    this.frames.splice(to, 0, f);
    this.cur = to;
    this.invalidateAll();
    this.refreshAll();
  }

  goTo(i: number): void {
    if (i < 0 || i >= this.frames.length) return;
    this.commitFloat();
    this.cur = i;
    this.last = null;
    this.invalidateLayers();
    this.render();
    this.refreshStrip();
    this.refreshFrameProps();
  }

  play(): void {
    if (this.playing) return this.stop();
    const step = () => {
      const f = this.frames[this.cur];
      const ticks = f.name.includes('NL') ? HOLD_PREVIEW_TICKS : frameTicks(f.speed);
      this.playing = window.setTimeout(() => {
        this.goTo((this.cur + 1) % this.frames.length);
        step();
      }, ticks * FRAME_MS);
    };
    step();
    this.refreshFrameProps();
  }

  stop(): void {
    clearTimeout(this.playing);
    this.playing = 0;
    this.refreshFrameProps();
  }

  // Drawing the view

  invalidateLayers(): void {
    this.layers.forEach((_, i) => this.layerDirty.add(i));
  }

  invalidateAll(): void {
    this.invalidateLayers();
    this.onionCache.clear();
    this.floatCache = null;
  }

  layerCanvas(i: number): HTMLCanvasElement {
    let c = this.layerCache[i];
    if (!c || c.width !== this.w || c.height !== this.h) {
      c = this.layerCache[i] = canvas(this.w, this.h);
      this.layerDirty.add(i);
    }
    if (this.layerDirty.has(i)) {
      ctx2d(c).putImageData(this.frames[this.cur].cels[i], 0, 0);
      this.layerDirty.delete(i);
    }
    return c;
  }

  onionCanvas(i: number, color: string): HTMLCanvasElement {
    const key = `${i}|${color}`;
    let c = this.onionCache.get(key);
    if (!c) {
      c = this.flatten(i);
      const g = ctx2d(c);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, this.w, this.h);
      this.onionCache.set(key, c);
    }
    return c;
  }

  render(): void {
    const z = this.zoom;
    const v = this.view;
    if (v.width !== this.w * z || v.height !== this.h * z) {
      v.width = this.w * z;
      v.height = this.h * z;
    }
    const g = v.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, v.width, v.height);
    const draw = (c: CanvasImageSource, x = 0, y = 0, w = this.w, hh = this.h) => g.drawImage(c, x * z, y * z, w * z, hh * z);

    if (this.reference && this.showReference) {
      const r = this.reference;
      g.globalAlpha = 0.25;
      const [sx, sy] = this.frames[this.cur].shift;
      const k = this.k;
      draw(r.img, this.ox + (r.offset[0] - r.cx * r.scale - sx) / k, this.oy + (r.offset[1] - r.cy * r.scale - sy) / k, (r.img.naturalWidth * r.scale) / k, (r.img.naturalHeight * r.scale) / k);
    }
    const fl = this.floating();
    this.layers.forEach((l, i) => {
      if (!l.visible) return;
      g.globalAlpha = l.opacity;
      draw(this.layerCanvas(i));
      if (fl && i === this.layer) draw(fl.cv, fl.x, fl.y, fl.img.width, fl.img.height);
    });
    if (this.onion.on && !this.playing) {
      const o = this.onion;
      for (let k = o.prev; k >= 1; k--) {
        if (this.cur - k < 0) continue;
        g.globalAlpha = o.opacity * 0.7 ** (k - 1);
        draw(this.onionCanvas(this.cur - k, o.prevColor));
      }
      for (let k = o.next; k >= 1; k--) {
        if (this.cur + k >= this.frames.length) continue;
        g.globalAlpha = o.opacity * 0.7 ** (k - 1);
        draw(this.onionCanvas(this.cur + k, o.nextColor));
      }
    }
    g.globalAlpha = 1;

    if (this.grid && z >= 8) {
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 1; x < this.w; x++) {
        g.moveTo(x * z + 0.5, 0);
        g.lineTo(x * z + 0.5, v.height);
      }
      for (let y = 1; y < this.h; y++) {
        g.moveTo(0, y * z + 0.5);
        g.lineTo(v.width, y * z + 0.5);
      }
      g.stroke();
    }

    // Selection outline: every edge between a selected and an unselected pixel.
    g.lineWidth = 1;
    if (fl) {
      g.setLineDash([4, 3]);
      g.strokeStyle = '#ffe066';
      g.strokeRect(fl.x * z + 0.5, fl.y * z + 0.5, fl.img.width * z - 1, fl.img.height * z - 1);
      g.setLineDash([]);
    } else if (this.sel) {
      g.strokeStyle = '#ffe066';
      g.beginPath();
      const s = this.sel;
      const W = this.w;
      for (let y = 0; y < this.h; y++)
        for (let x = 0; x < W; x++) {
          if (!s[y * W + x]) continue;
          if (x === 0 || !s[y * W + x - 1]) (g.moveTo(x * z + 0.5, y * z), g.lineTo(x * z + 0.5, (y + 1) * z));
          if (x === W - 1 || !s[y * W + x + 1]) (g.moveTo((x + 1) * z - 0.5, y * z), g.lineTo((x + 1) * z - 0.5, (y + 1) * z));
          if (y === 0 || !s[(y - 1) * W + x]) (g.moveTo(x * z, y * z + 0.5), g.lineTo((x + 1) * z, y * z + 0.5));
          if (y === this.h - 1 || !s[(y + 1) * W + x]) (g.moveTo(x * z, (y + 1) * z - 0.5), g.lineTo((x + 1) * z, (y + 1) * z - 0.5));
        }
      g.stroke();
    }
    if (this.rectPreview) {
      const [x0, y0, x1, y1] = this.rectPreview;
      g.setLineDash([4, 3]);
      g.strokeStyle = '#ffe066';
      g.strokeRect(Math.min(x0, x1) * z + 0.5, Math.min(y0, y1) * z + 0.5, (Math.abs(x1 - x0) + 1) * z - 1, (Math.abs(y1 - y0) + 1) * z - 1);
      g.setLineDash([]);
    }

    // Rotation center.
    const cx = this.ox * z;
    const cy = this.oy * z;
    g.strokeStyle = '#ff3b6b';
    g.beginPath();
    g.moveTo(cx - 8, cy + 0.5);
    g.lineTo(cx + 8, cy + 0.5);
    g.moveTo(cx + 0.5, cy - 8);
    g.lineTo(cx + 0.5, cy + 8);
    g.stroke();

    if (this.hover && ['pencil', 'eraser'].includes(this.tool)) {
      const off = Math.floor((this.size - 1) / 2);
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.strokeRect((this.hover[0] - off) * z + 0.5, (this.hover[1] - off) * z + 0.5, this.size * z - 1, this.size * z - 1);
    }
    this.refreshStatus();
  }

  // Input

  at(e: PointerEvent): { x: number; y: number; fx: number; fy: number } {
    const r = this.view.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * this.w;
    const fy = ((e.clientY - r.top) / r.height) * this.h;
    return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
  }

  onDown(e: PointerEvent): void {
    if (this.playing) this.stop();
    const { x, y, fx, fy } = this.at(e);
    this.view.setPointerCapture(e.pointerId);
    if (e.button === 2 || this.tool === 'pick') {
      this.pick(x, y);
      return;
    }
    if (e.button !== 0) return;
    const startMove = () => {
      if (!this.lift() || !this.float) return;
      this.drag = { kind: 'move', x0: fx, y0: fy, cx0: this.float.cx, cy0: this.float.cy };
    };
    const inSel = this.float ? this.insideFloat(x, y) : !!this.sel?.[y * this.w + x] && x >= 0 && y >= 0 && x < this.w && y < this.h;
    if (this.float && !(inSel && ['move', 'rect', 'wand'].includes(this.tool))) this.commitFloat();

    switch (this.tool) {
      case 'pencil':
      case 'eraser':
        this.pushUndo();
        if (this.tool === 'pencil') this.useColor();
        if (e.shiftKey && this.last) this.line(this.last[0], this.last[1], x, y);
        else this.dab(x, y);
        this.last = [x, y];
        this.drag = { kind: 'paint', x0: x, y0: y };
        this.touched();
        break;
      case 'fill':
        this.fill(x, y);
        break;
      case 'wand':
        if (inSel && !e.shiftKey) startMove();
        else if (x >= 0 && y >= 0 && x < this.w && y < this.h) {
          const r = this.region(this.cel, x, y, this.contiguous);
          if (e.shiftKey && this.sel) for (let i = 0; i < r.length; i++) this.sel[i] |= r[i];
          else this.sel = r;
        }
        break;
      case 'rect':
        if (inSel && !e.shiftKey) startMove();
        else {
          this.drag = { kind: 'rect', x0: x, y0: y, add: e.shiftKey };
          this.rectPreview = [x, y, x, y];
        }
        break;
      case 'move':
        startMove();
        break;
      case 'center':
        this.pushUndo();
        this.ox = Math.round(fx);
        this.oy = Math.round(fy);
        break;
    }
    this.render();
  }

  onMove(e: PointerEvent): void {
    const { x, y, fx, fy } = this.at(e);
    this.hover = [x, y];
    const d = this.drag;
    if (d?.kind === 'paint' && this.last) {
      this.line(this.last[0], this.last[1], x, y);
      this.last = [x, y];
      this.touched();
    } else if (d?.kind === 'rect') this.rectPreview = [d.x0, d.y0, x, y];
    else if (d?.kind === 'move' && this.float) {
      this.float.cx = d.cx0! + Math.round(fx - d.x0);
      this.float.cy = d.cy0! + Math.round(fy - d.y0);
    }
    this.render();
  }

  onUp(): void {
    const d = this.drag;
    if (d?.kind === 'rect' && this.rectPreview) {
      const [x0, y0, x1, y1] = this.rectPreview;
      if (x0 === x1 && y0 === y1 && !d.add) this.sel = null;
      else this.selectRect(x0, y0, x1, y1, !!d.add);
    }
    this.drag = null;
    this.rectPreview = null;
    this.render();
    this.refreshSide();
  }

  onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLElement && e.target.matches('input, select, textarea') && e.key !== 'Escape') return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const keys: Record<string, () => void> = {
      'mod+z': () => (e.shiftKey ? this.redo() : this.undo()),
      'mod+y': () => this.redo(),
      'mod+a': () => this.selectAll(),
      'mod+d': () => this.deselect(),
      'mod+c': () => this.copy(),
      'mod+x': () => (this.copy(), this.clearSelection()),
      'mod+v': () => this.paste(),
      'mod+s': () => void this.apply(),
      f: () => this.hover && this.fill(this.hover[0], this.hover[1]),
      r: () => this.rotate(e.shiftKey ? -90 : 90),
      h: () => this.flip(!e.shiftKey),
      delete: () => this.clearSelection(),
      backspace: () => this.clearSelection(),
      escape: () => (this.float ? this.cancelFloat() : this.deselect()),
      enter: () => this.commitFloat(),
      '[': () => this.setSize(this.size - 1),
      ']': () => this.setSize(this.size + 1),
      ',': () => this.goTo(this.cur - 1),
      '.': () => this.goTo(this.cur + 1),
      '=': () => this.setZoom(this.zoom + (this.zoom >= 8 ? 2 : 1)),
      '+': () => this.setZoom(this.zoom + (this.zoom >= 8 ? 2 : 1)),
      '-': () => this.setZoom(this.zoom - (this.zoom > 8 ? 2 : 1)),
      arrowleft: () => this.nudge(-1, 0),
      arrowright: () => this.nudge(1, 0),
      arrowup: () => this.nudge(0, -1),
      arrowdown: () => this.nudge(0, 1),
    };
    for (const [tool, , key] of TOOLS) if (!mod) keys[key.toLowerCase()] ??= () => this.setTool(tool);
    const fn = keys[mod ? `mod+${k}` : k];
    if (!fn) return;
    e.preventDefault();
    fn();
  }

  nudge(dx: number, dy: number): void {
    if (!this.sel && !this.float) return this.goTo(this.cur + dx);
    if (!this.lift() || !this.float) return;
    this.float.cx += dx;
    this.float.cy += dy;
    this.render();
  }

  setTool(t: Tool): void {
    if (t !== 'move' && t !== 'rect' && t !== 'wand') this.commitFloat();
    this.tool = t;
    this.refreshTools();
    this.render();
  }

  setSize(n: number): void {
    this.size = Math.max(1, Math.min(16, n));
    this.refreshTools();
  }

  /** Zooms so the pixel under the screen point (x, y) stays under it. */
  zoomAt(z: number, x: number, y: number): void {
    const before = this.view.getBoundingClientRect();
    const px = (x - before.left) / this.zoom;
    const py = (y - before.top) / this.zoom;
    this.setZoom(z);
    const after = this.view.getBoundingClientRect();
    this.scroller.scrollLeft += after.left + px * this.zoom - x;
    this.scroller.scrollTop += after.top + py * this.zoom - y;
  }

  setZoom(z: number): void {
    this.zoom = Math.max(1, Math.min(48, z));
    this.render();
    this.refreshStatus();
  }

  async apply(): Promise<void> {
    try {
      this.applyButton.disabled = true;
      setButton(this.applyButton, Save, 'Saving');
      await this.save();
      this.close();
    } catch (err) {
      this.applyButton.disabled = false;
      setButton(this.applyButton, Save, 'Save');
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  close(force = false): void {
    if (!force && this.dirty && !confirm('Discard the changes in the paint editor?')) return;
    this.stop();
    window.removeEventListener('keydown', this.keyHandler);
    closeReference();
    this.root.remove();
  }

  // Panels

  applyButton!: HTMLButtonElement;
  toolsBox!: HTMLDivElement;
  frameProps!: HTMLDivElement;

  mount(): void {
    this.view = h('canvas', {
      class: 'paint-canvas',
      oncontextmenu: (e: Event) => e.preventDefault(),
      onpointerdown: (e: PointerEvent) => this.onDown(e),
      onpointermove: (e: PointerEvent) => this.onMove(e),
      onpointerup: () => this.onUp(),
      onpointerleave: () => {
        this.hover = null;
        this.render();
      },
    });
    this.scroller = h('div', {
      class: 'paint-scroll',
      onwheel: (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.zoomAt(this.zoom + (e.deltaY < 0 ? 1 : -1) * (this.zoom >= 8 ? 2 : 1), e.clientX, e.clientY);
      },
    }, this.view);
    this.status = h('div', { class: 'paint-status' });
    this.toolsBox = h('div', { class: 'paint-tools' });
    this.side = h('div', { class: 'paint-side' });
    this.strip = h('div', { class: 'paint-strip' });
    this.frameProps = h('div', { class: 'paint-frame-props' });
    this.applyButton = h('button', { class: 'primary', onclick: () => void this.apply() }, icon(Save), 'Save');
    this.root = h(
      'div',
      { class: 'paint' },
      h('header', { class: 'paint-head' }, h('strong', null, this.opts.title), h('span', { class: 'grow' }), h('button', { onclick: () => this.close() }, icon(X), 'Cancel'), this.applyButton),
      h('div', { class: 'paint-body' }, this.toolsBox, h('main', { class: 'paint-main' }, this.scroller, this.status), this.side),
      this.opts.single ? null : h('footer', { class: 'paint-foot' }, this.frameProps, this.strip),
    );
    document.body.append(this.root);
    window.addEventListener('keydown', this.keyHandler);
    const avail = [this.scroller.clientWidth - 24, this.scroller.clientHeight - 24];
    this.zoom = Math.max(1, Math.min(24, Math.floor(Math.min(avail[0] / this.w, avail[1] / this.h))));
    this.invalidateAll();
    this.refreshAll();
  }

  refreshAll(): void {
    this.cur = Math.min(this.cur, this.frames.length - 1);
    this.layer = Math.min(this.layer, this.layers.length - 1);
    this.refreshTools();
    this.refreshSide();
    this.refreshStrip();
    this.refreshFrameProps();
    this.render();
  }

  refreshStatus(): void {
    if (!this.status) return;
    const hv = this.hover ? `${this.hover[0]}, ${this.hover[1]}` : '';
    const c = this.color;
    this.status.textContent = `${hv}   ${this.w} x ${this.h} art pixels of ${this.k} x ${this.k}   zoom ${this.zoom}x   center ${this.ox}, ${this.oy}   color ${hex(c)} alpha ${c[3]}`;
  }

  refreshTools(): void {
    if (!this.toolsBox) return;
    const swatch = (c: RGBA) =>
      h('button', {
        class: `swatch${c.join() === this.color.join() ? ' on' : ''}`,
        style: `background: rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`,
        title: `${hex(c)} alpha ${c[3]}`,
        onclick: () => this.setColor([...c]),
      });
    fill(this.toolsBox, 
      h(
        'div',
        { class: 'tool-grid' },
        TOOLS.map(([t, label, key, glyph]) => h('button', { class: this.tool === t ? 'on' : '', title: `${label} (${key})`, onclick: () => this.setTool(t) }, icon(glyph), label)),
      ),
      field('Brush', h('input', { type: 'number', min: 1, max: 16, value: String(this.size), onchange: (e: Event) => this.setSize(Number((e.target as HTMLInputElement).value)) }), 'Brush size in pixels ([ and ])'),
      field('Color', h('input', { type: 'color', value: hex(this.color), oninput: (e: Event) => this.setColor(fromHex((e.target as HTMLInputElement).value, this.color[3] || 255)) })),
      field('Alpha', h('input', { type: 'range', min: 0, max: 255, value: String(this.color[3]), oninput: (e: Event) => this.setColor([this.color[0], this.color[1], this.color[2], Number((e.target as HTMLInputElement).value)]) })),
      this.tool === 'wand' ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: this.contiguous, onchange: (e: Event) => (this.contiguous = (e.target as HTMLInputElement).checked) }), 'Connected pixels only') : null,
      h('div', { class: 'swatches-label' }, 'Recent'),
      h('div', { class: 'swatches' }, this.recent.map(swatch)),
      h('div', { class: 'swatches-label' }, 'In these frames'),
      h('div', { class: 'swatches' }, this.palette.map(swatch)),
      h('p', { class: 'hint' }, 'Left click draws. Right click picks a color. F fills under the pointer. Shift click draws a line from the last point. Drag a selection to move it. R rotates 90 degrees and H flips. Ctrl+Z undoes.'),
    );
  }

  refreshSide(): void {
    if (!this.side) return;
    const layerRows = this.layers
      .map((l, i) =>
        h(
          'div',
          {
            class: `layer-row${i === this.layer ? ' on' : ''}`,
            onclick: () => {
              this.commitFloat();
              this.layer = i;
              this.refreshSide();
            },
            ondblclick: () => {
              const name = prompt('Layer name', l.name);
              if (name) (l.name = name), this.refreshSide();
            },
          },
          h('input', {
            type: 'checkbox',
            checked: l.visible,
            title: 'Visible',
            onclick: (e: Event) => e.stopPropagation(),
            onchange: (e: Event) => {
              l.visible = (e.target as HTMLInputElement).checked;
              this.dirty = true;
              this.onionCache.clear();
              this.render();
            },
          }),
          h('span', null, l.name),
        ),
      )
      .reverse();
    const active = this.layers[this.layer];
    const o = this.onion;
    const onionChange = () => {
      this.onionCache.clear();
      this.render();
    };
    const angle = this.float?.angle ?? 0;
    fill(this.side, 
      h('h3', null, 'Layers'),
      h('div', { class: 'layer-list' }, layerRows),
      field('Opacity', h('input', { type: 'range', min: 0, max: 100, value: String(Math.round(active.opacity * 100)), oninput: (e: Event) => ((active.opacity = Number((e.target as HTMLInputElement).value) / 100), (this.dirty = true), this.onionCache.clear(), this.render()) })),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => this.addLayer(), title: 'Add a layer above' }, icon(Plus), 'Add'),
        h('button', { onclick: () => this.addLayer(true) }, icon(Copy), 'Copy'),
        h('button', { onclick: () => this.deleteLayer() }, icon(Trash2), 'Delete'),
        h('button', { onclick: () => this.moveLayer(1), title: 'Move up' }, icon(ArrowUp), 'Up'),
        h('button', { onclick: () => this.moveLayer(-1), title: 'Move down' }, icon(ArrowDown), 'Down'),
        h('button', { onclick: () => this.mergeDown() }, icon(Merge), 'Merge down'),
      ),
      h('h3', null, 'Selection'),
      field('Rotate', h('input', { type: 'number', step: 1, value: String(angle), onchange: (e: Event) => this.rotate(Number((e.target as HTMLInputElement).value) - angle) }), 'Degrees clockwise, nearest-neighbor'),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => this.rotate(-90) }, icon(RotateCcw), '-90'),
        h('button', { onclick: () => this.rotate(-15) }, icon(RotateCcw), '-15'),
        h('button', { onclick: () => this.rotate(15) }, icon(RotateCw), '+15'),
        h('button', { onclick: () => this.rotate(90) }, icon(RotateCw), '+90'),
      ),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => this.flip(true) }, icon(FlipHorizontal2), 'Flip H'),
        h('button', { onclick: () => this.flip(false) }, icon(FlipVertical2), 'Flip V'),
        h('button', { onclick: () => this.commitFloat(), disabled: !this.float }, icon(Check), 'Drop'),
        h('button', { onclick: () => this.deselect() }, icon(X), 'Deselect'),
      ),
      this.opts.single
        ? null
        : [
            h('h3', null, 'Onion skin'),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.on, onchange: (e: Event) => ((o.on = (e.target as HTMLInputElement).checked), onionChange()) }), 'Show other frames'),
            h(
              'div',
              { class: 'onion-grid' },
              field('Before', h('input', { type: 'number', min: 0, max: 5, value: String(o.prev), onchange: (e: Event) => ((o.prev = Number((e.target as HTMLInputElement).value)), onionChange()) })),
              h('input', { type: 'color', value: o.prevColor, title: 'Color of earlier frames', oninput: (e: Event) => ((o.prevColor = (e.target as HTMLInputElement).value), onionChange()) }),
              field('After', h('input', { type: 'number', min: 0, max: 5, value: String(o.next), onchange: (e: Event) => ((o.next = Number((e.target as HTMLInputElement).value)), onionChange()) })),
              h('input', { type: 'color', value: o.nextColor, title: 'Color of later frames', oninput: (e: Event) => ((o.nextColor = (e.target as HTMLInputElement).value), onionChange()) }),
            ),
            field('Strength', h('input', { type: 'range', min: 5, max: 100, value: String(Math.round(o.opacity * 100)), oninput: (e: Event) => ((o.opacity = Number((e.target as HTMLInputElement).value) / 100), this.render()) })),
          ],
      h('h3', null, 'Canvas'),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => this.resize(8), title: 'Add 8 pixels on every side' }, icon(Expand), 'Grow'),
        h('button', { onclick: () => this.trim(), title: 'Cut empty space around every frame' }, icon(Shrink), 'Trim'),
        h('button', { onclick: () => void this.importImage(), title: 'Paste an image file into the current frame' }, icon(ImagePlus), 'Import image'),
        h('button', { onclick: () => toggleReference(() => this.exportFrame(this.cur).crop), title: 'A movable window with an image to look at while painting' }, icon(Images), 'Reference'),
      ),
      field(
        'Pixel size',
        h('select', { onchange: (e: Event) => this.setScale(Number((e.target as HTMLSelectElement).value)) }, [1, 2, 3, 4, 5, 6, 8].map((n) => h('option', { value: String(n), selected: n === this.k }, `${n} x ${n} game image pixels`))),
        "How many of the game image's pixels one pixel here becomes when saved",
      ),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: this.grid, onchange: (e: Event) => ((this.grid = (e.target as HTMLInputElement).checked), this.render()) }), 'Pixel grid'),
      this.reference ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: this.showReference, onchange: (e: Event) => ((this.showReference = (e.target as HTMLInputElement).checked), this.render()) }), 'Show the fighter behind') : null,
    );
  }

  refreshStrip(): void {
    if (!this.strip || this.opts.single) return;
    let dragFrom = -1;
    fill(this.strip, 
      ...this.frames.map((f, i) => {
        const thumb = this.flatten(i);
        thumb.className = 'thumb-canvas';
        return h(
          'div',
          {
            class: `frame-thumb${i === this.cur ? ' on' : ''}`,
            draggable: true,
            title: f.name,
            onclick: () => this.goTo(i),
            ondragstart: () => (dragFrom = i),
            ondragover: (e: DragEvent) => e.preventDefault(),
            ondrop: (e: DragEvent) => {
              e.preventDefault();
              if (dragFrom >= 0) this.moveFrame(dragFrom, i);
            },
          },
          thumb,
          h('span', null, `${i + 1}`),
        );
      }),
    );
  }

  refreshFrameProps(): void {
    if (!this.frameProps || this.opts.single) return;
    const f = this.frames[this.cur];
    const hold = f.name.includes('NL');
    fill(this.frameProps, 
      h('button', { onclick: () => this.play() }, icon(this.playing ? Square : Play), this.playing ? 'Stop' : 'Play'),
      h('button', { onclick: () => this.goTo(this.cur - 1), title: 'Previous frame (,)' }, icon(ChevronLeft), 'Prev'),
      h('button', { onclick: () => this.goTo(this.cur + 1), title: 'Next frame (.)' }, icon(ChevronRight), 'Next'),
      h('span', { class: 'frame-count' }, `Frame ${this.cur + 1} of ${this.frames.length}`),
      h('button', { onclick: () => this.addFrame(false) }, icon(FilePlus), 'New frame'),
      h('button', { onclick: () => this.addFrame(true) }, icon(Copy), 'Copy frame'),
      h('button', { onclick: () => this.deleteFrame() }, icon(Trash2), 'Delete frame'),
      h('button', { onclick: () => this.moveFrame(this.cur, this.cur - 1) }, icon(ArrowLeft), 'Move left'),
      h('button', { onclick: () => this.moveFrame(this.cur, this.cur + 1) }, icon(ArrowRight), 'Move right'),
      h('button', { onclick: () => void this.importFrames(), title: 'One new frame per image file, in file name order' }, icon(Images), 'Add frames from files'),
      h('button', { onclick: () => void this.exportFrames(), title: 'Download the frames at game size as a zip' }, icon(Download), 'Export'),
      field(
        'Speed',
        speedSelect(f.speed, (v) => {
          this.pushUndo();
          f.speed = v;
        }),
        'How long the frame shows',
      ),
      h(
        'label',
        { class: 'check', title: 'The animation stops on this frame until the fighter changes state' },
        h('input', {
          type: 'checkbox',
          checked: hold,
          onchange: (e: Event) => {
            this.pushUndo();
            f.name = (e.target as HTMLInputElement).checked ? `${f.name}NL` : f.name.replace(/NL/g, '');
            this.refreshFrameProps();
          },
        }),
        'Hold',
      ),
      field(
        'Name',
        h('input', {
          type: 'text',
          value: f.name,
          onchange: (e: Event) => {
            this.pushUndo();
            f.name = (e.target as HTMLInputElement).value.trim() || f.name;
            this.refreshStrip();
          },
        }),
        'The game finds frames by name, so keep the animation name at the start',
      ),
    );
  }
}
