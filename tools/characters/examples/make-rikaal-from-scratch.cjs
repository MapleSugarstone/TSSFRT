// Generates characters/_examples/rikaal-from-scratch: Rikaal's moves and stats with no template and
// placeholder SVG art (a wide trapezoid body, a horned square head with dot eyes, square feet and two big fists).
const { r, buildExample } = require('./shared.cjs');

const C = { body: '#a8322a', head: '#d65a4c', fist: '#6e1d18', feet: '#4a1410', horn: '#f0e0c0', line: '#2a0a08', eye: '#120404', aura: '#ff6b4f' };
const poly = (pts, fill) => `<path d="M${pts.map(([x, y]) => `${r(x)},${r(y)}`).join(' L')}Z" fill="${fill}" stroke="${C.line}" stroke-width="0.6"/>`;
const square = (x, y, s, fill) => `<rect x="${r(x - s / 2)}" y="${r(y - s / 2)}" width="${r(s)}" height="${r(s)}" fill="${fill}" stroke="${C.line}" stroke-width="0.6"/>`;

/** The figure around its position point (x forward, y down). */
function figure(p) {
  const s = p.squash ?? 0;
  const [hx, hy] = [1 + (p.headDx ?? 0), -12 + s + (p.headDy ?? 0)];
  const fl = p.footL ?? [0, 0];
  const fr = p.footR ?? [0, 0];
  const [bx, by] = p.back ?? [-11, -4];
  const [fx, fy] = p.front ?? [11, -4];
  const parts = [
    square(bx, by, 6, C.fist),
    `<rect x="${r(-8 + fl[0])}" y="${r(2 + fl[1])}" width="4" height="3" fill="${C.feet}" stroke="${C.line}" stroke-width="0.5"/>`,
    `<rect x="${r(4 + fr[0])}" y="${r(2 + fr[1])}" width="4" height="3" fill="${C.feet}" stroke="${C.line}" stroke-width="0.5"/>`,
    poly([[-10, 2], [10, 2], [8 + (p.lean ?? 0), -8 + s], [-8 + (p.lean ?? 0), -8 + s]], C.body),
    poly([[hx - 4, hy - 3], [hx - 3, hy - 6], [hx - 2, hy - 3]], C.horn),
    poly([[hx + 2, hy - 3], [hx + 3, hy - 6], [hx + 4, hy - 3]], C.horn),
    `<rect x="${r(hx - 4)}" y="${r(hy - 3)}" width="8" height="7" fill="${C.head}" stroke="${C.line}" stroke-width="0.6"/>`,
  ];
  if (p.eyes === 'x') {
    for (const dx of [1, 3]) parts.push(`<path d="M${r(hx + dx - 0.6)},${r(hy - 0.6)}l1.2,1.2M${r(hx + dx + 0.6)},${r(hy - 0.6)}l-1.2,1.2" stroke="${C.eye}" stroke-width="0.5"/>`);
  } else if (p.eyes === 'closed') {
    for (const dx of [1, 3]) parts.push(`<rect x="${r(hx + dx - 0.6)}" y="${r(hy)}" width="1.2" height="0.4" fill="${C.eye}"/>`);
  } else {
    for (const dx of [1, 3]) parts.push(`<circle cx="${r(hx + dx)}" cy="${r(hy)}" r="0.7" fill="${C.eye}"/>`);
  }
  parts.push(square(fx, fy, 6, C.fist));
  if (p.shield) parts.push(`<circle cx="0" cy="-5" r="16" fill="#9ad7ff" fill-opacity="0.25" stroke="#9ad7ff" stroke-width="0.8"/>`);
  if (p.stars) parts.push(`<circle cx="0" cy="${r(hy - 8)}" r="0.8" fill="#ffe14a"/><circle cx="4" cy="${r(hy - 9)}" r="0.8" fill="#ffe14a"/>`);
  return `<g transform="translate(${r(p.dx ?? 0)},${r(p.dy ?? 0)}) rotate(${p.rot ?? 0})" opacity="${p.alpha ?? 1}">${parts.join('')}</g>`;
}

/** A pose for each of Rikaal's frame names, from its action and its number. */
function pose(name) {
  const n = Number(/(\d+)\D*$/.exec(name)?.[1] ?? 1);
  const odd = n % 2 === 1;
  const a = name.toLowerCase();
  if (/^idle/.test(a)) return { headDy: odd ? 0 : 1, front: [11, odd ? -4 : -3], back: [-11, odd ? -4 : -3] };
  if (/^land/.test(a)) return { squash: 3, front: [12, 0], back: [-12, 0] };
  if (/^run/.test(a) && !/^runthrow/.test(a)) return odd ? { footL: [2, 0], footR: [-2, -1], lean: 2, front: [8, -2], back: [-12, -6] } : { footL: [-2, -1], footR: [2, 0], lean: 2, front: [12, -6], back: [-8, -2] };
  if (/^jcharge/.test(a)) return { squash: 3, front: [12, -1], back: [-12, -1] };
  if (/^(djump|jump)/.test(a)) return { dy: -1, footL: [0, -1], footR: [0, -1], front: [10, -12], back: [-10, -12] };
  if (/^fall/.test(a)) return { headDy: -1, front: [12, -10], back: [-12, -10] };
  if (/^crouch/.test(a)) return { squash: 4, front: [10, 0], back: [-10, 0] };
  if (/^ledge/.test(a)) return { rot: 10, front: [6, -18], back: [-2, -18] };
  if (/^dodge/.test(a)) return { alpha: 0.4 };
  if (/^shield/.test(a)) return { shield: true, front: [8, -8], back: [-8, -8] };
  if (/^(hurt|stunned)/.test(a)) return { rot: -20, eyes: 'x', stars: /^stunned/.test(a), front: [6, 0], back: [-12, -10] };
  if (/^runpunch/.test(a)) return { lean: 3, front: [12 + n * 3, -6], back: [-10, -4] };
  if (/^runthrow/.test(a)) return { front: [10 + (n % 3) * 2, -14 + n * 3], back: [6, -12] };
  if (/^downpunch/.test(a)) return { squash: 2, front: [10 + n * 4, 1], back: [-8 + n * 3, 1] };
  if (/^uppunch/.test(a)) return { front: [6, -16 - (n % 4) * 2], back: [-6, -14], dy: -(n % 3) };
  if (/^npunch/.test(a)) return { lean: 2, front: [12 + n * 3, -6 - n], back: [-10, -6] };
  if (/^downairpunch/.test(a)) return { rot: n > 1 ? 15 : 0, front: [8, 4 + n * 2], back: [-6, 4 + n * 2] };
  if (/^downslide/.test(a)) return { rot: 60, front: [14, 0], back: [6, 2] };
  if (/^downthrow/.test(a)) return { rot: (n * 30) % 360, front: [8, -14], back: [-8, -14] };
  if (/^upthrow/.test(a)) return { front: [4, -18 - n], back: [-4, -18 - n] };
  if (/^fthrow/.test(a)) return { lean: 3, front: [12 + n * 3, -8], back: [6, -8] };
  if (/^(e1|upe|ebreak|breakthrow)/.test(a)) return { front: [10 + (n % 3) * 3, -6 - (n % 2) * 8], back: [-8, -10] };
  if (/^e3/.test(a)) return { headDy: -1, eyes: 'closed', front: [14, -14], back: [-14, -14] };
  if (/^e5/.test(a)) return { front: [12, -10 - (n % 3) * 2], back: [8, -10] };
  if (/^taunt/.test(a)) return { eyes: odd ? 'closed' : undefined, front: [10, odd ? -14 : -4], back: [-10, odd ? -4 : -14] };
  throw new Error(`no pose for ${name}`);
}

function effect(kind, W, H, n, i) {
  const t = n > 1 ? i / (n - 1) : 0;
  const [cx, cy, m] = [W / 2, H / 2, Math.min(W, H) / 2];
  if (kind === 'roar') return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r((m - 1) * (0.6 + t * 0.4))}" fill="none" stroke="${C.aura}" stroke-width="2"/>`;
  if (kind === 'beam') return `<rect x="1" y="${r(H / 4)}" width="${r(W - 2)}" height="${r(H / 2)}" fill="#ff3020" fill-opacity="0.8" stroke="#ffd0c0" stroke-width="0.8"/>`;
  if (kind === 'shadow') return `<rect x="1" y="${r(H / 4)}" width="${r(W - 2)}" height="${r(H / 2)}" fill="#300808" fill-opacity="0.6"/>`;
  return `<rect x="1" y="1" width="${r(W - 2)}" height="${r(H - 2)}" rx="2" fill="#ffffff" fill-opacity="${r(0.55 - t * 0.35)}" stroke="#ffffff" stroke-width="0.8"/>`;
}

buildExample({
  slug: 'rikaal-from-scratch',
  from: 'rikaal',
  name: 'Rikaal From Scratch',
  rules: 'Rikaal',
  lore: "Rikaal, rebuilt from a trapezoid, a horned square and two big fists in the mod maker. He has no template: every move is his own data, his gimmick script does what Rikaal's move scripts do, and he follows Rikaal's movement rules for his heavy landing.",
  colors: C,
  box: [-14, -18, 14, 5],
  figure,
  pose,
  effect,
  moves: {
    NPunch: { from: 'NPunch' },
    UpPunch: { from: 'UpPunch' },
    DownPunch: { from: 'DownPunch' },
    RunPunch: { from: 'RunPunch' },
    DownAirPunch: { from: 'DownAirPunch' },
    E1: { from: 'E1' },
    E3: { from: 'E3', kind: 'roar' },
    E5: { from: 'E5' },
    Taunt: { from: 'Taunt' },
    Dodge: { from: 'Dodge' },
    Beam: { from: 'RedBeam', kind: 'beam' },
    // The game has no move data for Rikaal's beam shadow, so it takes the taunt's empty data. Its script
    // turns it all the way around, which the Rotation attribute does here.
    BeamShadow: { from: 'Taunt', blank: true, attributes: { rotateStyle: 'all' }, costumes: ['6)RedShadow-1', '5)RedShadow-2', '6)RedShadow-3', '5)RedShadow-4'], kind: 'shadow' },
  },
  // Actions the script switches the fighter to, with the flags the game gives Rikaal's.
  actions: {
    RunThrow: { uniqueAnimation: true, cantMove: true },
    DownThrow: { uniqueAnimation: true, cantMove: true },
    UpThrow: { uniqueAnimation: true, cantMove: true },
    Fthrow: { uniqueAnimation: true },
    BreakThrow: { uniqueAnimation: true },
    Ebreak: { uniqueAnimation: true, cantMove: true, ignoreVelocityLimit: true },
    UpE: { uniqueAnimation: true, cantMove: true },
    downslide: { uniqueAnimation: true, cantMove: true },
    land: { uniqueAnimation: true, cantMove: true },
  },
});
