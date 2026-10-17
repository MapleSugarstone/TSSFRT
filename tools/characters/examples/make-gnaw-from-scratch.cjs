// Generates characters/_examples/gnaw-from-scratch: Gnaw's moves and stats with placeholder SVG art
// (three squares, dot eyes, two square feet) and no template.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '../../..');
const T = path.join(root, 'characters/_templates/gnaw');
const OUT = path.join(root, 'characters/_examples/gnaw-from-scratch');
const tmpl = JSON.parse(fs.readFileSync(path.join(T, 'character.json'), 'utf8'));

/** Size and opaque bounding box of an RGBA PNG, in image pixels. */
function pngBox(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const type = b[25];
  const idat = [];
  for (let i = 8; i < b.length; ) {
    const len = b.readUInt32BE(i);
    const kind = b.toString('ascii', i + 4, i + 8);
    if (kind === 'IDAT') idat.push(b.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  if (type !== 6) return { w, h, box: [0, 0, w, h] };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      let o = v;
      if (f === 1) o = v + a;
      else if (f === 2) o = v + up;
      else if (f === 3) o = v + ((a + up) >> 1);
      else if (f === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        o = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      }
      px[y * stride + x] = o & 255;
    }
  }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * stride + x * 4 + 3] > 20) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  return { w, h, box: x1 > x0 ? [x0, y0, x1, y1] : [0, 0, w, h] };
}

const C = { body: '#4caf50', head: '#62c95e', tail: '#3c8f40', feet: '#2e6b31', line: '#173a19', eye: '#101410', mouth: '#7a1f1f' };
const r = (n) => Math.round(n * 100) / 100;
const rect = (x, y, w, h, fill, extra = '') => `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}" stroke="${C.line}" stroke-width="0.6"${extra}/>`;

/** The figure around its position point (x forward, y down): body, head and tail squares, dot eyes and square feet. */
function figure(p = {}) {
  const s = p.squash ?? 0;
  const by = p.bodyDy ?? 0;
  const parts = [];
  const tail = [-8 + (p.tailDx ?? 0), -2 + by + (p.tailDy ?? 0) + s];
  const head = [1 + (p.headDx ?? 0), -10 + by + (p.headDy ?? 0) + s];
  parts.push(rect(tail[0], tail[1], 4, 4, C.tail));
  const fl = p.footL ?? [0, 0];
  const fr = p.footR ?? [0, 0];
  parts.push(rect(-3 + fl[0], 3 + fl[1], 2, 2, C.feet));
  parts.push(rect(1 + fr[0], 3 + fr[1], 2, 2, C.feet));
  parts.push(rect(-4, -5 + by + s, 8, 8 - s, C.body));
  parts.push(rect(head[0], head[1], 6, 6, C.head));
  const ex = head[0] + 3.2;
  const ey = head[1] + 2;
  if (p.eyes === 'x') {
    for (const dx of [0, 2]) parts.push(`<path d="M${r(ex + dx - 0.6)},${r(ey - 0.6)}l1.2,1.2M${r(ex + dx + 0.6)},${r(ey - 0.6)}l-1.2,1.2" stroke="${C.eye}" stroke-width="0.5"/>`);
  } else if (p.eyes === 'closed') {
    for (const dx of [0, 2]) parts.push(`<rect x="${r(ex + dx - 0.6)}" y="${r(ey)}" width="1.2" height="0.4" fill="${C.eye}"/>`);
  } else {
    for (const dx of [0, 2]) parts.push(`<circle cx="${r(ex + dx)}" cy="${r(ey)}" r="0.6" fill="${C.eye}"/>`);
  }
  if (p.mouth) parts.push(`<rect x="${r(head[0] + 3)}" y="${r(head[1] + 3.6)}" width="${r(p.mouth)}" height="1.6" fill="${C.mouth}"/>`);
  if (p.shield) parts.push(`<circle cx="0" cy="-3" r="11" fill="#9ad7ff" fill-opacity="0.25" stroke="#9ad7ff" stroke-width="0.8"/>`);
  if (p.stars) parts.push(`<circle cx="2" cy="${r(head[1] - 2)}" r="0.8" fill="#ffe14a"/><circle cx="6" cy="${r(head[1] - 3)}" r="0.8" fill="#ffe14a"/>`);
  const move = `translate(${r(p.dx ?? 0)},${r(p.dy ?? 0)}) rotate(${p.rot ?? 0})`;
  return `<g transform="${move}" opacity="${p.alpha ?? 1}">${parts.join('')}</g>`;
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}" height="${r(h)}" viewBox="0 0 ${r(w)} ${r(h)}" shape-rendering="crispEdges">${body}</svg>\n`;

/** One animation frame: a 32 by 28 canvas whose point (16, 20) is the fighter's position. */
const FRAME = { w: 32, h: 28, cx: 16, cy: 20 };
const frameSvg = (pose) => svg(FRAME.w, FRAME.h, `<g transform="translate(${FRAME.cx},${FRAME.cy})">${figure(pose)}</g>`);

const POSES = {
  idle1: {},
  idle2: { bodyDy: 1 },
  run1: { footL: [1, 0], footR: [-1, -1], dy: -0.5 },
  run2: { footL: [-1, -1], footR: [1, 0], dy: -0.5 },
  jcharge1: { squash: 2 },
  jchargeNL: { squash: 3 },
  jumpNL: { dy: -1, footL: [0, -1], footR: [0, -1], tailDy: 2 },
  DjumpNL: { rot: -20, footL: [0, -1], footR: [0, -1] },
  fall2: { tailDy: -2, headDy: -1 },
  crouch1: { squash: 2, headDy: 1 },
  crouch2: { squash: 3, headDy: 2 },
  NPunch2: { headDx: 2 },
  NPunch3: { headDx: 4, mouth: 2 },
  NPunch4: { headDx: 5, mouth: 2.6 },
  'DownPunch1-1': { headDx: 3, headDy: 3, squash: 1 },
  'DownPunch1-2': { headDx: 4, headDy: 4, squash: 2, mouth: 2 },
  'DownAirPunch1-3': { rot: 60 },
  'DownAirPunch1-2': { rot: 90 },
  'DownAirPunch1-4': { rot: 90, mouth: 2 },
  hurtNL: { rot: -25, eyes: 'x' },
  RunPunch1: { rot: 15, headDx: 2 },
  RunPunch2: { rot: 20, headDx: 4, mouth: 2 },
  UpPunch1: { headDy: -3, headDx: -1 },
  UpPunch2: { headDy: -6, headDx: -2, mouth: 2 },
  'E1-1': { headDx: 2, mouth: 1.5 },
  'E1-2': { headDx: 3, mouth: 2.6 },
  'E3-1': { headDx: 4, mouth: 1.5 },
  'E3-2': { headDx: 6, mouth: 2.8 },
  'E3-3': { headDx: 6, mouth: 0.6 },
  'E5-1': { headDy: -2, headDx: 1, mouth: 1.5 },
  'E5-2': { headDy: -3, headDx: 2, mouth: 2.6 },
  'E5-3': { headDy: -3, headDx: 3, mouth: 2.6 },
  'E5-4': { headDy: -1, headDx: 2, mouth: 1.5 },
  shield1: { shield: true },
  DodgeNL: { alpha: 0.4 },
  stunned1: { eyes: 'x', stars: true },
  stunned2: { eyes: 'x', stars: true, bodyDy: 1 },
  ledge1: { rot: 10, headDy: -1 },
};
for (let i = 1; i <= 8; i++) POSES[`Taunt${i}`] = i % 2 ? { dy: -2, eyes: 'closed' } : { eyes: 'closed' };

const script = fs.existsSync(path.join(OUT, 'gimmick.ts')) ? fs.readFileSync(path.join(OUT, 'gimmick.ts')) : null;
fs.rmSync(OUT, { recursive: true, force: true });
if (script) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'gimmick.ts'), script);
}
const write = (rel, data) => {
  fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
  fs.writeFileSync(path.join(OUT, rel), data);
};

// Animations: Gnaw's frame names and speeds, drawn as the placeholder figure.
const animations = tmpl.animations.map((f, i) => {
  const pose = POSES[f.name];
  if (!pose) throw new Error(`no pose for ${f.name}`);
  const file = `animations/${String(i + 1).padStart(2, '0')}_${f.name.replace(/[^A-Za-z0-9_-]/g, '_')}.svg`;
  write(file, frameSvg(pose));
  return { name: f.name, file, speed: f.speed, center: [FRAME.cx, FRAME.cy], resolution: 1 };
});

// Art: each image the size Gnaw's is, with the placeholder drawn where Gnaw's art has pixels.
const art = {};
for (const [key, a] of Object.entries(tmpl.art)) {
  if (!a) continue;
  if (a.file.endsWith('.svg')) {
    // The roster icon: a diamond frame with the figure inside.
    const src = fs.readFileSync(path.join(T, a.file), 'utf8');
    const w = Number(/width="([\d.]+)"/.exec(src)[1]);
    const h = Number(/height="([\d.]+)"/.exec(src)[1]);
    const d = `M${r(w / 2)},2 L${r(w - 2)},${r(h / 2)} L${r(w / 2)},${r(h - 2)} L2,${r(h / 2)}Z`;
    const body = `<path d="${d}" fill="#ffffff" fill-opacity="0.3" stroke="#ffffff" stroke-width="2.5"/><g transform="translate(${r(w / 2)},${r(h / 2 + 18)}) scale(4.2)">${figure()}</g>`;
    write(`art/${key}.svg`, svg(w, h, body));
    art[key] = { file: `art/${key}.svg`, center: a.center, resolution: 1 };
    continue;
  }
  const { w, h, box } = pngBox(path.join(T, a.file));
  const res = a.resolution || 2;
  const [x0, y0, x1, y1] = box.map((v) => v / res);
  const W = w / res;
  const H = h / res;
  const bw = x1 - x0;
  const bh = y1 - y0;
  let body;
  if (key === 'nameplate' || key === 'matchName') {
    const size = Math.min(bh * 0.8, (bw / 17) * 1.7);
    body = `<text x="${r(x0 + bw / 2)}" y="${r(y0 + bh / 2)}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${r(size)}" fill="#ffffff" stroke="#173a19" stroke-width="${r(size / 12)}" paint-order="stroke" text-anchor="middle" dominant-baseline="central" shape-rendering="auto">GNAW FROM SCRATCH</text>`;
  } else if (key === 'aura') {
    body = `<ellipse cx="${r(x0 + bw / 2)}" cy="${r(y0 + bh / 2)}" rx="${r(bw / 2)}" ry="${r(bh / 2)}" fill="#7dff6e" fill-opacity="0.35"/>`;
  } else {
    // The figure is 15 wide and 15 tall around its position point, from (-8, -10) to (7, 5).
    const scale = Math.min(bw / 16, bh / 16) * 0.95;
    const cx = x0 + bw / 2 + 0.5 * scale;
    const cy = y0 + bh / 2 + 2.5 * scale;
    body = `<g transform="translate(${r(cx)},${r(cy)}) scale(${r(scale)})">${figure()}</g>`;
  }
  write(`art/${key}.svg`, svg(W, H, body));
  art[key] = { file: `art/${key}.svg`, center: [r(a.center[0] / res), r(a.center[1] / res)], resolution: 1 };
}

// Effect frames: a shape the size of Gnaw's matching frame, at his frame speeds.
const effect = (kind, W, H, n, i) => {
  const t = n > 1 ? i / (n - 1) : 0;
  let body;
  if (kind === 'flame') body = `<circle cx="${W / 2}" cy="${H / 2}" r="${r(Math.min(W, H) / 2 - 1 + i)}" fill="#ff7a1a" stroke="#a83a00" stroke-width="0.8"/><circle cx="${W / 2 + 1}" cy="${H / 2}" r="${r(Math.min(W, H) / 5)}" fill="#ffe14a"/>`;
  else if (kind === 'ground') body = `<path d="M2,${H - 1} L${r(W / 2 - 2 + (i % 2))},${r(2 + i)} L${W / 2},${H / 2} L${r(W / 2 + 3 - (i % 2))},${r(1 + i)} L${W - 2},${H - 1}Z" fill="#ff7a1a" stroke="#a83a00" stroke-width="0.8"/>`;
  else if (kind === 'burst') body = `<circle cx="${W / 2}" cy="${H / 2}" r="${r((Math.min(W, H) / 2 - 1) * (0.5 + t / 2))}" fill="none" stroke="#ffb02e" stroke-width="${r(2.5 - t * 1.5)}"/>`;
  else body = `<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="2" fill="#ffffff" fill-opacity="${r(0.55 - t * 0.35)}" stroke="#ffffff" stroke-width="0.8"/>`;
  return { svg: svg(W, H, body), center: [W / 2, H / 2] };
};

const SOUND = { NPunch: 'NPunch', UpPunch: 'UpPunch', DownPunch: 'DownPunch', RunPunch: 'RunPunch', DownAirPunch: 'DownAirPunch', E3: 'E3', Taunt: 'Taunt', Flame: 'Fireball', FlameGround: 'FireStationary' };
const FROM = { Flame: 'Fireball', FlameGround: 'FireStationary', FlameBurst: 'FireballImpact', BiteGrab: 'E3-1_Grab' };
const KIND = { Flame: 'flame', FlameGround: 'ground', FlameBurst: 'burst' };
const moves = {};
for (const name of ['NPunch', 'UpPunch', 'DownPunch', 'RunPunch', 'DownAirPunch', 'E1', 'E3', 'E5', 'Taunt', 'Dodge', 'Flame', 'FlameGround', 'FlameBurst', 'BiteGrab']) {
  const m = JSON.parse(JSON.stringify(tmpl.moves[FROM[name] ?? name]));
  const n = m.hitboxes.length;
  m.hitboxes = m.hitboxes.map((f, i) => {
    const { w, h } = pngBox(path.join(T, f.file));
    const res = f.resolution || 2;
    const e = effect(KIND[name] ?? 'slash', Math.max(4, w / res), Math.max(4, h / res), n, i);
    const file = `moves/${name}/${String(i + 1).padStart(2, '0')}.svg`;
    write(file, e.svg);
    return { file, speed: f.speed, center: [r(f.center[0] / res), r(f.center[1] / res)], resolution: 1 };
  });
  if (SOUND[name]) {
    fs.mkdirSync(path.join(OUT, 'sounds'), { recursive: true });
    fs.copyFileSync(path.join(T, `sounds/${SOUND[name]}.wav`), path.join(OUT, `sounds/${name}.wav`));
    m.sound = { ...m.sound, file: `sounds/${name}.wav` };
  } else m.sound = null;
  m.cues = [];
  moves[name] = m;
}

const pack = {
  format: tmpl.format,
  name: 'Gnaw From Scratch',
  template: null,
  rules: 'Gnaw',
  stats: tmpl.stats,
  text: {
    lore: 'Gnaw, rebuilt out of three squares in the mod maker. He has no template: every move is his own data, and his gimmick script does what Gnaw\'s move scripts do.',
    mechanics: tmpl.text.mechanics,
    combo: tmpl.text.combo,
  },
  cpu: tmpl.cpu,
  moves,
  animations,
  art,
  gimmick: 'gimmick.ts',
};
write('character.json', `${JSON.stringify(pack, null, 2)}\n`);
console.log('frames', animations.length, 'art', Object.keys(art).join(','), 'moves', Object.keys(moves).join(','));
