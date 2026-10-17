// The Animations tab: one row per action the fighter plays, with its frames. Rows drag onto other rows
// to swap animations between actions, or to copy one over another.
import { Brush, Copy, Download, Eye, Plus, Trash2, Upload, Palette } from 'lucide';
import type { Frame } from '../../../src/game/pack-format.ts';
import { downloadPackFrames, readAnimation, writeImported } from './export.ts';
import { findDoc, folderName, groupFrames, knownSlots, renameFrame, slotOf, sources, writeFrames } from './frames.ts';
import { app } from './main.ts';
import { openRecolor } from './recolor.ts';
import { openPaint } from './paint.ts';
import { api, fileUrl, fill, frameTicks, FRAME_MS, h, loadImage, pad2, pickFile, randomId, toast, icon } from './util.ts';

const DESCRIPTIONS: Record<string, string> = {
  idle: 'Standing still.',
  run: 'Running.',
  jcharge: 'Crouching before a jump. The jump starts on the frame named jchargeNL, so keep it last.',
  jump: 'Rising after a jump.',
  Djump: 'Rising after a jump in the air.',
  fall: 'Falling.',
  crouch: 'Crouching.',
  land: 'Landing.',
  hurt: 'Flying after a hit.',
  shield: 'Shielding.',
  Dodge: 'Dodging.',
  stunned: 'Stunned after the shield breaks.',
  ledge: 'Hanging on a ledge.',
  Taunt: 'Taunting.',
  NPunch: 'Attack.',
  RunPunch: 'Attack while running.',
  UpPunch: 'Attack while holding up.',
  DownPunch: 'Attack while holding down.',
  DownAirPunch: 'Attack while holding down in the air.',
  E1: 'Combo move 1.',
  E3: 'Combo move 2.',
  E5: 'Combo move 3.',
};

let copyMode = false;
let dragSlot: string | null = null;
let previewSlot: string | null = null;
let previewTimer = 0;
const images = new Map<string, Promise<HTMLImageElement>>();
const image = (url: string) => {
  let p = images.get(url);
  if (!p) images.set(url, (p = loadImage(url)));
  return p;
};

/** Seconds an animation plays before it repeats (frames that hold count once). */
const seconds = (frames: Frame[]) => (frames.reduce((n, f) => n + frameTicks(f.speed), 0) * FRAME_MS) / 1000;

export function renderAnimations(body: HTMLElement): void {
  const p = app.pack!;
  const base = knownSlots();
  const extra = (app.template ? groupFrames(app.template.animations, base) : []).map((g) => g.slot).filter((s) => !base.some((b) => b.toLowerCase() === s.toLowerCase()));
  const known = knownSlots(extra);
  const groups = groupFrames(p.animations, known);
  for (const k of known) if (!groups.some((g) => g.slot.toLowerCase() === k.toLowerCase())) groups.push({ slot: k, frames: [] });
  const find = (slot: string) => groups.find((g) => g.slot === slot)!;

  const commit = async (saveNow = false) => {
    p.animations = groups.flatMap((g) => g.frames);
    app.changed();
    if (saveNow) await app.save(true);
    renderAnimations(body);
  };
  const swap = (a: string, b: string) => {
    const ga = find(a);
    const gb = find(b);
    [ga.frames, gb.frames] = [gb.frames.map((f) => ({ ...f, name: renameFrame(f.name ?? '', b, a) })), ga.frames.map((f) => ({ ...f, name: renameFrame(f.name ?? '', a, b) }))];
    void commit();
  };
  const copy = (a: string, b: string) => {
    const gb = find(b);
    if (gb.frames.length && !confirm(`Replace the ${b} animation with a copy of ${a}?`)) return;
    gb.frames = find(a).frames.map((f) => ({ ...f, name: renameFrame(f.name ?? '', a, b) }));
    void commit();
  };
  const paint = async (slot: string) => {
    const g = find(slot);
    const idle = find('idle').frames[0];
    await openPaint({
      title: `${p.name}: ${slot} animation`,
      slot,
      frames: sources(app.dir, g.frames, slot),
      doc: await findDoc(
        app.dir,
        g.frames.map((f) => f.file),
      ),
      reference: slot !== 'idle' && idle ? sources(app.dir, [idle], 'idle')[0] : null,
      onSave: async (out) => {
        if (app.readOnly) throw new Error('The original characters are read-only.');
        g.frames = await writeFrames(app.dir, `animations/${folderName(slot)}`, out);
        await commit(true);
      },
    });
  };
  const fromTemplate = async (slot: string) => {
    const t = app.template && groupFrames(app.template.animations, known).find((x) => x.slot.toLowerCase() === slot.toLowerCase());
    if (!t || !app.templateDir) return;
    const id = randomId();
    const frames: Frame[] = [];
    for (const [i, f] of t.frames.entries()) {
      const ext = /\.[a-z]+$/i.exec(f.file)?.[0] ?? '.png';
      const file = `animations/${folderName(slot)}/${id}-${pad2(i + 1)}${ext}`;
      await api.put(app.dir, file, await (await fetch(fileUrl(app.templateDir, f.file))).blob());
      frames.push({ ...f, file, name: renameFrame(f.name ?? '', t.slot, slot) });
    }
    find(slot).frames = frames;
    await commit(true);
  };
  const importFrames = async (slot: string) => {
    const files = await pickFile('.zip,image/png,image/svg+xml', true);
    if (!files.length) return;
    const g = find(slot);
    const frames = await readAnimation(files, g.frames[0]?.speed ?? 4);
    if (!frames.length) return toast('No PNG or SVG images found', true);
    const replace = !g.frames.length || confirm(`Replace the ${g.frames.length} frames of ${slot}? Cancel adds the new frames after them.`);
    const first = replace ? 0 : g.frames.length;
    const added = await writeImported(app.dir, `animations/${folderName(slot)}`, frames, (f, i) => (f.name ? renameFrame(f.name, slotOf(f.name, known), slot) : `${slot}${first + i + 1}`));
    g.frames = replace ? added : [...g.frames, ...added];
    await commit(true);
  };
  const newDraft = () => {
    let n = 1;
    while (groups.some((g) => g.slot === `draft${n}`)) n++;
    const name = prompt('Name of the new animation. Drag it onto an action to use it.', `draft${n}`)?.trim();
    if (!name) return;
    if (groups.some((g) => g.slot.toLowerCase() === name.toLowerCase())) return toast('That animation already exists', true);
    groups.push({ slot: name, frames: [] });
    void paint(name);
  };

  const preview = h('canvas', { class: 'anim-preview', width: 200, height: 200 });
  const play = (slot: string) => {
    previewSlot = slot;
    clearTimeout(previewTimer);
    const frames = find(slot)?.frames ?? [];
    let i = 0;
    const step = async () => {
      if (previewSlot !== slot || !preview.isConnected) return;
      const g = preview.getContext('2d')!;
      g.clearRect(0, 0, 200, 200);
      g.imageSmoothingEnabled = false;
      const f = frames[i];
      if (f) {
        const img = await image(fileUrl(app.dir, f.file));
        const s = (2 / (f.resolution || 2)) * 3;
        g.drawImage(img, 100 - f.center[0] * s, 130 - f.center[1] * s, img.naturalWidth * s, img.naturalHeight * s);
        previewTimer = window.setTimeout(step, (f.name?.includes('NL') ? 10 : frameTicks(f.speed)) * FRAME_MS);
        i = (i + 1) % frames.length;
      }
    };
    void step();
  };

  const row = (g: { slot: string; frames: Frame[] }) => {
    const isKnown = known.some((k) => k.toLowerCase() === g.slot.toLowerCase());
    const templateHas = !!app.template && groupFrames(app.template.animations, known).some((x) => x.slot.toLowerCase() === g.slot.toLowerCase() && x.frames.length);
    const desc = DESCRIPTIONS[g.slot] ?? (extra.includes(g.slot) ? `Played by ${app.template?.name}'s move scripts.` : isKnown ? '' : 'Not an action. Drag it onto one to use it.');
    const others = groups.filter((x) => x.slot !== g.slot).map((x) => x.slot);
    return h(
      'div',
      {
        class: `anim-row${g.frames.length ? '' : ' empty'}`,
        draggable: !app.readOnly && g.frames.length > 0,
        onmouseenter: () => play(g.slot),
        ondragstart: (e: DragEvent) => {
          dragSlot = g.slot;
          e.dataTransfer?.setData('text/plain', g.slot);
        },
        ondragover: (e: DragEvent) => {
          if (dragSlot && dragSlot !== g.slot) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).classList.add('drop');
          }
        },
        ondragleave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('drop'),
        ondrop: (e: DragEvent) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.remove('drop');
          const from = dragSlot;
          dragSlot = null;
          if (!from || from === g.slot) return;
          if (copyMode || e.ctrlKey || e.altKey) copy(from, g.slot);
          else swap(from, g.slot);
        },
      },
      h('div', { class: 'anim-name' }, h('strong', null, g.slot), h('span', { class: 'hint' }, desc)),
      h('div', { class: 'anim-meta' }, g.frames.length ? `${g.frames.length} frame${g.frames.length > 1 ? 's' : ''}, ${seconds(g.frames).toFixed(2)} s` : 'No frames'),
      h(
        'div',
        { class: 'anim-strip' },
        g.frames.slice(0, 12).map((f) => h('img', { src: fileUrl(app.dir, f.file), title: `${f.name}, speed ${f.speed}`, draggable: false })),
        g.frames.length > 12 ? h('span', { class: 'hint' }, `+${g.frames.length - 12}`) : null,
      ),
      h(
        'div',
        { class: 'anim-actions' },
        h('button', { onclick: () => void paint(g.slot) }, icon(app.readOnly ? Eye : Brush), app.readOnly ? 'View' : g.frames.length ? 'Paint' : 'Draw'),
        !app.readOnly ? h('button', { onclick: () => void importFrames(g.slot).catch((e: Error) => toast(e.message, true)), title: 'Add frames from image files or an exported zip' }, icon(Upload), 'Import') : null,
        g.frames.length ? h('button', { onclick: () => void downloadPackFrames(app.dir, g.slot, g.frames), title: 'Download the frames as a zip' }, icon(Download), 'Export') : null,
        !g.frames.length && templateHas && !app.readOnly ? h('button', { onclick: () => void fromTemplate(g.slot) }, icon(Copy), `Copy ${app.template!.name}'s`) : null,
        g.frames.length && !app.readOnly
          ? h(
              'select',
              {
                title: 'Copy this animation to another action',
                onchange: (e: Event) => {
                  const to = (e.target as HTMLSelectElement).value;
                  if (to) copy(g.slot, to);
                },
              },
              h('option', { value: '' }, 'Copy to'),
              others.map((o) => h('option', { value: o }, o)),
            )
          : null,
        g.frames.length && !app.readOnly
          ? h(
              'button',
              {
                onclick: () => {
                  if (!confirm(`Remove the frames of ${g.slot}?`)) return;
                  g.frames = [];
                  void commit();
                },
              },
              icon(Trash2),
              'Clear',
            )
          : null,
      ),
    );
  };

  fill(
    body,
    h(
      'section',
      { class: 'card anim-head' },
      h(
        'div',
        null,
        h('h2', null, 'Animations'),
        h('p', { class: 'hint' }, 'Each row is an action the fighter plays an animation for. Drag a row onto another to swap their animations. Hold Ctrl while dropping, or turn on copying, to copy instead. Move hitboxes and effects are on the Moves tab.'),
        h(
          'div',
          { class: 'button-row' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: copyMode, onchange: (e: Event) => (copyMode = (e.target as HTMLInputElement).checked) }), 'Dropping copies'),
          h('button', { onclick: newDraft, disabled: app.readOnly }, icon(Plus), 'New animation'),
          h('button', { onclick: () => void openRecolor(() => renderAnimations(body)), disabled: app.readOnly, title: 'Change colors in every frame and the art' }, icon(Palette), 'Recolor character'),
        ),
      ),
      preview,
    ),
    h('section', { class: 'anim-list' }, groups.map(row)),
  );
  if (previewSlot && groups.some((g) => g.slot === previewSlot)) play(previewSlot);
  else play('idle');
}
