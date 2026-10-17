// Generates characters/_examples/xavier-from-scratch: Xavier's moves and stats with no template and
// placeholder SVG art (a triangle body, a round head with dot eyes, square feet and an orb).
const { r, buildExample } = require('./shared.cjs');

const C = { body: '#6b4fd8', head: '#a996ff', feet: '#3f2c8c', line: '#1d1440', eye: '#0d0a1a', orb: '#4ad8ff', aura: '#8f7bff' };
const poly = (pts, fill) => `<path d="M${pts.map(([x, y]) => `${r(x)},${r(y)}`).join(' L')}Z" fill="${fill}" stroke="${C.line}" stroke-width="0.6"/>`;

/** The figure around its position point (x forward, y down). */
function figure(p) {
  const s = p.squash ?? 0;
  const [hx, hy] = [0.5 + (p.headDx ?? 0), -12 + s + (p.headDy ?? 0)];
  const fl = p.footL ?? [0, 0];
  const fr = p.footR ?? [0, 0];
  const [ox, oy] = p.orb ?? [7, -7];
  const parts = [
    `<rect x="${r(-4 + fl[0])}" y="${r(3 + fl[1])}" width="2.5" height="2" fill="${C.feet}" stroke="${C.line}" stroke-width="0.5"/>`,
    `<rect x="${r(1.5 + fr[0])}" y="${r(3 + fr[1])}" width="2.5" height="2" fill="${C.feet}" stroke="${C.line}" stroke-width="0.5"/>`,
    poly([[-6, 3], [5, 3], [-0.5 + (p.lean ?? 0), -8 + s]], C.body),
    `<circle cx="${r(hx)}" cy="${r(hy)}" r="4" fill="${C.head}" stroke="${C.line}" stroke-width="0.6"/>`,
  ];
  if (p.eyes === 'x') {
    for (const dx of [1.2, 3]) parts.push(`<path d="M${r(hx + dx - 0.6)},${r(hy - 1.1)}l1.2,1.2M${r(hx + dx + 0.6)},${r(hy - 1.1)}l-1.2,1.2" stroke="${C.eye}" stroke-width="0.5"/>`);
  } else if (p.eyes === 'closed') {
    for (const dx of [1.2, 3]) parts.push(`<rect x="${r(hx + dx - 0.6)}" y="${r(hy - 0.6)}" width="1.2" height="0.4" fill="${C.eye}"/>`);
  } else {
    for (const dx of [1.2, 3]) parts.push(`<circle cx="${r(hx + dx)}" cy="${r(hy - 0.5)}" r="0.6" fill="${C.eye}"/>`);
  }
  if (p.orb !== null) parts.push(`<circle cx="${r(ox)}" cy="${r(oy)}" r="${r(p.orbR ?? 2)}" fill="${C.orb}" stroke="${C.line}" stroke-width="0.5"/>`);
  if (p.shield) parts.push(`<circle cx="0" cy="-6" r="13" fill="#9ad7ff" fill-opacity="0.25" stroke="#9ad7ff" stroke-width="0.8"/>`);
  if (p.stars) parts.push(`<circle cx="0" cy="${r(hy - 6)}" r="0.8" fill="#ffe14a"/><circle cx="4" cy="${r(hy - 7)}" r="0.8" fill="#ffe14a"/>`);
  return `<g transform="translate(${r(p.dx ?? 0)},${r(p.dy ?? 0)}) rotate(${p.rot ?? 0})" opacity="${p.alpha ?? 1}">${parts.join('')}</g>`;
}

/** A pose for each of Xavier's frame names, from its action and its number. */
function pose(name) {
  const n = Number(/(\d+)\D*$/.exec(name)?.[1] ?? 1);
  const odd = n % 2 === 1;
  if (/^idle/.test(name)) return { headDy: odd ? 0 : 1, orb: [7, odd ? -7 : -6] };
  if (/^run/.test(name)) return odd ? { footL: [1, 0], footR: [-1, -1], lean: 1, orb: [-7, -6] } : { footL: [-1, -1], footR: [1, 0], lean: 1, orb: [-7, -7] };
  if (/^jcharge/.test(name)) return { squash: 3, orb: [6, -4] };
  if (/^(jump|Djump)/.test(name)) return { dy: -1, footL: [0, -1], footR: [0, -1], orb: [0, 5] };
  if (/^fall/.test(name)) return { headDy: -1, orb: [5, -14] };
  if (/^crouch/.test(name)) return { squash: 4, orb: [7, -3] };
  if (/^NPunch/.test(name)) return { orb: [6 + n * 2, -7], lean: n };
  if (/^RunPunch/.test(name)) return { rot: 10 * n, orb: [8 + n * 2, -6] };
  if (/^UpPunch/.test(name)) return { orb: [r(9 * Math.sin(n)), r(-12 - 6 * Math.abs(Math.cos(n)))], rot: (n * 50) % 360 };
  if (/^DownPunch/.test(name)) return { squash: n, orb: [6 + n * 3, 1] };
  if (/^DownAirPunch/.test(name)) return { orb: [2, 6 + n], footL: [0, -1], footR: [0, -1] };
  if (/^E1/.test(name)) return { orb: [8 + n * 2, -8], orbR: 3 };
  if (/^Impact/.test(name)) return { squash: 4, orb: [0, 4] };
  if (/^E3/.test(name)) return { orb: odd ? [8, -10] : [-8, -10], headDy: odd ? -1 : 0 };
  if (/^E5/.test(name)) return { orb: [0, -20 - n], orbR: 2 + n / 3, headDy: -1 };
  if (/^Taunt/.test(name)) return { eyes: 'closed', orb: [r(7 * Math.cos(n)), r(-8 + 6 * Math.sin(n))] };
  if (/^hurt/.test(name)) return { rot: -25, eyes: 'x', orb: [-6, -2] };
  if (/^stunned/.test(name)) return { eyes: 'x', stars: true, orb: [7, 0] };
  if (/^shield/.test(name)) return { shield: true };
  if (/^Dodge/.test(name)) return { alpha: 0.4 };
  if (/^ledge/.test(name)) return { rot: 10, headDy: -1, orb: [4, -16] };
  throw new Error(`no pose for ${name}`);
}

function effect(kind, W, H, n, i) {
  const t = n > 1 ? i / (n - 1) : 0;
  const [cx, cy, m] = [W / 2, H / 2, Math.min(W, H) / 2];
  if (kind === 'orb') return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(m - 1)}" fill="${C.orb}" fill-opacity="0.8" stroke="#1a6f8c" stroke-width="0.8"/><circle cx="${r(cx)}" cy="${r(cy)}" r="${r(m / 2.5)}" fill="#e8fbff"/>`;
  if (kind === 'ring') return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(m - 1)}" fill="none" stroke="${C.orb}" stroke-width="1.5"/>`;
  if (kind === 'pillar') return `<rect x="1" y="1" width="${r(W - 2)}" height="${r(H - 2)}" fill="${C.orb}" fill-opacity="0.5" stroke="${C.orb}" stroke-width="0.8"/>`;
  if (kind === 'rune') return `<path d="M${r(cx)},1 L${r(W - 1)},${r(cy)} L${r(cx)},${r(H - 1)} L1,${r(cy)}Z" fill="${C.head}" stroke="${C.line}" stroke-width="0.5"/>`;
  if (kind === 'planet') return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(m - 1)}" fill="${C.body}" fill-opacity="0.7" stroke="${C.line}" stroke-width="1"/><ellipse cx="${r(cx)}" cy="${r(cy)}" rx="${r(m)}" ry="${r(m / 4)}" fill="none" stroke="${C.orb}" stroke-width="1"/>`;
  return `<rect x="1" y="1" width="${r(W - 2)}" height="${r(H - 2)}" rx="2" fill="#ffffff" fill-opacity="${r(0.55 - t * 0.35)}" stroke="#ffffff" stroke-width="0.8"/>`;
}

buildExample({
  slug: 'xavier-from-scratch',
  from: 'xavier',
  name: 'Xavier From Scratch',
  rules: 'Xavier',
  lore: "Xavier, rebuilt from a triangle, a circle and an orb in the mod maker. He has no template: every move is his own data, his gimmick script does what Xavier's move scripts do, and he follows Xavier's movement rules for his hover.",
  colors: C,
  box: [-8, -17, 9, 5],
  figure,
  pose,
  effect,
  moves: {
    NPunch: { from: 'NPunch' },
    UpPunch: { from: 'UpPunch' },
    DownPunch: { from: 'DownPunch' },
    RunPunch: { from: 'RunPunch' },
    DownAirPunch: { from: 'DownAirPunch' },
    E1: { from: 'E1', kind: 'orb' },
    E3: { from: 'E3', kind: 'pillar' },
    E5: { from: 'E5', kind: 'ring' },
    Taunt: { from: 'Taunt' },
    Dodge: { from: 'Dodge' },
    OrbBurst: { from: 'E1-4_Impact', kind: 'ring' },
    Shockwave: { from: 'E3-4_Impact', kind: 'pillar' },
    Rune: { from: 'XavRune' },
    Rune1: { from: 'XavRune', costumes: ['2)XavRune1-1'], kind: 'rune' },
    Rune2: { from: 'XavRune', costumes: ['2)XavRune2-1'], kind: 'rune' },
    Rune3: { from: 'XavRune', costumes: ['2)XavRune3-1'], kind: 'rune' },
    Rune4: { from: 'XavRune', costumes: ['2)XavRune4-1'], kind: 'rune' },
    Rune5: { from: 'XavRune', costumes: ['2)XavRune5-1'], kind: 'rune' },
    Planet: { from: 'E5-4_Planet', kind: 'planet' },
  },
});
