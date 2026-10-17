// The mod maker page: pick or create a character pack, edit it in tabs, save, and play it in the
// game. The store in util.ts decides whether packs live in the project's folders or in this browser.
import { BookOpen, FolderInput, FolderOutput, Sparkles, Bot, Check, FilePlus, Film, Hammer, Image as ImageIcon, Info, Play, Save, SlidersHorizontal, Swords, Trash2, Unlink, UserPlus, X } from 'lucide';
import { CHARACTER_FILE_TYPES, RULES, STAT_FIELDS, type CharacterPack } from '../../../src/game/pack-format.ts';
import { slugify } from '../pack-files.ts';
import { renderAnimations } from './animations.ts';
import { renderArt } from './art.ts';
import { renderParticles } from './particles.ts';
import { renderMoves } from './moves.ts';
import { api, field, fill, GUIDE_URL, h, numberInput, pickFile, textInput, toast, type PackSummary, type Problem, icon } from './util.ts';

const TABS = [
  ['overview', 'Overview', Info],
  ['stats', 'Stats', SlidersHorizontal],
  ['animations', 'Animations', Film],
  ['moves', 'Moves', Swords],
  ['art', 'Art', ImageIcon],
  ['particles', 'Particles', Sparkles],
  ['cpu', 'CPU', Bot],
  ['check', api.browser ? 'Check and play' : 'Check and build', Hammer],
] as const;
type Tab = (typeof TABS)[number][0];
const PLAY_LABEL = api.browser ? 'Play' : 'Build and play';

export const app = {
  dir: '',
  pack: null as CharacterPack | null,
  readOnly: false,
  problems: [] as Problem[],
  packs: [] as PackSummary[],
  templates: [] as { slug: string; name: string }[],
  examples: [] as { slug: string; name: string }[],
  /** The template's own pack, for data this pack takes from it. */
  template: null as CharacterPack | null,
  templateDir: null as string | null,
  dirty: false,
  /** The gimmick script's text while it has unsaved changes, in the browser store's script box. */
  script: null as string | null,
  tab: 'overview' as Tab,
  buildOutput: '',

  changed(): void {
    this.dirty = true;
    // Only the badges change, so a field's change event on blur does not replace the button being clicked.
    status();
  },
  async save(quiet = false): Promise<boolean> {
    if (!this.pack || this.readOnly) return false;
    try {
      if (this.script !== null && this.pack.gimmick) await api.put(this.dir, this.pack.gimmick, this.script);
      this.script = null;
      this.problems = (await api.save(this.dir, this.pack)).problems;
      this.dirty = false;
      header();
      if (!quiet) toast('Saved');
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
      return false;
    }
  },
  render(): void {
    renderTab();
  },
};

const el = {
  head: h('header', { class: 'top' }),
  status: h('span', { style: 'display: contents' }),
  tabs: h('nav', { class: 'tabs' }),
  main: h('main', { class: 'tab' }),
};
document.body.append(el.head, el.tabs, el.main);

window.addEventListener('beforeunload', (e) => {
  if (app.dirty) e.preventDefault();
});
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !document.querySelector('.paint')) {
    e.preventDefault();
    void app.save();
  }
});

function status(): void {
  const errors = app.problems.filter((p) => p.level === 'error').length;
  fill(
    el.status,
    app.readOnly ? h('span', { class: 'badge' }, 'Read-only') : h('span', { class: `badge${app.dirty ? ' warn' : ''}` }, app.dirty ? 'Unsaved changes' : 'Saved'),
    errors && !app.readOnly ? h('span', { class: 'badge error', title: `See ${TABS.at(-1)![1]}` }, `${errors} error${errors > 1 ? 's' : ''}`) : null,
  );
}

function header(): void {
  status();
  const select = h(
    'select',
    {
      onchange: (e: Event) => void open((e.target as HTMLSelectElement).value, app.tab),
    },
    h('optgroup', { label: 'Your characters' }, app.packs.map((p) => h('option', { value: p.slug, selected: p.slug === app.dir }, p.name))),
    h('optgroup', { label: 'Original characters (read-only)' }, app.templates.map((t) => h('option', { value: `_templates/${t.slug}`, selected: `_templates/${t.slug}` === app.dir }, t.name))),
    app.examples.length ? h('optgroup', { label: 'Examples (read-only)' }, app.examples.map((t) => h('option', { value: `_examples/${t.slug}`, selected: `_examples/${t.slug}` === app.dir }, t.name))) : null,
  );
  fill(
    el.head,
    h('strong', null, 'Mod maker'),
    select,
    h('button', { onclick: () => newCharacter() }, icon(UserPlus), 'New character'),
    h('button', { onclick: () => void importCharacter(), title: 'Add a character from a .sfrt file someone shared' }, icon(FolderInput), 'Import character'),
    h('button', { onclick: () => void exportCharacter(), disabled: !app.pack, title: 'Download this character as a .sfrt file to share' }, icon(FolderOutput), 'Export character'),
    api.browser ? h('button', { onclick: () => void deleteCharacter(), disabled: !app.pack || app.readOnly, title: 'Delete this character from this browser' }, icon(Trash2), 'Delete character') : null,
    api.browser ? h('button', { onclick: () => window.open(GUIDE_URL, '_blank', 'noopener'), title: 'How characters, moves and gimmick scripts work' }, icon(BookOpen), 'Guide') : null,
    h('span', { class: 'grow' }),
    el.status,
    h('button', { onclick: () => void app.save(), disabled: app.readOnly }, icon(Save), 'Save'),
    h('button', { class: 'primary', onclick: () => void buildAndPlay(), disabled: app.readOnly }, icon(Play), PLAY_LABEL),
  );
  fill(
    el.tabs,
    TABS.map(([id, label, glyph]) =>
      h(
        'button',
        {
          class: app.tab === id ? 'on' : '',
          onclick: () => {
            app.tab = id;
            location.hash = `${app.dir}|${id}`;
            header();
            renderTab();
          },
        },
        icon(glyph),
        label,
      ),
    ),
  );
}

async function open(dir: string, tab: Tab = 'overview'): Promise<void> {
  if (app.dirty && !confirm('Discard unsaved changes?')) return header();
  try {
    const r = await api.pack(dir);
    Object.assign(app, { dir, pack: r.pack, problems: r.problems, readOnly: r.readOnly, dirty: false, script: null, tab, buildOutput: '' });
    const t = app.templates.find((x) => x.name === r.pack.template);
    app.templateDir = t && `_templates/${t.slug}` !== dir ? `_templates/${t.slug}` : null;
    app.template = app.templateDir ? (await api.pack(app.templateDir)).pack : null;
    location.hash = `${dir}|${tab}`;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true);
  }
  header();
  renderTab();
}

async function importCharacter(): Promise<void> {
  const [file] = await pickFile(CHARACTER_FILE_TYPES);
  if (!file) return;
  try {
    const { slug } = await api.importZip(file);
    await refreshList();
    await open(slug, 'overview');
    toast(api.browser ? `Imported ${app.pack?.name ?? slug}` : `Imported characters/${slug}`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true);
  }
}

async function exportCharacter(): Promise<void> {
  if (app.dirty && !app.readOnly && !(await app.save(true))) return;
  try {
    await api.exportZip(app.dir);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true);
  }
}

async function deleteCharacter(): Promise<void> {
  if (!app.pack || !confirm(`Delete ${app.pack.name} from this browser? Export it first to keep a copy. Its mod in the game stays until you delete it on the Mods screen.`)) return;
  try {
    await api.remove(app.dir);
    app.dirty = false;
    await refreshList();
    await open(app.packs[0]?.slug ?? `_templates/${app.templates[0]?.slug}`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true);
  }
}

async function refreshList(): Promise<void> {
  const r = await api.list();
  app.packs = r.packs;
  app.templates = r.templates;
  app.examples = r.examples;
}

function newCharacter(): void {
  const name = h('input', { type: 'text', placeholder: 'Name shown in the game' });
  const folder = h('input', { type: 'text', placeholder: 'folder-name' });
  let folderEdited = false;
  name.addEventListener('input', () => {
    if (!folderEdited) folder.value = slugify(name.value);
  });
  folder.addEventListener('input', () => (folderEdited = true));
  const from = h(
    'select',
    null,
    h('optgroup', { label: 'Original characters' }, app.templates.map((t) => h('option', { value: `_templates/${t.slug}` }, t.name))),
    app.examples.length ? h('optgroup', { label: 'Examples' }, app.examples.map((t) => h('option', { value: `_examples/${t.slug}` }, t.name))) : null,
    app.packs.length ? h('optgroup', { label: 'Your characters' }, app.packs.map((p) => h('option', { value: p.slug }, p.name))) : null,
  );
  const dialog = h(
    'dialog',
    { class: 'dialog' },
    h('h2', null, 'New character'),
    h('p', null, 'The new character starts with the frames, art and stats of the character you pick. Its moves stay the same as that character\'s until you customize them on the Moves tab.'),
    field('Name', name),
    // The browser store names the folder after the character, since players never see it.
    api.browser ? null : field('Folder', folder, 'The folder under characters/ that holds the character'),
    field('Start from', from),
    h(
      'div',
      { class: 'button-row' },
      h('button', { onclick: () => dialog.close() }, icon(X), 'Cancel'),
      h(
        'button',
        {
          class: 'primary',
          onclick: async () => {
            const slug = slugify(folder.value || name.value);
            if (!name.value.trim() || !slug) return toast('Enter a name', true);
            try {
              const made = await api.create(name.value.trim(), slug, from.value);
              dialog.close();
              await refreshList();
              app.dirty = false;
              await open(made.slug, 'overview');
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), true);
            }
          },
        },
        icon(Check),
        'Create',
      ),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
}

async function buildAndPlay(): Promise<void> {
  if (app.dirty && !(await app.save(true))) return;
  toast(api.browser ? 'Adding to the game' : 'Building');
  let r: { ok: boolean; output: string };
  try {
    r = await api.play(app.dir);
  } catch (e) {
    r = { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
  app.buildOutput = r.output;
  if (r.ok) {
    toast(api.browser ? 'Added. The game opens with the character.' : 'Built. The game page reloads with the new characters.');
    // A game tab with this name loads again, which is when the game reads its mods.
    window.open('./', 'sfrt-game');
  } else {
    toast(`${api.browser ? 'The character has errors' : 'The build failed'}. See ${TABS.at(-1)![1]}.`, true);
    app.tab = 'check';
    header();
  }
  renderTab();
}

function renderTab(): void {
  const pack = app.pack;
  if (!pack) {
    fill(el.main, h('p', { class: 'empty' }, app.packs.length ? 'Pick a character.' : 'Make a new character to start.'));
    return;
  }
  el.main.classList.toggle('readonly', app.readOnly);
  const banner = app.readOnly
    ? h('div', { class: 'banner' }, app.dir.startsWith('_examples/') ? 'This is an example, shown for reference. Use New character and start from it to make your own copy.' : 'This is an original character, shown for reference. Use New character to make an editable copy of it.')
    : null;
  const body = h('div', { class: 'tab-body' });
  fill(el.main, banner, body);
  ({ overview, stats, animations: renderAnimations, moves: renderMoves, art: renderArt, particles: renderParticles, cpu, check })[app.tab](body);
}

function overview(body: HTMLElement): void {
  const p = app.pack!;
  const set = (fn: () => void) => () => {
    fn();
    app.changed();
  };
  const template = h(
    'select',
    {
      onchange: async (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        p.template = v || null;
        app.changed();
        const t = app.templates.find((x) => x.name === p.template);
        app.templateDir = t ? `_templates/${t.slug}` : null;
        app.template = app.templateDir ? (await api.pack(app.templateDir)).pack : null;
      },
    },
    h('option', { value: '', selected: !p.template }, 'None'),
    app.templates.map((t) => h('option', { value: t.name, selected: t.name === p.template }, t.name)),
  );
  const rulesHint = h('p', { class: 'hint' }, p.rules ? RULES[p.rules] : '');
  const rules = h(
    'select',
    {
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        p.rules = v || null;
        rulesHint.textContent = p.rules ? RULES[p.rules] : '';
        app.changed();
      },
    },
    h('option', { value: '', selected: !p.rules }, 'None'),
    Object.keys(RULES).map((name) => h('option', { value: name, selected: name === p.rules }, name)),
  );
  const combo = (i: 0 | 1 | 2) =>
    h(
      'div',
      { class: 'combo' },
      field(`Combo move ${i + 1}`, textInput(p.text.combo[i].name, (v) => set(() => (p.text.combo[i].name = v))())),
      field('Description', textInput(p.text.combo[i].description, (v) => set(() => (p.text.combo[i].description = v))(), true)),
    );
  const gimmick = p.gimmick
    ? h(
        'div',
        { class: 'gimmick' },
        api.browser
          ? [h('p', null, 'Gimmick script, in JavaScript. The ', h('a', { href: GUIDE_URL, target: '_blank', rel: 'noopener' }, 'guide'), ' lists what each function receives and the two rules that keep online games in sync.'), scriptBox(p.gimmick)]
          : h('p', null, 'Gimmick script: ', h('code', null, `characters/${app.dir}/${p.gimmick}`), '. Edit it in your code editor. The guide in characters/README.md lists what it can do.'),
        app.readOnly ? null : h('button', { onclick: set(() => ((p.gimmick = null), (app.script = null), renderTab())) }, icon(Unlink), 'Stop using it'),
      )
    : h(
        'div',
        { class: 'gimmick' },
        h('p', null, 'A gimmick script runs code for this character every frame, when its moves start, and when its hits connect. Use one for a mechanic no original character has.'),
        h(
          'button',
          {
            disabled: app.readOnly,
            onclick: async () => {
              const r = await api.gimmick(app.dir);
              p.gimmick = r.file;
              app.changed();
              await app.save(true);
              toast(api.browser ? 'Added a gimmick script' : `Made ${r.path}`);
              renderTab();
            },
          },
          icon(FilePlus),
          'Add a gimmick script',
        ),
      );
  fill(
    body,
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Character'),
      field('Name', textInput(p.name, (v) => set(() => (p.name = v))())),
      field('Made from', template, 'Moves without their own data, and every scripted behavior, come from this character'),
      field('Built-in rules', rules, "Rules of an original character's fighter engine that this character also follows. A character made from another already follows that one's rules."),
      rulesHint,
      h('p', { class: 'hint' }, api.browser ? 'This browser keeps your characters. Export character saves a copy you can keep or share.' : `Folder: characters/${app.dir}`),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Character select text'),
      field('Story', textInput(p.text.lore, (v) => set(() => (p.text.lore = v))(), true)),
      field('How to play', textInput(p.text.mechanics, (v) => set(() => (p.text.mechanics = v))(), true)),
      combo(0),
      combo(1),
      combo(2),
    ),
    h('section', { class: 'card' }, h('h2', null, 'Gimmick'), gimmick),
  );
}

/** The gimmick script's text, editable in the page for the browser store. Save writes it. */
function scriptBox(file: string): HTMLElement {
  if (app.readOnly) {
    const pre = h('pre', { class: 'code' }, '');
    void api.text(app.dir, file).then((t) => (pre.textContent = t ?? ''));
    return pre;
  }
  const box = h('textarea', { class: 'code', spellcheck: false, rows: 18, value: app.script ?? '' });
  if (app.script === null) void api.text(app.dir, file).then((t) => app.script === null && (box.value = t ?? ''));
  box.addEventListener('input', () => {
    app.script = box.value;
    app.changed();
  });
  return box;
}

function stats(body: HTMLElement): void {
  const p = app.pack!;
  const t = app.template;
  fill(
    body,
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Stats'),
      h(
        'div',
        { class: 'stat-grid' },
        STAT_FIELDS.map(([key, label, help]) =>
          h(
            'div',
            { class: 'stat' },
            field(
              label,
              numberInput(p.stats[key], (v) => {
                p.stats[key] = v;
                app.changed();
              }),
              help,
            ),
            h('span', { class: 'hint' }, help, t ? ` ${t.name}: ${t.stats[key]}.` : ''),
          ),
        ),
      ),
    ),
  );
}

function cpu(body: HTMLElement): void {
  const p = app.pack!;
  const usesTemplate = p.cpu.behaviour === null;
  const behaviour = p.cpu.behaviour ?? app.template?.cpu.behaviour ?? ['', '', ''];
  fill(
    body,
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'CPU player'),
      h('p', { class: 'hint' }, 'These values use the game\'s own CPU formats. Start from the template\'s values and change one number at a time.'),
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: usesTemplate,
          onchange: (e: Event) => {
            p.cpu.behaviour = (e.target as HTMLInputElement).checked ? null : [...behaviour];
            app.changed();
            renderTab();
          },
        }),
        'Use the template\'s move choices',
      ),
      [0, 1, 2].map((i) =>
        field(
          `Move choices ${i + 1}`,
          textInput(String(behaviour[i] ?? ''), (v) => {
            if (!p.cpu.behaviour) return;
            p.cpu.behaviour[i] = v;
            app.changed();
          }),
        ),
      ),
      field(
        'Combo use',
        numberInput(p.cpu.comboUsage ?? '', (v) => {
          p.cpu.comboUsage = v === '' ? null : v;
          app.changed();
        }),
        'Empty uses the template\'s value',
      ),
      field(
        'Combos',
        textInput(p.cpu.combos.join('\n'), (v) => {
          p.cpu.combos = v
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          app.changed();
        }, true),
        'One per line',
      ),
    ),
  );
}

function check(body: HTMLElement): void {
  const list = (level: Problem['level']) => app.problems.filter((p) => p.level === level).map((p) => h('li', { class: level }, p.message));
  const unusedBox = h('div');
  const showUnused = async () => {
    const r = await api.unused(app.dir, false);
    fill(
      unusedBox,
      r.files.length
        ? [
            h('p', null, `${r.files.length} file${r.files.length > 1 ? 's are' : ' is'} not used by the character anymore.`),
            h('ul', { class: 'files' }, r.files.slice(0, 50).map((f) => h('li', null, f))),
            h(
              'button',
              {
                disabled: app.readOnly,
                onclick: async () => {
                  if (!confirm(`Delete ${r.files.length} unused files from ${api.browser ? app.pack!.name : `characters/${app.dir}`}?`)) return;
                  await api.unused(app.dir, true);
                  void showUnused();
                },
              },
              icon(Trash2),
              'Delete unused files',
            ),
          ]
        : h('p', null, 'Every file the character has is in use.'),
    );
  };
  void showUnused();
  fill(
    body,
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Problems'),
      app.problems.length ? h('ul', { class: 'problems' }, list('error'), list('warning')) : h('p', null, 'No problems found.'),
      h('p', { class: 'hint' }, `Errors stop ${api.browser ? 'the character from playing' : 'the build'}. Warnings point at things that will look or play wrong.`),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', null, api.browser ? 'Play' : 'Build'),
      api.browser
        ? h('p', null, 'Play saves the character, adds it to the Mods list on the game\'s main menu in this browser, and opens the game. It replaces the version added before. To share the character, export it and send the .sfrt file. Players add it with Add mod on the Mods screen.')
        : h('p', null, 'Build and play saves, adds every character in characters/ to the game, and opens the game. The game page reloads by itself after each build.'),
      h('button', { class: 'primary', onclick: () => void buildAndPlay(), disabled: app.readOnly }, icon(Play), PLAY_LABEL),
      app.buildOutput ? h('pre', { class: 'output' }, app.buildOutput) : null,
    ),
    h('section', { class: 'card' }, h('h2', null, 'Unused files'), unusedBox),
  );
}

async function start(): Promise<void> {
  try {
    await refreshList();
  } catch (e) {
    header();
    fill(el.main, h('p', { class: 'empty' }, `The mod maker could not start: ${e instanceof Error ? e.message : String(e)}`));
    return;
  }
  const [dir, tab] = decodeURIComponent(location.hash.slice(1)).split('|');
  const known = (d: string) => app.packs.some((p) => p.slug === d) || app.templates.some((t) => `_templates/${t.slug}` === d) || app.examples.some((t) => `_examples/${t.slug}` === d);
  const first = dir && known(dir) ? dir : app.packs[0]?.slug ?? (app.templates[0] ? `_templates/${app.templates[0].slug}` : '');
  header();
  if (first) await open(first, (TABS.some(([id]) => id === tab) ? tab : 'overview') as Tab);
  else renderTab();
}

void start();
