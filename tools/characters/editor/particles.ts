// The Particles tab: named animations a gimmick script shows with fighter.particle(name). Each one plays once.
import { Brush, Download, Eye, Plus, Trash2, Upload } from 'lucide';
import type { Frame } from '../../../src/game/pack-format.ts';
import { downloadPackFrames, readAnimation, writeImported } from './export.ts';
import { findDoc, sources, writeFrames } from './frames.ts';
import { app } from './main.ts';
import { openPaint } from './paint.ts';
import { fileUrl, fill, frameTicks, FRAME_MS, h, icon, pickFile, toast } from './util.ts';

export function renderParticles(body: HTMLElement): void {
  const p = app.pack!;
  const particles = (p.particles ??= {});
  const commit = async () => {
    for (const [k, v] of Object.entries(particles)) if (!v.length) delete particles[k];
    app.changed();
    await app.save(true);
    renderParticles(body);
  };
  const paint = async (name: string) => {
    const idle = p.animations.find((f) => /^idle/i.test(f.name ?? ''));
    await openPaint({
      title: `${p.name}: ${name} particle`,
      slot: name,
      frames: sources(app.dir, particles[name] ?? [], name),
      doc: await findDoc(app.dir, (particles[name] ?? []).map((f) => f.file)),
      reference: idle ? sources(app.dir, [idle], 'idle')[0] : null,
      onSave: async (out) => {
        if (app.readOnly) throw new Error('The original characters and examples are read-only.');
        particles[name] = await writeFrames(app.dir, `particles/${name}`, out);
        await commit();
      },
    });
  };
  const add = () => {
    const name = prompt('Particle name (letters, digits and _). Scripts show it with fighter.particle(name).')?.trim();
    if (!name) return;
    if (!/^[A-Za-z0-9_]+$/.test(name)) return toast('Use only letters, digits and _', true);
    if (particles[name]) return toast('That particle already exists', true);
    particles[name] = [];
    void paint(name);
  };
  const importFrames = async (name: string) => {
    const files = await pickFile('.zip,image/png,image/svg+xml', true);
    const frames = files.length ? await readAnimation(files, 4) : [];
    if (!frames.length) return;
    particles[name] = await writeImported(app.dir, `particles/${name}`, frames, (_, i) => `${name}${i + 1}`);
    await commit();
  };
  const row = (name: string, frames: Frame[]) =>
    h(
      'div',
      { class: 'anim-row' },
      h('div', { class: 'anim-name' }, h('strong', null, name), h('span', { class: 'hint' }, `fighter.particle('${name}')`)),
      h('div', { class: 'anim-meta' }, `${frames.length} frame${frames.length === 1 ? '' : 's'}, ${((frames.reduce((n, f) => n + frameTicks(f.speed), 0) * FRAME_MS) / 1000).toFixed(2)} s`),
      h(
        'div',
        { class: 'anim-strip' },
        frames.slice(0, 12).map((f) => h('img', { src: fileUrl(app.dir, f.file), draggable: false })),
      ),
      h(
        'div',
        { class: 'anim-actions' },
        h('button', { onclick: () => void paint(name) }, icon(app.readOnly ? Eye : Brush), app.readOnly ? 'View' : 'Paint'),
        app.readOnly ? null : h('button', { onclick: () => void importFrames(name).catch((e: Error) => toast(e.message, true)), title: 'Replace the frames with image files or an exported zip' }, icon(Upload), 'Import'),
        h('button', { onclick: () => void downloadPackFrames(app.dir, name, frames), title: 'Download the frames as a zip' }, icon(Download), 'Export'),
        app.readOnly
          ? null
          : h(
              'button',
              {
                onclick: () => {
                  if (!confirm(`Delete the ${name} particle?`)) return;
                  delete particles[name];
                  void commit();
                },
              },
              icon(Trash2),
              'Delete',
            ),
      ),
    );
  fill(
    body,
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Particles'),
      h('p', { class: 'hint' }, "Animations a gimmick script shows with fighter.particle(name), such as a mark over a fighter. Each plays once, so a script that shows one every frame keeps it on screen. Like the game's own particles, one is invisible on its first game frame."),
      h('div', { class: 'button-row' }, h('button', { onclick: add, disabled: app.readOnly }, icon(Plus), 'New particle')),
    ),
    h(
      'section',
      { class: 'anim-list' },
      Object.entries(particles).map(([name, frames]) => row(name, frames)),
    ),
  );
}
