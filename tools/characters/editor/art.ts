// The Art tab: menu and match images. Each one is uploaded, painted, or taken from the template.
import { Brush, Download, Eye, Undo2, Upload } from 'lucide';
import { ART, type Image } from '../../../src/game/pack-format.ts';
import { findDoc, sources, writeFrames } from './frames.ts';
import { app } from './main.ts';
import { openPaint } from './paint.ts';
import { api, bumpVersion, field, fileUrl, fill, h, loadImage, numberInput, pickFile, randomId, toast, icon } from './util.ts';

export function renderArt(body: HTMLElement): void {
  const p = app.pack!;
  const changed = async (save = false) => {
    app.changed();
    if (save) await app.save(true);
    renderArt(body);
  };
  const card = (key: string) => {
    const own = p.art[key] as Image | null;
    const tmpl = app.template?.art[key] ?? null;
    const shown = own ?? tmpl;
    const dir = own ? app.dir : app.templateDir;
    const upload = async () => {
      const [file] = await pickFile('image/png,image/svg+xml');
      if (!file) return;
      const svg = file.name.toLowerCase().endsWith('.svg');
      const path = `art/${key}/${randomId()}${svg ? '.svg' : '.png'}`;
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      await api.put(app.dir, path, file);
      bumpVersion();
      p.art[key] = { file: path, center: [img.naturalWidth / 2, img.naturalHeight / 2], resolution: svg ? 1 : 2 };
      await changed(true);
    };
    /** Saves the image as it is, named after the character and the art slot. */
    const download = async () => {
      if (!shown || !dir) return;
      const ext = /\.[a-z]+$/i.exec(shown.file)?.[0] ?? '.png';
      const url = URL.createObjectURL(await (await fetch(fileUrl(dir, shown.file))).blob());
      h('a', { href: url, download: `${p.name.replace(/[^A-Za-z0-9_-]+/g, '-')}-${key}${ext}` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    const paint = async () => {
      await openPaint({
        title: `${p.name}: ${ART[key].label}`,
        slot: key,
        single: true,
        frames: shown && dir ? sources(dir, [shown], key) : [],
        doc: own ? await findDoc(app.dir, [own.file]) : null,
        onSave: async (out) => {
          if (app.readOnly) throw new Error('The original characters are read-only.');
          const [f] = await writeFrames(app.dir, `art/${key}`, out);
          p.art[key] = { file: f.file, center: f.center, resolution: 2 };
          await changed(true);
        },
      });
    };
    return h(
      'div',
      { class: 'art-card' },
      h('h3', null, ART[key].label),
      h('div', { class: 'art-image' }, shown && dir ? h('img', { src: fileUrl(dir, shown.file), draggable: false }) : h('span', { class: 'hint' }, 'None')),
      h('p', { class: 'hint' }, own ? own.file : tmpl ? `From ${app.template?.name}` : 'Missing'),
      own
        ? h(
            'div',
            { class: 'form-grid' },
            field('Center X', numberInput(own.center[0], (v) => ((own.center[0] = Number(v) || 0), void changed()))),
            field('Center Y', numberInput(own.center[1], (v) => ((own.center[1] = Number(v) || 0), void changed()))),
          )
        : null,
      app.readOnly
        ? h('div', { class: 'button-row' }, h('button', { onclick: () => void paint() }, icon(Eye), 'View'), shown ? h('button', { onclick: () => void download() }, icon(Download), 'Download') : null)
        : h(
            'div',
            { class: 'button-row' },
            h('button', { onclick: () => void upload().catch((e: Error) => toast(e.message, true)) }, icon(Upload), 'Upload'),
            h('button', { onclick: () => void paint() }, icon(Brush), 'Paint'),
            shown ? h('button', { onclick: () => void download() }, icon(Download), 'Download') : null,
            own && tmpl ? h('button', { onclick: () => ((p.art[key] = null), void changed()) }, icon(Undo2), 'Use template\'s') : null,
          ),
    );
  };
  fill(
    body,
    h('section', { class: 'card' }, h('h2', null, 'Art'), h('p', { class: 'hint' }, 'Images for the menus and the match intro. Art that is not set comes from the template. The center is in image pixels.')),
    h('section', { class: 'art-grid' }, Object.keys(ART).map(card)),
  );
}
