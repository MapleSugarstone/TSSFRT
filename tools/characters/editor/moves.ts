// The Moves tab: each move's hitbox drawn over the fighter (drag it to move or resize it), a timeline of
// the fighter's frames, the effect frames, the frames the hitbox can hit on, and sound cues, and the
// move's data.
import { Brush, Download, Eye, Music, Play, Plus, Square, Trash2, Undo2, Upload, Volume2, ZoomIn, ZoomOut } from 'lucide';
import { EXTRA_HITBOXES, isMoveName, isOwnHitbox, MOVE_FIELDS, MOVE_NAMES, MOVE_RULES, OWN_HITBOX_NAME, type Frame, type Move, type Scalar } from '../../../src/game/pack-format.ts';
import { downloadPackFrames, readAnimation, writeImported } from './export.ts';
import { findDoc, folderName, groupFrames, knownSlots, sources, writeFrames } from './frames.ts';
import { app } from './main.ts';
import { openPaint } from './paint.ts';
import { api, field, fileUrl, fill, frameTicks, FRAME_MS, h, loadImage, numberInput, pickFile, playSound, toast, uploadSound, icon, setButton } from './util.ts';

const LABEL = Object.fromEntries(MOVE_FIELDS.map(([k, label, help]) => [k, { label, help }]));
const GROUPS: [string, string[]][] = [
  ['Shape', ['hitboxWidth', 'hitboxHeight', 'displacementX', 'displacementY']],
  ['Hit', ['damage', 'knockbackX', 'knockbackY', 'knockbackScalingX', 'knockbackScalingY', 'hitstun', 'hitstunScaling', 'iframes', 'diScaling', 'comboGain']],
  ['Behavior', ['pushbackX', 'pushbackY', 'hitsBeforeDeletion']],
];
const MOVE_HELP: Record<string, string> = {
  NPunch: 'Attack.',
  UpPunch: 'Attack while holding up.',
  DownPunch: 'Attack while holding down.',
  RunPunch: 'Attack while running.',
  DownAirPunch: 'Attack while holding down in the air.',
  E1: 'Combo move 1.',
  E3: 'Combo move 2.',
  E5: 'Combo move 3.',
  Taunt: 'Taunt.',
  Dodge: 'Dodge.',
};
const PREVIEW_W = 560;
const PREVIEW_H = 320;
const ORIGIN: [number, number] = [230, 200];
const ACTIVE_FOREVER = 200;

let current = 'NPunch';
let tick = 0;
let zoom = 4;
let playTimer = 0;
const images = new Map<string, Promise<HTMLImageElement>>();
const image = (url: string) => {
  let p = images.get(url);
  if (!p) images.set(url, (p = loadImage(url)));
  return p;
};

/** Which frame shows at game frame `t`, looping, or -1 when there are none. */
function frameAt(frames: Frame[], t: number): number {
  const total = frames.reduce((n, f) => n + frameTicks(f.speed), 0);
  if (!total) return -1;
  let left = t % total;
  for (let i = 0; i < frames.length; i++) {
    const d = frameTicks(frames[i].speed);
    if (frames[i].name?.includes('NL') && left >= 0) return i;
    if (left < d) return i;
    left -= d;
  }
  return frames.length - 1;
}

const ticksOf = (frames: Frame[]) => frames.reduce((n, f) => n + frameTicks(f.speed), 0);

function defaultMove(): Move {
  const a: Record<string, Scalar> = {
    hitboxWidth: 16,
    hitboxHeight: 16,
    displacementX: 10,
    displacementY: 0,
    pushbackX: 0,
    pushbackY: 0,
    knockbackX: 6,
    knockbackY: 4,
    iframes: 8,
    hitstun: 10,
    damage: 5,
    hitsBeforeDeletion: 0,
    rotateStyle: 'lr',
    comboGain: 10,
    knockbackScalingX: 6,
    knockbackScalingY: 4,
    hitstunScaling: 5,
    diScaling: 1,
    cloneType: 2,
  };
  return { attributes: a, hitboxes: [], active: { start: 2, end: 8 }, aiSpacing: null, cantMove: true, uniqueAnimation: false, shieldBreaking: false, ignoreVelocityLimit: false, freeze: null, hitSound: null, sound: null, cues: [] };
}

const EXTRA_HELP = "Hitboxes the template's moves create besides their own, such as projectiles. The template's script still decides where each one goes and when it appears.";

const OWN_HELP = "Hitboxes only this character has. Its gimmick script creates one with fighter.spawn('name') and moves it with the hitbox's vx and vy.";

/** The template's extra hitboxes this character can customize, and any it already has, with the moves that create them. */
function extraHitboxes(): { name: string; moves: readonly string[] }[] {
  const names = new Set([...Object.keys(app.template?.moves ?? {}), ...Object.keys(app.pack?.moves ?? {})].filter((n) => !isMoveName(n) && !isOwnHitbox(n, app.pack?.template ?? null)));
  return [...names].map((name) => ({ name, moves: EXTRA_HITBOXES.find((x) => x.name === name)?.moves ?? [] }));
}

/** What the Moves tab says about a move, an extra hitbox or a hitbox of the character's own. */
function helpOf(name: string): string {
  if (MOVE_HELP[name]) return MOVE_HELP[name];
  if (isOwnHitbox(name, app.pack?.template ?? null)) return `A hitbox of this character's own. Its gimmick script creates it with fighter.spawn('${name}') and moves it with the hitbox's vx and vy.`;
  const by = EXTRA_HITBOXES.find((x) => x.name === name)?.moves ?? [];
  return `Made by ${by.join(' and ') || 'a move'}. ${EXTRA_HELP}`;
}

/** A new hitbox of the character's own: a small projectile that hits once. */
function newOwnHitbox(): Move {
  const m = defaultMove();
  Object.assign(m.attributes, { displacementX: 0, hitsBeforeDeletion: 1, rotateStyle: 'lr', cloneType: 1 });
  return { ...m, active: null, cantMove: false };
}

/** Copies template files a move uses into the pack, where the pack does not have them yet. */
async function adoptFiles(files: string[]): Promise<void> {
  if (!app.templateDir) return;
  for (const f of files) if (!(await api.exists(app.dir, f))) await api.put(app.dir, f, await (await fetch(fileUrl(app.templateDir, f))).blob());
}

export function renderMoves(body: HTMLElement): void {
  clearInterval(playTimer);
  playTimer = 0;
  const p = app.pack!;
  const own = p.moves[current] as Move | undefined;
  const tmpl = app.template?.moves[current] as Move | undefined;
  const m = own ?? tmpl;
  const editable = !!own && !app.readOnly;
  const dataDir = own ? app.dir : app.templateDir ?? app.dir;
  const effectsFromTemplate = !!own && !own.hitboxes.length && !!tmpl?.hitboxes.length;
  const effects = (effectsFromTemplate ? tmpl!.hitboxes : m?.hitboxes) ?? [];
  const effectsDir = effectsFromTemplate ? app.templateDir! : dataDir;
  const known = knownSlots();
  // An extra hitbox shows over the animation of the first move that creates it, and one of the character's own over idle.
  const ownHitbox = isOwnHitbox(current, p.template);
  const slot = EXTRA_HITBOXES.find((x) => x.name === current)?.moves[0] ?? (ownHitbox ? 'idle' : current);
  const fighter = groupFrames(p.animations, known).find((g) => g.slot.toLowerCase() === slot.toLowerCase())?.frames ?? [];
  const attr = (k: string) => Number(m?.attributes[k] ?? 0) || 0;
  const changed = () => {
    app.changed();
    renderMoves(body);
  };

  // Move list, then the extra hitboxes the template's moves create.
  const entry = (name: string, made = '') =>
    h(
      'button',
      {
        class: name === current ? 'on' : '',
        onclick: () => {
          current = name;
          tick = 0;
          renderMoves(body);
        },
      },
      h('strong', null, name),
      h('span', { class: 'hint' }, isOwnHitbox(name, p.template) ? 'Made by the gimmick script' : `${made}${p.moves[name] ? 'Customized' : app.template?.moves[name] ? `Same as ${app.template.name}` : 'No data'}`),
    );
  const extras = extraHitboxes();
  const owned = Object.keys(p.moves).filter((n) => isOwnHitbox(n, p.template));
  const addOwn = () => {
    const name = prompt('Name of the new hitbox: letters, digits and _, starting with a letter.', 'Bolt')?.trim();
    if (!name) return;
    if (!OWN_HITBOX_NAME.test(name)) return toast('Use letters, digits and _, starting with a letter', true);
    if (p.moves[name] || isMoveName(name) || EXTRA_HITBOXES.some((x) => x.name === name)) return toast('That name is taken', true);
    p.moves[name] = newOwnHitbox();
    current = name;
    changed();
  };
  const list = h(
    'div',
    { class: 'move-list' },
    MOVE_NAMES.map((name) => entry(name)),
    extras.length ? h('div', { class: 'move-list-heading', title: EXTRA_HELP }, 'Extra hitboxes') : null,
    extras.map((x) => entry(x.name, `${x.moves.join(', ')}. `)),
    h('div', { class: 'move-list-heading', title: OWN_HELP }, 'Own hitboxes'),
    owned.map((name) => entry(name)),
    app.readOnly ? null : h('button', { class: 'move-list-add', onclick: addOwn, title: 'Add a hitbox the gimmick script creates, such as a projectile' }, icon(Plus), 'New hitbox'),
  );

  const sameLabel = tmpl ? `Same as ${app.template!.name}` : 'No data';
  const ownToggle = ownHitbox
    ? h(
        'div',
        { class: 'button-row' },
        h(
          'button',
          {
            disabled: app.readOnly,
            onclick: () => {
              if (!confirm(`Delete ${current} from ${p.name}?`)) return;
              delete p.moves[current];
              current = 'NPunch';
              changed();
            },
          },
          icon(Trash2),
          'Delete hitbox',
        ),
      )
    : field(
    'Move data',
    h(
      'select',
      {
        disabled: app.readOnly,
        onchange: async (e: Event) => {
          if ((e.target as HTMLSelectElement).value === 'custom') {
            const copy: Move = tmpl ? JSON.parse(JSON.stringify(tmpl)) : defaultMove();
            copy.cues ??= [];
            await adoptFiles([...copy.hitboxes.map((f) => f.file), ...(copy.sound ? [copy.sound.file] : []), ...copy.cues.map((c) => c.sound.file)]);
            p.moves[current] = copy;
          } else {
            if (!confirm(`Drop ${p.name}'s changes to ${current}?`)) return renderMoves(body);
            delete p.moves[current];
          }
          changed();
        },
      },
      h('option', { value: 'same', selected: !own }, sameLabel),
      h('option', { value: 'custom', selected: !!own }, `Customized for ${p.name}`),
    ),
    `Customized keeps this character's own numbers, hitbox, effect frames and sounds for the move. Either way the move behaves the way ${app.template?.name ?? 'its template'}'s does.`,
  );

  if (!m) {
    fill(
      body,
      h('section', { class: 'card move-layout' }, list, h('div', null, h('h2', null, current), h('p', { class: 'hint' }, helpOf(current)), ownToggle, h('p', null, 'This move has no data. Choose Customized to give it some.'))),
    );
    return;
  }

  // Preview.
  const preview = h('canvas', { class: 'move-preview', width: PREVIEW_W, height: PREVIEW_H });
  const world = (x: number, y: number): [number, number] => [ORIGIN[0] + x * zoom, ORIGIN[1] - y * zoom];
  const crouch = Number(p.stats.crouchOffset) || 0;
  const drawPreview = async () => {
    const g = preview.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.beginPath();
    for (let x = ORIGIN[0] % (10 * zoom); x < PREVIEW_W; x += 10 * zoom) (g.moveTo(x + 0.5, 0), g.lineTo(x + 0.5, PREVIEW_H));
    for (let y = ORIGIN[1] % (10 * zoom); y < PREVIEW_H; y += 10 * zoom) (g.moveTo(0, y + 0.5), g.lineTo(PREVIEW_W, y + 0.5));
    g.stroke();
    const fi = frameAt(fighter, tick);
    if (fi >= 0) {
      const f = fighter[fi];
      const img = await image(fileUrl(app.dir, f.file));
      const s = (2 / (f.resolution || 2)) * zoom;
      const [x, y] = world(0, crouch);
      g.drawImage(img, x - f.center[0] * s, y - f.center[1] * s, img.naturalWidth * s, img.naturalHeight * s);
    }
    const [hx, hy] = world(attr('displacementX'), attr('displacementY'));
    const ei = frameAt(effects, tick);
    if (ei >= 0) {
      const f = effects[ei];
      const img = await image(fileUrl(effectsDir, f.file));
      const s = (2 / (f.resolution || 2)) * zoom;
      g.globalAlpha = 0.9;
      g.drawImage(img, hx - f.center[0] * s, hy - f.center[1] * s, img.naturalWidth * s, img.naturalHeight * s);
      g.globalAlpha = 1;
    }
    const hw = Number(p.stats.hurtboxWidth) || 0;
    const hh = Number(p.stats.hurtboxHeight) || 0;
    const [ux, uy] = world(-hw / 2, hh / 2);
    g.strokeStyle = '#4aa8ff';
    g.strokeRect(ux + 0.5, uy + 0.5, hw * zoom, hh * zoom);
    const active = !m.active || (tick >= Number(m.active.start) && tick < Number(m.active.end));
    const w = attr('hitboxWidth') * zoom;
    const hgt = attr('hitboxHeight') * zoom;
    g.fillStyle = active ? 'rgba(255,70,90,0.35)' : 'rgba(255,70,90,0.08)';
    g.fillRect(hx - w / 2, hy - hgt / 2, w, hgt);
    g.strokeStyle = active ? '#ff4a5e' : 'rgba(255,74,94,0.5)';
    g.setLineDash(active ? [] : [4, 3]);
    g.strokeRect(hx - w / 2 + 0.5, hy - hgt / 2 + 0.5, w, hgt);
    g.setLineDash([]);
    if (editable) {
      g.fillStyle = '#ff4a5e';
      for (const [cx, cy] of [
        [hx + w / 2, hy + hgt / 2],
        [hx - w / 2, hy - hgt / 2],
        [hx + w / 2, hy - hgt / 2],
        [hx - w / 2, hy + hgt / 2],
      ])
        g.fillRect(cx - 3, cy - 3, 6, 6);
    }
    g.fillStyle = '#ffffffaa';
    g.font = '12px system-ui, sans-serif';
    g.fillText(`Frame ${tick}   ${active ? 'can hit' : 'cannot hit'}   blue: hurtbox   red: hitbox   facing right`, 8, PREVIEW_H - 10);
  };

  // Dragging the hitbox in the preview.
  let drag: { kind: 'move' | 'size'; x0: number; y0: number; a: Record<string, number> } | null = null;
  const local = (e: PointerEvent) => {
    const r = preview.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * PREVIEW_W, ((e.clientY - r.top) / r.height) * PREVIEW_H];
  };
  preview.addEventListener('pointerdown', (e) => {
    if (!editable) return;
    const [x, y] = local(e);
    const [hx, hy] = world(attr('displacementX'), attr('displacementY'));
    const w = (attr('hitboxWidth') * zoom) / 2;
    const hgt = (attr('hitboxHeight') * zoom) / 2;
    const nearCorner = Math.abs(Math.abs(x - hx) - w) < 7 && Math.abs(Math.abs(y - hy) - hgt) < 7;
    const inside = Math.abs(x - hx) <= w && Math.abs(y - hy) <= hgt;
    if (!nearCorner && !inside) return;
    preview.setPointerCapture(e.pointerId);
    drag = { kind: nearCorner ? 'size' : 'move', x0: x, y0: y, a: { dx: attr('displacementX'), dy: attr('displacementY') } };
  });
  preview.addEventListener('pointermove', (e) => {
    if (!drag || !own) return;
    const [x, y] = local(e);
    if (drag.kind === 'move') {
      own.attributes.displacementX = Math.round(drag.a.dx + (x - drag.x0) / zoom);
      own.attributes.displacementY = Math.round(drag.a.dy - (y - drag.y0) / zoom);
    } else {
      const [hx, hy] = world(attr('displacementX'), attr('displacementY'));
      own.attributes.hitboxWidth = Math.max(1, Math.round((Math.abs(x - hx) * 2) / zoom));
      own.attributes.hitboxHeight = Math.max(1, Math.round((Math.abs(y - hy) * 2) / zoom));
    }
    void drawPreview();
  });
  preview.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    changed();
  });

  // Timeline.
  const activeEnd = m.active ? Math.min(Number(m.active.end), ACTIVE_FOREVER) : 0;
  const cues = m.cues ?? [];
  const total = Math.max(ticksOf(fighter), ticksOf(effects), m.active && Number(m.active.end) < ACTIVE_FOREVER ? activeEnd : 0, ...cues.map((c) => c.frame + 1), 12) + 4;
  const TL_W = 900;
  const cell = Math.max(6, Math.min(24, Math.floor((TL_W - 90) / total)));
  const tl = h('canvas', { class: 'timeline', width: 90 + cell * total, height: 150 });
  const ROWS = { ruler: 14, fighter: 22, effect: 52, active: 84, sound: 112 };
  const tx = (t: number) => 90 + t * cell;
  const drawTimeline = () => {
    const g = tl.getContext('2d')!;
    g.clearRect(0, 0, tl.width, tl.height);
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = '#9aa0ad';
    g.fillText('Fighter', 6, ROWS.fighter + 16);
    g.fillText('Effect', 6, ROWS.effect + 16);
    g.fillText('Can hit', 6, ROWS.active + 12);
    g.fillText('Sounds', 6, ROWS.sound + 14);
    for (let t = 0; t <= total; t++) {
      g.fillStyle = t % 5 === 0 ? '#5d6370' : '#363a44';
      g.fillRect(tx(t), 0, 1, t % 5 === 0 ? 10 : 5);
      if (t % 10 === 0) (g.fillStyle = '#9aa0ad'), g.fillText(String(t), tx(t) + 2, 10);
    }
    const blocks = (frames: Frame[], y: number, color: string) => {
      let t = 0;
      frames.forEach((f, i) => {
        const d = f.name?.includes('NL') ? total - t : frameTicks(f.speed);
        g.fillStyle = i % 2 ? color : `${color}cc`;
        g.fillRect(tx(t) + 1, y, d * cell - 2, 24);
        g.fillStyle = '#0b0d11';
        if (d * cell > 14) g.fillText(String(i + 1), tx(t) + 4, y + 16);
        t += d;
      });
    };
    blocks(fighter, ROWS.fighter, '#6c8cff');
    blocks(effects, ROWS.effect, '#e0a040');
    if (m.active) {
      const s = Number(m.active.start);
      g.fillStyle = '#ff4a5e';
      g.fillRect(tx(s), ROWS.active, (activeEnd - s) * cell, 16);
      g.fillStyle = '#ffd0d6';
      g.fillRect(tx(s), ROWS.active - 2, 3, 20);
      g.fillRect(tx(activeEnd) - 3, ROWS.active - 2, 3, 20);
    } else {
      g.fillStyle = '#ff4a5e88';
      g.fillRect(tx(0), ROWS.active, total * cell, 16);
    }
    const marker = (t: number, label: string) => {
      g.fillStyle = '#6fd18a';
      g.beginPath();
      g.moveTo(tx(t) + cell / 2, ROWS.sound);
      g.lineTo(tx(t) + cell / 2 + 6, ROWS.sound + 10);
      g.lineTo(tx(t) + cell / 2, ROWS.sound + 20);
      g.lineTo(tx(t) + cell / 2 - 6, ROWS.sound + 10);
      g.fill();
      g.fillText(label, tx(t) + cell / 2 + 8, ROWS.sound + 14);
    };
    if (m.sound) marker(0, 'start');
    cues.forEach((c, i) => marker(c.frame, `${i + 1}`));
    g.fillStyle = '#ffffff';
    g.fillRect(tx(tick) + Math.floor(cell / 2), 0, 1, tl.height);
  };
  let tdrag: { kind: 'head' | 'start' | 'end' | 'cue'; i?: number } | null = null;
  const tickOf = (e: PointerEvent) => {
    const r = tl.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * tl.width;
    return { t: Math.max(0, Math.min(total, Math.floor((x - 90) / cell))), x, y: ((e.clientY - r.top) / r.height) * tl.height };
  };
  const redraw = () => {
    drawTimeline();
    void drawPreview();
  };
  tl.addEventListener('pointerdown', (e) => {
    const { t, x, y } = tickOf(e);
    tl.setPointerCapture(e.pointerId);
    const near = (tt: number) => Math.abs(x - tx(tt)) < 6;
    if (editable && m.active && y >= ROWS.active - 4 && y <= ROWS.active + 20 && (near(Number(m.active.start)) || near(activeEnd))) tdrag = { kind: near(Number(m.active.start)) ? 'start' : 'end' };
    else if (editable && y >= ROWS.sound && cues.some((c) => Math.abs(x - (tx(c.frame) + cell / 2)) < 8)) tdrag = { kind: 'cue', i: cues.findIndex((c) => Math.abs(x - (tx(c.frame) + cell / 2)) < 8) };
    else {
      tdrag = { kind: 'head' };
      tick = t;
    }
    redraw();
  });
  tl.addEventListener('pointermove', (e) => {
    if (!tdrag) return;
    const { t } = tickOf(e);
    if (tdrag.kind === 'head') tick = t;
    else if (tdrag.kind === 'start' && own?.active) own.active.start = Math.min(t, Number(own.active.end) - 1);
    else if (tdrag.kind === 'end' && own?.active) own.active.end = Math.max(t, Number(own.active.start) + 1);
    else if (tdrag.kind === 'cue' && own) own.cues[tdrag.i!].frame = t;
    redraw();
  });
  tl.addEventListener('pointerup', () => {
    const kind = tdrag?.kind;
    tdrag = null;
    if (kind && kind !== 'head') changed();
  });

  const playButton = h('button', {
    onclick: () => {
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = 0;
        setButton(playButton, Play, 'Play');
        return;
      }
      setButton(playButton, Square, 'Stop');
      playTimer = window.setInterval(() => {
        if (!tl.isConnected) return clearInterval(playTimer);
        tick = (tick + 1) % total;
        if (m.sound && tick === 0) playSound(dataDir, m.sound.file);
        for (const c of cues) if (c.frame === tick) playSound(dataDir, c.sound.file);
        redraw();
      }, FRAME_MS);
    },
  }, icon(Volume2), 'Play');

  // Form.
  const setAttr = (k: string) => (v: number | string) => {
    if (!own) return;
    own.attributes[k] = v;
    changed();
  };
  const attrField = (k: string) => field(LABEL[k].label, numberInput(m.attributes[k], setAttr(k)), LABEL[k].help);
  const flag = (k: 'cantMove' | 'uniqueAnimation' | 'shieldBreaking' | 'ignoreVelocityLimit', label: string, help: string) =>
    h(
      'label',
      { class: 'check', title: help },
      h('input', {
        type: 'checkbox',
        checked: m[k],
        onchange: (e: Event) => {
          if (!own) return;
          own[k] = (e.target as HTMLInputElement).checked;
          changed();
        },
      }),
      label,
    );
  const select = (value: string, options: [string, string][], onChange: (v: string) => void) =>
    h(
      'select',
      { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
      options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
      options.some(([v]) => v === value) ? null : h('option', { value, selected: true }, value),
    );

  const soundRow = (label: string, s: { file: string } | null, onReplace: (f: File) => Promise<void>, onRemove: () => void, extra: HTMLElement | null = null) =>
    h(
      'div',
      { class: 'sound-row' },
      h('strong', null, label),
      extra,
      h('span', { class: 'hint' }, s ? s.file.split('/').pop() : 'None'),
      s ? h('button', { onclick: () => playSound(dataDir, s.file) }, icon(Volume2), 'Play') : null,
      editable
        ? h(
            'button',
            {
              onclick: async () => {
                const [f] = await pickFile('audio/*');
                if (f) await onReplace(f).catch((e: Error) => toast(e.message, true));
              },
            },
            s ? 'Replace' : 'Upload',
          )
        : null,
      editable && s ? h('button', { onclick: onRemove }, icon(Trash2), 'Remove') : null,
    );

  const paintEffects = async () => {
    const idle = fighter[0] ?? groupFrames(p.animations, known).find((g) => g.slot === 'idle')?.frames[0];
    await openPaint({
      title: `${p.name}: ${current} effect`,
      slot: current,
      frames: sources(effectsDir, effects, current),
      doc: effectsFromTemplate ? null : await findDoc(effectsDir, effects.map((f) => f.file)),
      reference: idle ? { ...sources(app.dir, [idle], 'idle')[0], offset: [-attr('displacementX'), attr('displacementY') - crouch] } : null,
      onSave: async (out) => {
        if (!own) throw new Error('Set Move data to Customized first.');
        own.hitboxes = (await writeFrames(app.dir, `moves/${folderName(current)}`, out)).map(({ name: _name, ...f }) => f);
        app.changed();
        await app.save(true);
        renderMoves(body);
      },
    });
  };

  const a = m.attributes;
  const form = h(
    'div',
    { class: 'move-form' },
    GROUPS.map(([title, keys]) => h('fieldset', { disabled: !editable }, h('legend', null, title), h('div', { class: 'form-grid' }, keys.map(attrField)))),
    h(
      'fieldset',
      { disabled: !editable },
      h('legend', null, 'Kind'),
      h(
        'div',
        { class: 'form-grid' },
        field('Kind', select(String(a.cloneType), [['2', 'Melee (follows the fighter)'], ['1', 'Projectile']], (v) => setAttr('cloneType')(Number(v))), LABEL.cloneType.help),
        field('Rotation', select(String(a.rotateStyle), [['lr', 'Flip left and right'], ['n', 'Never'], ['all', 'All around']], setAttr('rotateStyle')), LABEL.rotateStyle.help),
        field(
          'Hit pause',
          numberInput(m.freeze ?? '', (v) => {
            if (!own) return;
            own.freeze = v === '' ? null : v;
            changed();
          }),
          'Seconds both fighters freeze on hit; empty for none',
        ),
        field(
          'Hit sound',
          select(String(m.hitSound ?? ''), [['', 'Default'], ...Array.from({ length: 20 }, (_, i) => [String(i + 1), `Hit sound ${i + 1}`] as [string, string])], (v) => {
            if (!own) return;
            own.hitSound = v ? Number(v) : null;
            changed();
          }),
          'Which of the game\'s hit sounds plays on a hit',
        ),
        field(
          'Built-in rules',
          select(String(m.rules ?? ''), [['', 'None'], ...Object.entries(MOVE_RULES).map(([id, r]) => [id, r.label] as [string, string])], (v) => {
            if (!own) return;
            own.rules = v || null;
            changed();
            renderMoves(body);
          }),
          'Special handling the game gives one original move outside its move script',
        ),
      ),
      m.rules && MOVE_RULES[m.rules] ? h('p', { class: 'hint' }, MOVE_RULES[m.rules].description) : null,
      flag('cantMove', 'Fighter cannot move during it', 'The fighter stops while the move plays'),
      flag('uniqueAnimation', 'Animation keeps playing after the hitbox ends', 'The fighter animation does not end with the hitbox'),
      flag('shieldBreaking', 'Breaks shields', ''),
      flag('ignoreVelocityLimit', 'Ignores the speed limit', ''),
    ),
    h(
      'fieldset',
      { disabled: !editable },
      h('legend', null, 'When it can hit'),
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: !m.active,
          onchange: (e: Event) => {
            if (!own) return;
            own.active = (e.target as HTMLInputElement).checked ? null : { start: 2, end: 8 };
            changed();
          },
        }),
        'For the hitbox\'s whole life',
      ),
      m.active
        ? h(
            'div',
            { class: 'form-grid' },
            field('From frame', numberInput(m.active.start, (v) => own?.active && ((own.active.start = v), changed()), '1'), 'Frame of the hitbox\'s life (from 0) it starts hitting on'),
            field('Until frame', numberInput(m.active.end, (v) => own?.active && ((own.active.end = v), changed()), '1'), 'Frame it stops hitting on'),
          )
        : null,
      h('p', { class: 'hint' }, 'Drag the ends of the red bar in the timeline to change these.'),
    ),
    h(
      'fieldset',
      { disabled: !editable },
      h('legend', null, 'Sounds'),
      soundRow(
        'Start',
        m.sound,
        async (f) => {
          own!.sound = await uploadSound(app.dir, f, folderName(current));
          changed();
        },
        () => ((own!.sound = null), changed()),
      ),
      cues.map((c, i) =>
        soundRow(
          `Cue ${i + 1}`,
          c.sound,
          async (f) => {
            own!.cues[i].sound = await uploadSound(app.dir, f, `${folderName(current)}-cue`);
            changed();
          },
          () => (own!.cues.splice(i, 1), changed()),
          field('Frame', numberInput(c.frame, (v) => ((own!.cues[i].frame = Math.max(0, Math.round(Number(v) || 0))), changed()), '1')),
        ),
      ),
      editable
        ? h(
            'button',
            {
              onclick: async () => {
                const [f] = await pickFile('audio/*');
                if (!f) return;
                try {
                  own!.cues.push({ frame: tick, sound: await uploadSound(app.dir, f, `${folderName(current)}-cue`) });
                  changed();
                } catch (e) {
                  toast((e as Error).message, true);
                }
              },
            },
            icon(Music),
            'Add a sound at the timeline frame',
          )
        : null,
      h('p', { class: 'hint' }, 'The start sound plays when the hitbox appears. Cues play on a frame of the hitbox\'s life, and pause with it during hit pause.'),
    ),
    h(
      'fieldset',
      { disabled: !editable },
      h('legend', null, 'CPU'),
      h(
        'div',
        { class: 'form-grid' },
        [0, 1].map((i) =>
          field(
            `Spacing ${i + 1}`,
            numberInput(m.aiSpacing?.[i] ?? '', (v) => {
              if (!own) return;
              const s: [Scalar, Scalar] = own.aiSpacing ?? [0, 0];
              s[i] = v;
              own.aiSpacing = s[0] === '' && s[1] === '' ? null : s;
              changed();
            }),
            'Distances the CPU keeps when it plans this move',
          ),
        ),
      ),
    ),
  );

  fill(
    body,
    h(
      'section',
      { class: 'card move-layout' },
      list,
      h(
        'div',
        { class: 'move-main' },
        h('div', { class: 'move-title' }, h('h2', null, current), h('span', { class: 'hint' }, helpOf(current)), ownToggle),
        !own ? h('p', { class: 'banner' }, `${current} uses ${app.template?.name ?? 'the template'}'s numbers, hitbox, effect and sounds. Set Move data to Customized to change them.`) : null,
        h('div', { class: 'move-stage' }, preview),
        h(
          'div',
          { class: 'button-row' },
          playButton,
          h('button', { onclick: () => ((zoom = Math.min(8, zoom + 1)), redraw()) }, icon(ZoomIn), 'Zoom in'),
          h('button', { onclick: () => ((zoom = Math.max(1, zoom - 1)), redraw()) }, icon(ZoomOut), 'Zoom out'),
          h('button', { onclick: () => void paintEffects() }, icon(editable ? Brush : Eye), editable ? 'Paint effect frames' : 'View effect frames'),
          editable
            ? h(
                'button',
                {
                  title: 'Replace the effect frames with image files or an exported zip',
                  onclick: async () => {
                    const files = await pickFile('.zip,image/png,image/svg+xml', true);
                    const frames = files.length ? await readAnimation(files, effects[0]?.speed ?? 5) : [];
                    if (!frames.length) return;
                    own!.hitboxes = (await writeImported(app.dir, `moves/${folderName(current)}`, frames, () => '')).map(({ name: _name, ...f }) => f);
                    app.changed();
                    await app.save(true);
                    renderMoves(body);
                  },
                },
                icon(Upload),
                'Import effect',
              )
            : null,
          effects.length ? h('button', { onclick: () => void downloadPackFrames(effectsDir, `${current}-effect`, effects), title: 'Download the effect frames as a zip' }, icon(Download), 'Export effect') : null,
          effectsFromTemplate ? h('span', { class: 'hint' }, `Effect frames come from ${app.template?.name}.`) : null,
          own && own.hitboxes.length && tmpl?.hitboxes.length
            ? h('button', { onclick: () => confirm(`Use ${app.template?.name}'s effect frames instead?`) && ((own.hitboxes = []), changed()) }, icon(Undo2), 'Use template\'s effect')
            : null,
        ),
        h('div', { class: 'timeline-wrap' }, tl),
        h('p', { class: 'hint' }, 'Frames count game frames (30 per second) from when the hitbox appears. Click the timeline to see a frame. The template\'s script for a move can change its timing, so check it in the game.'),
        form,
      ),
    ),
  );
  redraw();
}
