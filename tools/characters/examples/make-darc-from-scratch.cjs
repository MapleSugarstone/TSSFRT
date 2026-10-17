// Generates characters/_examples/darc-from-scratch: Darc's moves and stats with no template and placeholder
// SVG art (a dark hooded square with glowing eyes, a trailing scarf, square feet and a thin blade).
const { r, buildExample } = require('./shared.cjs');

const C = { hood: '#2b2140', face: '#120d1c', feet: '#1a1426', scarf: '#c8283c', blade: '#e8e4f4', eye: '#7df9ff', line: '#07050c', aura: '#8a4dff' };

/** The figure around its position point (x forward, y down). */
function figure(p) {
  const s = p.squash ?? 0;
  const fl = p.footL ?? [0, 0];
  const fr = p.footR ?? [0, 0];
  const w = p.wave ?? 0;
  const [bx1, by1, bx2, by2] = p.blade ?? [4, -1, 8, 4];
  const parts = [
    `<path d="M-4,${r(-4 + s)} L-8,${r(-5 + w + s)} L-12,${r(-3 - w + s)} L-15,${r(-4 + w + s)}" fill="none" stroke="${C.scarf}" stroke-width="2"/>`,
    `<rect x="${r(-4 + fl[0])}" y="${r(3 + fl[1])}" width="2" height="2" fill="${C.feet}" stroke="${C.line}" stroke-width="0.4"/>`,
    `<rect x="${r(1 + fr[0])}" y="${r(3 + fr[1])}" width="2" height="2" fill="${C.feet}" stroke="${C.line}" stroke-width="0.4"/>`,
    `<rect x="-6" y="${r(-11 + s)}" width="10" height="${r(14 - s)}" rx="2" fill="${C.hood}" stroke="${C.line}" stroke-width="0.6"/>`,
    `<rect x="-2" y="${r(-9 + s)}" width="5.5" height="5" fill="${C.face}"/>`,
    `<rect x="-5" y="${r(-4 + s)}" width="9" height="2" fill="${C.scarf}"/>`,
  ];
  if (p.eyes === 'x') {
    for (const dx of [-0.5, 2]) parts.push(`<path d="M${r(dx - 0.6)},${r(-7.6 + s)}l1.2,1.2M${r(dx + 0.6)},${r(-7.6 + s)}l-1.2,1.2" stroke="${C.eye}" stroke-width="0.5"/>`);
  } else if (p.eyes === 'closed') {
    for (const dx of [-0.5, 2]) parts.push(`<rect x="${r(dx - 0.6)}" y="${r(-7 + s)}" width="1.2" height="0.4" fill="${C.eye}"/>`);
  } else {
    for (const dx of [-0.5, 2]) parts.push(`<circle cx="${r(dx)}" cy="${r(-7 + s)}" r="0.7" fill="${C.eye}"/>`);
  }
  if (p.blade !== null) parts.push(`<path d="M${r(bx1)},${r(by1)} L${r(bx2)},${r(by2)}" stroke="${C.blade}" stroke-width="1.2" stroke-linecap="round"/>`);
  if (p.shield) parts.push(`<circle cx="0" cy="-4" r="11" fill="#9ad7ff" fill-opacity="0.25" stroke="#9ad7ff" stroke-width="0.8"/>`);
  if (p.stars) parts.push(`<circle cx="-2" cy="${r(-14 + s)}" r="0.8" fill="#ffe14a"/><circle cx="2" cy="${r(-15 + s)}" r="0.8" fill="#ffe14a"/>`);
  return `<g transform="translate(${r(p.dx ?? 0)},${r(p.dy ?? 0)}) rotate(${p.rot ?? 0})" opacity="${p.alpha ?? 1}">${parts.join('')}</g>`;
}

/** A pose for each of Darc's frame names, from its action and its number. */
function pose(name) {
  const n = Number(/(\d+)\D*$/.exec(name)?.[1] ?? 1);
  const odd = n % 2 === 1;
  const a = name.toLowerCase();
  if (/^idle/.test(a)) return { wave: odd ? 1 : -1, dy: n === 2 || n === 3 ? 0.5 : 0 };
  if (/^run/.test(a) && !/^runpunch/.test(a)) return odd ? { footL: [1, 0], footR: [-1, -1], wave: 2 } : { footL: [-1, -1], footR: [1, 0], wave: -2 };
  if (/^jcharge/.test(a)) return { squash: 3, blade: [4, 0, 9, 2] };
  if (/^(jump|djump)/.test(a)) return { dy: -1, footL: [0, -1], footR: [0, -1], wave: 2, blade: [4, -2, 7, 3] };
  if (/^fall/.test(a)) return { wave: -2, blade: [4, -3, 7, -8] };
  if (/^crouch/.test(a)) return { squash: 4, blade: [4, 2, 10, 3] };
  if (/^ledge/.test(a)) return { rot: 10, blade: [3, -8, 4, -14] };
  if (/^(hurt|stunned)/.test(a)) return { rot: -20, eyes: 'x', stars: /^stunned/.test(a), blade: [-2, 2, -8, 4] };
  if (/^shield/.test(a)) return { shield: true };
  if (/^dodge/.test(a)) return { alpha: 0.4, wave: 3 };
  if (/^npunch/.test(a)) return [{ blade: [4, -4, 2, -12] }, { blade: [4, -4, 12, -6] }, { blade: [4, -2, 11, 4] }][Math.min(n, 3) - 1];
  if (/^uppunch/.test(a)) return { blade: [2, -6, n === 1 ? 6 : 0, -16], dy: -1 };
  if (/^downairpunch/.test(a)) return { rot: n * 10, blade: [2, 2, 3, 11] };
  if (/^runpunch/.test(a)) return { dx: n, wave: 3, blade: [4, -3, 13, -2 + n] };
  if (/^downpunch/.test(a)) return { squash: 2, blade: [3, 2, 13, 4] };
  if (/^e1/.test(a)) return { blade: [4, -4, 12, -10], wave: 2 };
  if (/^e3/.test(a)) return { eyes: 'closed', blade: null, wave: odd ? 3 : -3 };
  if (/^taunt/.test(a)) return { eyes: odd ? 'closed' : undefined, blade: [4, -3, 5 + (n % 4), -12], wave: odd ? 2 : -2 };
  throw new Error(`no pose for ${name}`);
}

function effect(kind, W, H, n, i) {
  const t = n > 1 ? i / (n - 1) : 0;
  const [cx, cy, m] = [W / 2, H / 2, Math.min(W, H) / 2];
  if (kind === 'scarf') return `<path d="M1,${r(cy)} Q${r(W / 3)},1 ${r(W / 2)},${r(cy)} T${r(W - 1)},${r(cy)}" fill="none" stroke="${C.scarf}" stroke-width="${r(Math.max(1.5, H / 6))}"/>`;
  if (kind === 'hook') return `<path d="M${r(cx - m + 1)},${r(cy)} L${r(cx + m - 1)},${r(cy)} M${r(cx + m - 3)},${r(cy - 2)} L${r(cx + m - 1)},${r(cy)} L${r(cx + m - 3)},${r(cy + 2)}" fill="none" stroke="${C.blade}" stroke-width="1"/>`;
  if (kind === 'portal') return `<ellipse cx="${r(cx)}" cy="${r(cy)}" rx="${r((W / 2 - 1) * (0.4 + t * 0.6))}" ry="${r(H / 2 - 1)}" fill="${C.hood}" fill-opacity="0.8" stroke="${C.aura}" stroke-width="1"/>`;
  if (kind === 'cut') return `<path d="M1,${r(cy)} L${r(W - 1)},${r(cy)}" stroke="${C.blade}" stroke-width="1.5"/>`;
  if (kind === 'line') return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(m - 1)}" fill="none" stroke="${C.aura}" stroke-width="2"/>`;
  if (kind === 'bg') return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(m - 1)}" fill="${C.hood}" fill-opacity="0.5"/>`;
  return `<rect x="1" y="1" width="${r(W - 2)}" height="${r(H - 2)}" rx="2" fill="#ffffff" fill-opacity="${r(0.55 - t * 0.35)}" stroke="#ffffff" stroke-width="0.8"/>`;
}

const zone = {};
for (const k of [1, 2, 3]) {
  for (const layer of ['Line', 'BG']) zone[`Zone${k}${layer}`] = { from: 'E5-6_', costumes: [`1)E5-6_${k}${layer}-NL`], kind: layer === 'Line' ? 'line' : 'bg' };
}

buildExample({
  slug: 'darc-from-scratch',
  from: 'darc',
  name: 'Darc From Scratch',
  rules: 'Darc',
  lore: "Darc, rebuilt from a dark hooded square, a scarf and a thin blade in the mod maker. He has no template: every move is his own data, and his gimmick script does what Darc's move scripts do. His grapple and his zone follow the built-in rules of Darc's.",
  colors: C,
  box: [-9, -13, 13, 5],
  figure,
  pose,
  effect,
  moves: {
    NPunch: { from: 'NPunch' },
    UpPunch: { from: 'UpPunch' },
    DownPunch: { from: 'DownPunch' },
    RunPunch: { from: 'RunPunch' },
    DownAirPunch: { from: 'DownAirPunch' },
    E1: { from: 'E1', kind: 'hook', rules: 'E1-6' },
    E3: { from: 'E3', kind: 'portal' },
    E5: { from: 'E5' },
    Taunt: { from: 'Taunt' },
    Dodge: { from: 'Dodge' },
    GrappleHit: { from: 'E1-6_Impact', kind: 'hook' },
    DownScarf: { from: 'DownPunch-6_Scarf', kind: 'scarf' },
    AirScarf: { from: 'DownAirPunch-6_Scarf', kind: 'scarf' },
    Portal: { from: 'E3-6_Spawner', kind: 'portal' },
    PortalSlash: { from: 'E3-6_Hitbox', costumes: ['1)E3-6_Hitbox-NL'], kind: 'cut' },
    ZoneLayer: { from: 'E5-6_' },
    ...zone,
    ZoneHitbox: { from: 'E5-6_Hitbox', rules: 'E5-6_Hitbox' },
  },
});
