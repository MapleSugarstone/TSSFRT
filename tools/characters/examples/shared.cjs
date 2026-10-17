// Helpers the example generators share: PNG measurements, SVG output, and the original game's costumes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '../../..');

/** Size and opaque bounding box of a PNG, in image pixels. */
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

const r = (n) => Math.round(n * 100) / 100;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}" height="${r(h)}" viewBox="0 0 ${r(w)} ${r(h)}" shape-rendering="crispEdges">${body}</svg>\n`;

let project = null;
/** A costume of one of the original game's sprites by its full name, such as "2)XavRune1-1", with its image size in stage pixels. */
function gameCostume(sprite, name) {
  project ??= JSON.parse(fs.readFileSync(path.join(root, 'sb3/project.json'), 'utf8'));
  const c = project.targets.find((t) => t.name === sprite)?.costumes.find((x) => x.name === name);
  if (!c) throw new Error(`no costume ${name} in ${sprite}`);
  const res = c.bitmapResolution || 1;
  const file = path.join(root, 'sb3', c.md5ext);
  const { w, h } = c.dataFormat === 'png' ? pngBox(file) : { w: 2, h: 2 };
  return { w: Math.max(4, w / res), h: Math.max(4, h / res), center: [r(c.rotationCenterX / res), r(c.rotationCenterY / res)] };
}

/** Removes a generated example folder but keeps its gimmick script, and returns a writer for files inside it. */
function resetFolder(out) {
  const script = fs.existsSync(path.join(out, 'gimmick.ts')) ? fs.readFileSync(path.join(out, 'gimmick.ts')) : null;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  if (script) fs.writeFileSync(path.join(out, 'gimmick.ts'), script);
  return (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), data);
  };
}

/** The speed code of a game costume name such as "2)XavRune1-1". */
const speedOf = (costume) => Number(/^(\d)\)/.exec(costume)?.[1] ?? 1);

/**
 * Writes an example character with no template, made from an original character's pack: its stats, CPU
 * data, move data, frame names, speeds and sounds, with placeholder SVG art.
 *
 * cfg.figure(pose) draws the fighter around its position point (x forward, y down) inside cfg.box
 * ([left, top, right, bottom]). cfg.pose(frameName) gives the pose of each animation frame. cfg.moves maps
 * each move of the new character to { from: the original's move name, costumes: game costume names for a
 * hitbox the original's pack has no frames for, kind: the effect shape, blank: true for no sound or flags,
 * attributes: attributes to change, rules: the original move whose built-in rules it follows }. cfg.actions maps action names to
 * the flags of an entry with no hitbox. cfg.effect(kind, W, H, n, i) draws an effect frame.
 */
function buildExample(cfg) {
  const T = path.join(root, 'characters/_templates', cfg.from);
  const OUT = path.join(root, 'characters/_examples', cfg.slug);
  const tmpl = JSON.parse(fs.readFileSync(path.join(T, 'character.json'), 'utf8'));
  const write = resetFolder(OUT);
  const [bx0, by0, bx1, by1] = cfg.box;

  const FRAME = { w: Math.ceil(bx1 - bx0 + 20), h: Math.ceil(by1 - by0 + 20), cx: Math.ceil(-bx0 + 10), cy: Math.ceil(-by0 + 10) };
  const animations = tmpl.animations.map((f, i) => {
    const file = `animations/${String(i + 1).padStart(2, '0')}_${f.name.replace(/[^A-Za-z0-9_-]/g, '_')}.svg`;
    write(file, svg(FRAME.w, FRAME.h, `<g transform="translate(${FRAME.cx},${FRAME.cy})">${cfg.figure(cfg.pose(f.name))}</g>`));
    return { name: f.name, file, speed: f.speed, center: [FRAME.cx, FRAME.cy], resolution: 1 };
  });

  // Art: each image the size the original's is, with the figure drawn where the original's art has pixels.
  const art = {};
  const bw0 = bx1 - bx0;
  const bh0 = by1 - by0;
  for (const [key, a] of Object.entries(tmpl.art)) {
    if (!a) continue;
    if (a.file.endsWith('.svg')) {
      const src = fs.readFileSync(path.join(T, a.file), 'utf8');
      const w = Number(/width="([\d.]+)"/.exec(src)[1]);
      const h = Number(/height="([\d.]+)"/.exec(src)[1]);
      const d = `M${r(w / 2)},2 L${r(w - 2)},${r(h / 2)} L${r(w / 2)},${r(h - 2)} L2,${r(h / 2)}Z`;
      const scale = (Math.min(w, h) * 0.55) / Math.max(bw0, bh0);
      const body = `<path d="${d}" fill="#ffffff" fill-opacity="0.3" stroke="#ffffff" stroke-width="2.5"/><g transform="translate(${r(w / 2 - (bx0 + bw0 / 2) * scale)},${r(h / 2 - (by0 + bh0 / 2) * scale)}) scale(${r(scale)})">${cfg.figure({})}</g>`;
      write(`art/${key}.svg`, svg(w, h, body));
      art[key] = { file: `art/${key}.svg`, center: a.center, resolution: 1 };
      continue;
    }
    const { w, h, box } = pngBox(path.join(T, a.file));
    const res = a.resolution || 2;
    const [x0, y0, x1, y1] = box.map((v) => v / res);
    const bw = x1 - x0;
    const bh = y1 - y0;
    let body;
    if (key === 'nameplate' || key === 'matchName') {
      const size = Math.min(bh * 0.8, (bw / cfg.name.length) * 1.7);
      body = `<text x="${r(x0 + bw / 2)}" y="${r(y0 + bh / 2)}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${r(size)}" fill="#ffffff" stroke="${cfg.colors.line}" stroke-width="${r(size / 12)}" paint-order="stroke" text-anchor="middle" dominant-baseline="central" shape-rendering="auto">${cfg.name.toUpperCase()}</text>`;
    } else if (key === 'aura') {
      body = `<ellipse cx="${r(x0 + bw / 2)}" cy="${r(y0 + bh / 2)}" rx="${r(bw / 2)}" ry="${r(bh / 2)}" fill="${cfg.colors.aura}" fill-opacity="0.35"/>`;
    } else {
      const scale = Math.min(bw / bw0, bh / bh0) * 0.95;
      const cx = x0 + bw / 2 - (bx0 + bw0 / 2) * scale;
      const cy = y0 + bh / 2 - (by0 + bh0 / 2) * scale;
      body = `<g transform="translate(${r(cx)},${r(cy)}) scale(${r(scale)})">${cfg.figure({})}</g>`;
    }
    write(`art/${key}.svg`, svg(w / res, h / res, body));
    art[key] = { file: `art/${key}.svg`, center: [r(a.center[0] / res), r(a.center[1] / res)], resolution: 1 };
  }

  // Moves: the original's data, with effect frames the size of its frames at its frame speeds.
  const moves = {};
  for (const [name, m0] of Object.entries(cfg.moves)) {
    const m = JSON.parse(JSON.stringify(tmpl.moves[m0.from]));
    if (m0.blank) Object.assign(m, { sound: null, uniqueAnimation: false, cantMove: false, shieldBreaking: false, ignoreVelocityLimit: false, hitSound: null });
    Object.assign(m.attributes, m0.attributes);
    if (m0.rules) m.rules = m0.rules;
    const sources = m0.costumes
      ? m0.costumes.map((c) => ({ ...gameCostume('Hitboxes', c), speed: speedOf(c) }))
      : m.hitboxes.map((f) => {
          const { w, h } = pngBox(path.join(T, f.file));
          const res = f.resolution || 2;
          return { w: Math.max(4, w / res), h: Math.max(4, h / res), center: [r(f.center[0] / res), r(f.center[1] / res)], speed: f.speed };
        });
    m.hitboxes = sources.map((s, i) => {
      const file = `moves/${name}/${String(i + 1).padStart(2, '0')}.svg`;
      write(file, svg(s.w, s.h, cfg.effect(m0.kind ?? 'slash', s.w, s.h, sources.length, i)));
      return { file, speed: s.speed, center: s.center, resolution: 1 };
    });
    if (m.sound) {
      const file = `sounds/${name}${path.extname(m.sound.file)}`;
      write(file, fs.readFileSync(path.join(T, m.sound.file)));
      m.sound = { ...m.sound, file };
    }
    m.cues = [];
    moves[name] = m;
  }
  const empty = Object.fromEntries(Object.keys(tmpl.moves.Taunt.attributes).map((k) => [k, '']));
  for (const [name, flags] of Object.entries(cfg.actions ?? {})) {
    moves[name] = { attributes: { ...empty }, hitboxes: [], active: null, aiSpacing: null, cantMove: !!flags.cantMove, uniqueAnimation: !!flags.uniqueAnimation, shieldBreaking: false, ignoreVelocityLimit: !!flags.ignoreVelocityLimit, freeze: null, hitSound: null, sound: null, cues: [] };
  }

  const pack = {
    format: tmpl.format,
    name: cfg.name,
    template: null,
    rules: cfg.rules,
    stats: tmpl.stats,
    text: { lore: cfg.lore, mechanics: tmpl.text.mechanics, combo: tmpl.text.combo },
    cpu: tmpl.cpu,
    moves,
    animations,
    art,
    gimmick: 'gimmick.ts',
  };
  write('character.json', `${JSON.stringify(pack, null, 2)}\n`);
  console.log(cfg.name, 'frames', animations.length, 'art', Object.keys(art).length, 'moves', Object.keys(moves).join(','));
}

module.exports = { root, pngBox, r, svg, gameCostume, resetFolder, buildExample };
