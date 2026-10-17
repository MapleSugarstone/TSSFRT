// Generates characters/_examples/arc-phantom: half of Arc's moves and half of Phantom's, their stats averaged,
// placeholder SVG art (a big diamond, four small diamonds and a sharp triangle) and no template.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '../../..');
const ARC = path.join(root, 'characters/_templates/arc');
const PHANTOM = path.join(root, 'characters/_templates/phantom');
const OUT = path.join(root, 'characters/_examples/arc-phantom');
const arc = JSON.parse(fs.readFileSync(path.join(ARC, 'character.json'), 'utf8'));
const phantom = JSON.parse(fs.readFileSync(path.join(PHANTOM, 'character.json'), 'utf8'));
const project = JSON.parse(fs.readFileSync(path.join(root, 'sb3/project.json'), 'utf8'));

/** Size and opaque bounding box of a PNG, in image pixels. */
function pngBox(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (b[25] !== 6 || b[24] !== 8) return { w, h, box: [0, 0, w, h] };
  const idat = [];
  for (let i = 8; i < b.length; ) {
    const len = b.readUInt32BE(i);
    if (b.toString('ascii', i + 4, i + 8) === 'IDAT') idat.push(b.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
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

const C = { body: '#4b3bbf', small: '#a9b8ff', blade: '#eef2ff', line: '#160f3d', bladeLine: '#5a6488', shadow: '#7a3fd6' };
const r = (n) => Math.round(n * 100) / 100;
const diamond = (cx, cy, d, fill, line = C.line) => `<path d="M${r(cx)},${r(cy - d)} L${r(cx + d)},${r(cy)} L${r(cx)},${r(cy + d)} L${r(cx - d)},${r(cy)}Z" fill="${fill}" stroke="${line}" stroke-width="0.6"/>`;

/** The figure around its position point (x forward, y down): a big diamond, four small ones and a sharp triangle. */
function figure(p = {}) {
  const by = p.bodyDy ?? 0;
  const s = p.squash ?? 0;
  const hand = [7 + (p.handDx ?? 0), -4 + by + (p.handDy ?? 0)];
  const back = [-7, -4 + by];
  const fl = p.footL ?? [0, 0];
  const fr = p.footR ?? [0, 0];
  const parts = [];
  // The sharp triangle sits in the front hand and points along swordRot (0 is up, 90 is forward).
  const a = (((p.swordRot ?? 30) - 90) * Math.PI) / 180;
  const tip = [hand[0] + Math.cos(a) * 11, hand[1] + Math.sin(a) * 11];
  const side = [Math.cos(a + Math.PI / 2) * 1.6, Math.sin(a + Math.PI / 2) * 1.6];
  parts.push(`<path d="M${r(hand[0] + side[0])},${r(hand[1] + side[1])} L${r(tip[0])},${r(tip[1])} L${r(hand[0] - side[0])},${r(hand[1] - side[1])}Z" fill="${C.blade}" stroke="${C.bladeLine}" stroke-width="0.5"/>`);
  parts.push(diamond(back[0], back[1], 2, C.small));
  parts.push(diamond(-3 + fl[0], 3 + fl[1], 2, C.small));
  parts.push(diamond(3 + fr[0], 3 + fr[1], 2, C.small));
  parts.push(`<path d="M0,${r(-11 + by + s)} L6,${r(-5 + by + s / 2)} L0,${r(1 + by)} L-6,${r(-5 + by + s / 2)}Z" fill="${C.body}" stroke="${C.line}" stroke-width="0.6"/>`);
  parts.push(diamond(hand[0], hand[1], 2, C.small));
  if (p.shield) parts.push(`<circle cx="0" cy="-4" r="11" fill="#9ad7ff" fill-opacity="0.25" stroke="#9ad7ff" stroke-width="0.8"/>`);
  if (p.stars) parts.push(`<circle cx="-2" cy="-14" r="0.8" fill="#ffe14a"/><circle cx="3" cy="-15" r="0.8" fill="#ffe14a"/>`);
  if (p.orb) parts.push(`<circle cx="${r(hand[0] + 3)}" cy="${r(hand[1])}" r="2.4" fill="${C.shadow}" stroke="#2a0d55" stroke-width="0.5"/>`);
  return `<g transform="translate(${r(p.dx ?? 0)},${r(p.dy ?? 0)}) rotate(${p.rot ?? 0})" opacity="${p.alpha ?? 1}">${parts.join('')}</g>`;
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}" height="${r(h)}" viewBox="0 0 ${r(w)} ${r(h)}" shape-rendering="crispEdges">${body}</svg>\n`;
const FRAME = { w: 40, h: 34, cx: 20, cy: 24 };
const frameSvg = (pose) => svg(FRAME.w, FRAME.h, `<g transform="translate(${FRAME.cx},${FRAME.cy})">${figure(pose)}</g>`);

/** The action a frame belongs to: E1, E3 or E5 for combo frames, else its name without the frame number. */
const slotOf = (name) => (/^E[135](-|$)/.test(name) ? name.slice(0, 2) : name.replace(/(?:NL\d*|[-\d]+)$/, ''));

/** A pose per frame name, by its action and its number in the animation. */
function poseOf(name) {
  const n = Number(/(\d+)$/.exec(name)?.[1] ?? 1);
  const odd = n % 2 === 1;
  const slot = slotOf(name);
  switch (slot) {
    case 'idle': return { bodyDy: odd ? 0 : 1 };
    case 'run': return odd ? { footL: [1, 0], footR: [-1, -1], dy: -0.5, swordRot: 60 } : { footL: [-1, -1], footR: [1, 0], dy: -0.5, swordRot: 60 };
    case 'crouch': return { squash: 3, bodyDy: 2, handDy: 2 };
    case 'hurt': return { rot: -25 };
    case 'stunned': return { stars: true, swordRot: 160 };
    case 'jcharge': return { squash: 3, bodyDy: 1 };
    case 'jump': return { dy: -1, footL: [0, -1], footR: [0, -1], swordRot: 10 };
    case 'Djump': return { rot: -20, footL: [0, -1], footR: [0, -1] };
    case 'fall': return { swordRot: 0, handDy: -2 };
    case 'ledge': return { rot: 10, swordRot: 0 };
    case 'shield': return { shield: true };
    case 'Dodge': return { alpha: 0.4 };
    case 'Taunt': return { swordRot: (n * 45) % 360 };
    case 'NPunch': return { swordRot: 90, handDx: n };
    case 'RunPunch': return { rot: 15, swordRot: 100, handDx: 2 };
    case 'UpPunch': return { swordRot: n * 40, handDy: -3 };
    case 'DownPunch': return { swordRot: 170, handDx: 1, handDy: 3, squash: 2 };
    case 'DownAirPunch': return { rot: 90, swordRot: 90 };
    case 'E1': return { orb: true, handDx: n, swordRot: 10 };
    case 'E3': return { alpha: n === 2 ? 0.5 : 0.8, orb: true };
    case 'E5': return { swordRot: n * 30, handDx: 2 };
    case 'Dslsh': return { swordRot: odd ? 30 : 150, handDx: 3 };
    case 'Uslsh': return { swordRot: odd ? 150 : 20, handDx: 3 };
    case 'LastSlsh': return { swordRot: odd ? 10 : 110, handDx: 5, rot: odd ? 0 : 10 };
    default: throw new Error(`no pose for ${name}`);
  }
}

const script = fs.existsSync(path.join(OUT, 'gimmick.ts')) ? fs.readFileSync(path.join(OUT, 'gimmick.ts')) : null;
fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, data) => {
  fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
  fs.writeFileSync(path.join(OUT, rel), data);
};
if (script) write('gimmick.ts', script);

// Each animation comes from the character its move or state is taken from, with that character's names and speeds.
const FROM_ARC = ['idle', 'crouch', 'stunned', 'jcharge', 'Djump', 'shield', 'Taunt', 'NPunch', 'RunPunch', 'DownPunch', 'E5', 'Dslsh', 'Uslsh', 'LastSlsh'];
const FROM_PHANTOM = ['run', 'hurt', 'jump', 'fall', 'ledge', 'Dodge', 'UpPunch', 'DownAirPunch', 'E1', 'E3'];
// Actions go in the original characters' order. The game starts an animation at the first frame whose name
// begins with the action, ignoring case, so run's frames must come before RunPunch's.
const ORDER = ['idle', 'run', 'crouch', 'hurt', 'stunned', 'jcharge', 'jump', 'Djump', 'fall', 'ledge', 'shield', 'Dodge', 'Taunt', 'NPunch', 'RunPunch', 'UpPunch', 'DownPunch', 'DownAirPunch', 'E1', 'E3', 'E5', 'Dslsh', 'Uslsh', 'LastSlsh'];
const animations = [];
for (const slot of ORDER) {
  const src = FROM_ARC.includes(slot) ? arc : phantom;
  for (const f of src.animations) {
    if (slotOf(f.name) !== slot) continue;
    const file = `animations/${String(animations.length + 1).padStart(2, '0')}_${f.name.replace(/[^A-Za-z0-9_-]/g, '_')}.svg`;
    write(file, frameSvg(poseOf(f.name)));
    animations.push({ name: f.name, file, speed: f.speed, center: [FRAME.cx, FRAME.cy], resolution: 1 });
  }
}
for (const s of [...FROM_ARC, ...FROM_PHANTOM]) if (!animations.some((a) => slotOf(a.name) === s)) throw new Error(`no frames for ${s}`);

// Art: Arc's image sizes, with the placeholder drawn where Arc's art has pixels.
const art = {};
for (const [key, a] of Object.entries(arc.art)) {
  if (!a) continue;
  if (a.file.endsWith('.svg')) {
    const src = fs.readFileSync(path.join(ARC, a.file), 'utf8');
    const w = Number(/width="([\d.]+)"/.exec(src)[1]);
    const h = Number(/height="([\d.]+)"/.exec(src)[1]);
    const d = `M${r(w / 2)},2 L${r(w - 2)},${r(h / 2)} L${r(w / 2)},${r(h - 2)} L2,${r(h / 2)}Z`;
    write(`art/${key}.svg`, svg(w, h, `<path d="${d}" fill="#ffffff" fill-opacity="0.3" stroke="#ffffff" stroke-width="2.5"/><g transform="translate(${r(w / 2 - 6)},${r(h / 2 + 22)}) scale(3.6)">${figure()}</g>`));
    art[key] = { file: `art/${key}.svg`, center: a.center, resolution: 1 };
    continue;
  }
  const { w, h, box } = pngBox(path.join(ARC, a.file));
  const res = a.resolution || 2;
  const [x0, y0, x1, y1] = box.map((v) => v / res);
  const bw = x1 - x0;
  const bh = y1 - y0;
  let body;
  if (key === 'nameplate' || key === 'matchName') {
    const size = Math.min(bh * 0.8, (bw / 11) * 1.7);
    body = `<text x="${r(x0 + bw / 2)}" y="${r(y0 + bh / 2)}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${r(size)}" fill="#ffffff" stroke="#160f3d" stroke-width="${r(size / 12)}" paint-order="stroke" text-anchor="middle" dominant-baseline="central" shape-rendering="auto">ARC PHANTOM</text>`;
  } else if (key === 'aura') {
    body = `<ellipse cx="${r(x0 + bw / 2)}" cy="${r(y0 + bh / 2)}" rx="${r(bw / 2)}" ry="${r(bh / 2)}" fill="#8f6bff" fill-opacity="0.35"/>`;
  } else {
    // The figure spans about 24 by 26 around its position point, from (-9, -16) to (15, 5).
    const scale = Math.min(bw / 25, bh / 22) * 0.95;
    body = `<g transform="translate(${r(x0 + bw / 2 - 3 * scale)},${r(y0 + bh / 2 + 5.5 * scale)}) scale(${r(scale)})">${figure()}</g>`;
  }
  write(`art/${key}.svg`, svg(w / res, h / res, body));
  art[key] = { file: `art/${key}.svg`, center: [r(a.center[0] / res), r(a.center[1] / res)], resolution: 1 };
}

// Effect frames: a shape the size of the source character's frame.
function effect(kind, W, H, n, i, variant = 0) {
  const t = n > 1 ? i / (n - 1) : 0;
  const cx = W / 2;
  const cy = H / 2;
  if (kind === 'shadow') return `<circle cx="${cx}" cy="${cy}" r="${r(Math.min(W, H) / 2 - 1)}" fill="${C.shadow}" stroke="#2a0d55" stroke-width="0.8"/><circle cx="${cx}" cy="${cy}" r="${r(Math.min(W, H) / 5)}" fill="#e6d4ff"/>`;
  if (kind === 'burst') return `<circle cx="${cx}" cy="${cy}" r="${r((Math.min(W, H) / 2 - 1) * (0.5 + t / 2))}" fill="${C.shadow}" fill-opacity="0.4" stroke="#c9a6ff" stroke-width="${r(2 - t)}"/>`;
  if (kind === 'ring') return `<circle cx="${cx}" cy="${cy}" r="${r(Math.min(W, H) / 2 - 1)}" fill="none" stroke="#c9a6ff" stroke-width="1"/>`;
  if (kind === 'spike') {
    const tall = H * (0.6 + variant * 0.1);
    return `<path d="M1,${r(H - 1)} L${cx},${r(H - tall)} L${r(W - 1)},${r(H - 1)}Z" fill="#dfe6ff" stroke="${C.bladeLine}" stroke-width="0.6"/>`;
  }
  if (kind === 'finish') return `<path d="M1,${r(cy)} Q${cx},${r(cy - H / 2 + 1)} ${r(W - 1)},${r(cy)}" fill="none" stroke="#ffffff" stroke-width="${r(Math.max(1, H / 5))}" stroke-opacity="${r(0.9 - t * 0.4)}"/>`;
  const color = kind === 'phantom' ? '#b48cff' : '#ffffff';
  return `<rect x="1" y="1" width="${r(W - 2)}" height="${r(H - 2)}" rx="2" fill="${color}" fill-opacity="${r(0.5 - t * 0.3)}" stroke="${color}" stroke-width="0.8"/>`;
}

/** The frames of a move, drawn like the source frames, which are a pack file or a costume of the game's own. */
function frames(name, kind, sources, variant) {
  return sources.map((f, i) => {
    const { w, h } = pngBox(f.path);
    const res = f.resolution || 2;
    const W = Math.max(4, w / res);
    const H = Math.max(4, h / res);
    const file = `moves/${name}/${String(i + 1).padStart(2, '0')}.svg`;
    write(file, svg(W, H, effect(kind, W, H, sources.length, i, variant)));
    return { file, speed: f.speed, center: [r(f.center[0] / res), r(f.center[1] / res)], resolution: 1 };
  });
}
const packFrames = (dir, m) => m.hitboxes.map((f) => ({ path: path.join(dir, f.file), speed: f.speed, center: f.center, resolution: f.resolution }));
const costumeFrames = (prefix) =>
  project.targets.find((t) => t.name === 'Hitboxes').costumes
    .filter((c) => c.name.slice(c.name.indexOf(')') + 1).startsWith(`${prefix}-`))
    .map((c) => ({ path: path.join(root, 'sb3', c.md5ext), speed: Number(c.name.slice(0, c.name.indexOf(')'))), center: [c.rotationCenterX, c.rotationCenterY], resolution: c.bitmapResolution || 1 }));

const copy = (src, name) => JSON.parse(JSON.stringify(src.moves[name]));
const moves = {};
const take = (name, from, dir, srcName, kind, extra = {}) => {
  const m = copy(from, srcName);
  m.hitboxes = frames(name, kind, extra.sources ?? packFrames(dir, m), extra.variant);
  if (m.sound) {
    write(`sounds/${name}.wav`, fs.readFileSync(path.join(dir, m.sound.file)));
    m.sound = { ...m.sound, file: `sounds/${name}.wav` };
  }
  m.cues = [];
  moves[name] = m;
};
for (const name of ['NPunch', 'DownPunch', 'RunPunch', 'Taunt', 'E5']) take(name, arc, ARC, name, 'arc');
for (const name of ['UpPunch', 'DownAirPunch', 'Dodge', 'E3']) take(name, phantom, PHANTOM, name, 'phantom');
take('E1', phantom, PHANTOM, 'E1', 'shadow');
take('ShadowBurst', phantom, PHANTOM, 'E1-2_Impact', 'burst');
take('ShadowRing', phantom, PHANTOM, 'E1-2_Circle', 'ring');
take('Spike', arc, ARC, 'DownPunch-3_Spike', 'spike');
['SpikeA', 'SpikeB', 'SpikeC', 'SpikeD'].forEach((n, i) => take(n, arc, ARC, 'DownPunch-3_Spike', 'spike', { sources: costumeFrames(`E3-3_Spike${i + 1}`), variant: i }));
take('JudgementFinish', arc, ARC, 'E1', 'finish');
// Judgement's slash actions: the script switches the fighter to them, and these entries give them Arc's
// Unique animation and Can't move flags, which the game looks up by action.
for (const action of ['Dslsh', 'Uslsh', 'LastSlsh']) {
  const m = copy(arc, 'E5');
  moves[action] = { ...m, hitboxes: [], sound: null, cues: [], active: null, aiSpacing: null, freeze: null, hitSound: null, uniqueAnimation: true, cantMove: true, shieldBreaking: false, ignoreVelocityLimit: false };
}

const avg = (k) => r((Number(arc.stats[k]) + Number(phantom.stats[k])) / 2);
const pack = {
  format: arc.format,
  name: 'Arc Phantom',
  template: null,
  stats: Object.fromEntries(Object.keys(arc.stats).map((k) => [k, avg(k)])),
  text: {
    lore: 'Arc and Phantom, half and half, built from diamonds and a triangle in the mod maker. Five moves are Arc\'s and five are Phantom\'s, and every number in between is the average of the two.',
    mechanics: 'Arc\'s sword attacks and Judgement, with Phantom\'s shadowflame, teleport and air spin. No template: the moves are this character\'s own data and its gimmick script.',
    combo: [phantom.text.combo[0], phantom.text.combo[1], arc.text.combo[2]],
  },
  cpu: { behaviour: arc.cpu.behaviour, comboUsage: phantom.cpu.comboUsage, combos: [] },
  moves,
  animations,
  art,
  gimmick: 'gimmick.ts',
};
write('character.json', `${JSON.stringify(pack, null, 2)}\n`);
console.log('frames', animations.length, 'moves', Object.keys(moves).join(','), 'stats', JSON.stringify(pack.stats));
