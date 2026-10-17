// Recolors a whole character: every color in its frames and art gets a new color, set one by one or by
// giving the selected colors one hue. The new images are written as new files.
import { Check, CheckCheck, X } from 'lucide';
import type { Frame, Image } from '../../../src/game/pack-format.ts';
import { app } from './main.ts';
import { api, bumpVersion, canvas, ctx2d, fileUrl, fill, h, icon, loadImage, randomId, toast, toBlob } from './util.ts';

type RGB = [number, number, number];

const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const fromHex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

function toHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [hue * 60, s, l];
}

function fromHsl([hue, s, l]: [number, number, number]): RGB {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)) as RGB;
}

interface Source {
  file: string;
  img: ImageData;
  /** Puts the recolored file's path back into the pack. */
  set(file: string): void;
}

export async function openRecolor(onDone: () => void): Promise<void> {
  const p = app.pack!;
  const sources: Source[] = [];
  const addImage = async (f: Frame | Image, set: (file: string) => void) => {
    if (!f.file.toLowerCase().endsWith('.png')) return;
    const img = await loadImage(fileUrl(app.dir, f.file));
    const c = canvas(img.naturalWidth, img.naturalHeight);
    ctx2d(c).drawImage(img, 0, 0);
    sources.push({ file: f.file, img: ctx2d(c).getImageData(0, 0, c.width, c.height), set });
  };
  const art = h('input', { type: 'checkbox', checked: true });
  const effects = h('input', { type: 'checkbox', checked: false });
  toast('Reading the images');
  for (const f of p.animations) await addImage(f, (file) => (f.file = file));
  const artFrom = sources.length;
  for (const [key, a] of Object.entries(p.art)) if (a) await addImage(a, (file) => (p.art[key] = { ...a, file }));
  const effectsFrom = sources.length;
  for (const m of Object.values(p.moves)) for (const f of m.hitboxes) await addImage(f, (file) => (f.file = file));

  const counts = new Map<string, number>();
  for (const s of sources)
    for (let i = 0; i < s.img.data.length; i += 4) {
      if (!s.img.data[i + 3]) continue;
      const k = hex([s.img.data[i], s.img.data[i + 1], s.img.data[i + 2]]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 128);
  const map = new Map(colors.map((c) => [c, c]));
  const selected = new Set<string>();
  let hueValue = 0;

  const preview = h('canvas', { class: 'recolor-preview', width: 160, height: 160 });
  const drawPreview = () => {
    const s = sources[0];
    if (!s) return;
    const out = new ImageData(new Uint8ClampedArray(s.img.data), s.img.width, s.img.height);
    remap(out);
    const c = canvas(out.width, out.height);
    ctx2d(c).putImageData(out, 0, 0);
    const g = preview.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 160, 160);
    const z = Math.floor(150 / Math.max(out.width, out.height)) || 1;
    g.drawImage(c, (160 - out.width * z) / 2, (160 - out.height * z) / 2, out.width * z, out.height * z);
  };
  const remap = (img: ImageData) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const to = map.get(hex([d[i], d[i + 1], d[i + 2]]));
      if (to) d.set(fromHex(to), i);
    }
  };
  const rows = h('div', { class: 'recolor-rows' });
  const drawRows = () =>
    fill(
      rows,
      colors.map((c) =>
        h(
          'label',
          { class: 'recolor-row', title: `${counts.get(c)} pixels` },
          h('input', {
            type: 'checkbox',
            checked: selected.has(c),
            onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? selected.add(c) : selected.delete(c)),
          }),
          h('span', { class: 'swatch-static', style: `background:${c}` }),
          h('span', { class: 'hint' }, c),
          h('input', {
            type: 'color',
            value: map.get(c),
            oninput: (e: Event) => {
              map.set(c, (e.target as HTMLInputElement).value);
              drawPreview();
            },
          }),
        ),
      ),
    );
  const applyHue = () => {
    for (const c of selected) {
      const [, s, l] = toHsl(fromHex(c));
      map.set(c, hex(fromHsl([hueValue, s, l])));
    }
    drawRows();
    drawPreview();
  };
  const dialog = h(
    'dialog',
    { class: 'dialog recolor' },
    h('h2', null, 'Recolor character'),
    h('p', { class: 'hint' }, 'Tick the colors to change and pick their new hue, which keeps their shading, or set any color directly. The preview shows the first frame.'),
    h(
      'div',
      { class: 'recolor-top' },
      preview,
      h(
        'div',
        null,
        h('label', { class: 'field' }, h('span', null, 'Hue of ticked colors'), h('input', { type: 'range', class: 'hue-slider', min: 0, max: 359, value: '0', oninput: (e: Event) => ((hueValue = Number((e.target as HTMLInputElement).value)), applyHue()) })),
        h(
          'button',
          {
            title: 'Also tick every color within 25 degrees of hue of a ticked color',
            onclick: () => {
              const hues = [...selected].map((c) => toHsl(fromHex(c))[0]);
              for (const c of colors) {
                const [hue, sat] = toHsl(fromHex(c));
                if (sat > 0.12 && hues.some((x) => Math.min(Math.abs(x - hue), 360 - Math.abs(x - hue)) <= 25)) selected.add(c);
              }
              drawRows();
            },
          },
          icon(CheckCheck),
          'Tick similar colors',
        ),
        h('label', { class: 'check' }, art, 'Also recolor the art'),
        h('label', { class: 'check' }, effects, 'Also recolor effect frames of customized moves'),
      ),
    ),
    rows,
    h(
      'div',
      { class: 'button-row' },
      h('button', { onclick: () => dialog.close() }, icon(X), 'Cancel'),
      h(
        'button',
        {
          class: 'primary',
          onclick: async () => {
            const id = randomId();
            const chosen = sources.filter((_, i) => i < artFrom || (i < effectsFrom ? art.checked : effects.checked));
            let n = 0;
            for (const s of chosen) {
              remap(s.img);
              const c = canvas(s.img.width, s.img.height);
              ctx2d(c).putImageData(s.img, 0, 0);
              const folder = s.file.includes('/') ? s.file.slice(0, s.file.lastIndexOf('/')) : '.';
              const file = `${folder}/${id}-r${String(++n).padStart(3, '0')}.png`;
              await api.put(app.dir, file, await toBlob(c));
              s.set(file);
            }
            bumpVersion();
            app.changed();
            await app.save(true);
            dialog.close();
            toast(`Recolored ${chosen.length} images`);
            onDone();
          },
        },
        icon(Check),
        'Apply',
      ),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  drawRows();
  drawPreview();
  dialog.showModal();
}
