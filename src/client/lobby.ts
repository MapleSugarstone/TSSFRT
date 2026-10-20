// The screen shown before the game starts: play offline, or host or join an online room.
import type { SeatInfo } from '../net/protocol.ts';
import type { LinkState } from '../net/mesh.ts';
import { browserKeyToName } from '../engine/io.ts';
import { CHARACTER_FILE_TYPES } from '../game/pack-format.ts';
import { cleanName, DEFAULT_PREFS, NAME_MAX, type Prefs } from '../net/protocol.ts';
import { ACTIONS, DEFAULT_CONTROLS, DEFAULT_TOUCH_BUTTONS, loadControls, loadPrefs, loadTouchButtons, saveControls, savePrefs, saveTouchButtons } from './controls.ts';
import { addMod, deleteMod, listMods, modScript, setModEnabled, setModScriptAllowed, type ModInfo, type ModLoad } from './mods.ts';
import { installUiAssets, playerBadge } from './ui-assets.ts';
import { listControllers } from './pads.ts';
import { createElement, Download, Pencil, Play, Trash2, X, type IconNode } from 'lucide';
import { clock, REPLAY_NAME_MAX, replayName, replayTitle, type ReplayMeta } from './replay.ts';
import { deleteReplay, importReplay, listReplays, renameReplay, REPLAY_FILE_TYPE, replayFile } from './replay-store.ts';
import { VIDEO_QUALITIES, type VideoQuality } from './replay-viewer.ts';
import { downloadFile, fileName } from './download.ts';

const EXPORT_KEY = 'sfrt.replayExport';

/** The last download choices: a video or a replay file, and the video's quality. */
function loadExport(): { kind: 'mp4' | 'sfrp'; quality: VideoQuality } {
  try {
    const v = JSON.parse(localStorage.getItem(EXPORT_KEY) ?? 'null');
    if ((v?.kind === 'mp4' || v?.kind === 'sfrp') && v.quality in VIDEO_QUALITIES) return v;
  } catch {
    // Storage may be blocked.
  }
  return { kind: 'mp4', quality: '720p' };
}

const NAME_KEY = 'sfrt.name';
const DELAY_KEY = 'sfrt.delay';
const HQ_KEY = 'sfrt.hqpen';
const MOD_MAKER = './mod-maker.html';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** An on/off option button: its label, then its state in a small tag. */
function renderOption(b: HTMLButtonElement, label: string, on: boolean): void {
  const state = el('span', `lobby-option-state${on ? ' on' : ''}`, on ? 'On' : 'Off');
  if (label) b.replaceChildren(el('span', 'lobby-option-label', label), state);
  else b.replaceChildren(state);
  b.setAttribute('aria-pressed', String(on));
}

/** A key name as a button shows it: "space" becomes "Space", "up arrow" becomes "Up arrow". */
function keyLabel(name: string): string {
  return name ? name[0].toUpperCase() + name.slice(1) : 'None';
}

/** A made-up name, which online play accepts without a Scratch account. */
function randomName(): string {
  return `player${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
}

const NAME_RULE = 'Names use letters, numbers, _ and -, as Scratch usernames do.';

/** A button that shows only an icon, with its name in the tooltip. */
function iconButton(node: IconNode, label: string, cls = ''): HTMLButtonElement {
  const b = el('button', `lobby-option lobby-icon ${cls}`.trim());
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(createElement(node, { width: 18, height: 18, 'aria-hidden': 'true' }));
  return b;
}

/**
 * Turns a list row into a question with Delete and Keep, keeping `name` on the left. Pages cannot count on
 * the browser's own dialogs, which some embedded browsers never show.
 */
function askDelete(li: HTMLLIElement, name: HTMLElement, question: string, remove: () => Promise<void>, keep: () => void): void {
  const ask = el('div', 'row-ask');
  ask.append(name, el('span', 'row-question', question));
  const yes = el('button', 'lobby-option mod-delete', 'Delete');
  yes.addEventListener('click', () => void remove());
  const no = el('button', 'lobby-option', 'Keep');
  no.addEventListener('click', keep);
  li.classList.add('asking');
  li.replaceChildren(ask, yes, no);
  no.focus();
}

/** "FINAL DESTINATION" as "Final Destination". */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** "Online versus, Battlefield, 2:31, Oct 20", after the fighters when the replay has a name. */
function replayDetail(m: ReplayMeta): string {
  const kind = `${m.online ? 'Online ' : ''}${m.mode.toLowerCase()}`;
  const when = new Date(m.saved).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return [m.name ? replayTitle(m) : '', `${kind[0].toUpperCase()}${kind.slice(1)}`, titleCase(m.stage), clock(m.frames), when].filter(Boolean).join(', ');
}

/** Everything about a replay, for the tooltip on its row. */
function replayAbout(m: ReplayMeta): string {
  const who = m.online && m.names.length ? `\nPlayers: ${m.names.join(', ')}` : '';
  const when = new Date(m.saved).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `${replayName(m)}\n${replayTitle(m)}, ${titleCase(m.stage)}\n${m.online ? 'Online ' : ''}${m.mode}, ${clock(m.frames)}, saved ${when}${who}`;
}

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Storage may be blocked.
  }
}

export interface LobbyHandlers {
  local(): void;
  host(name: string): void;
  join(name: string, code: string): void;
  start(delay: number): void;
  prefs(p: Prefs): void;
  /** Called at startup with the saved choice and again whenever the player changes it. */
  hqPen(on: boolean): void;
  /** The player switched the touch controls on or off. */
  touchControls(on: boolean): void;
  /** The player changed which touch button does what, in the place order of `DEFAULT_TOUCH_BUTTONS`. */
  touchButtons(names: string[]): void;
  /** The player chose a replay to watch. */
  watch(id: string): void;
  /** The player chose to download a replay as a video. */
  recordVideo(id: string, quality: VideoQuality): void;
  leave(): void;
}

export class Lobby {
  root: HTMLDivElement;
  private status: HTMLDivElement;
  private menu: HTMLDivElement;
  private room: HTMLDivElement;
  private codeOut: HTMLSpanElement;
  private countOut: HTMLSpanElement;
  private seatList: HTMLUListElement;
  private startBtn: HTMLButtonElement;
  private waitNote: HTMLParagraphElement;
  private nameIn: HTMLInputElement;
  private delayIn: HTMLSelectElement;
  private controlsView: HTMLDivElement;
  private controlsBtn: HTMLButtonElement;
  private modsView: HTMLDivElement;
  private modsBtn: HTMLButtonElement;
  private replaysView: HTMLDivElement;
  private replaysBtn: HTMLButtonElement;
  private replayList: HTMLUListElement;
  private modList: HTMLUListElement;
  private modProblems: HTMLUListElement;
  private scriptView: HTMLDivElement;
  private reloadBtn: HTMLButtonElement;
  private mods: ModInfo[] = [];
  private modLoad: ModLoad = { loaded: [], ids: [], problems: [], warnings: [] };
  private modsChanged = false;
  private hqBtn: HTMLButtonElement;
  private hq = load(HQ_KEY, '1') === '1';
  private touchBtn: HTMLButtonElement;
  private touchOn = false;
  private leaveBtn: HTMLButtonElement;
  private keyButtons: HTMLButtonElement[] = [];
  private controls = loadControls();
  private prefs = loadPrefs();
  private upJumpBtn!: HTMLButtonElement;
  private comboBtn!: HTMLButtonElement;
  private controlsHeading: HTMLDivElement;
  private controlsTabs: HTMLDivElement;
  private keysTabBtn: HTMLButtonElement;
  private touchTabBtn: HTMLButtonElement;
  private controlsTab: 'keys' | 'touch' = 'keys';
  private keysPart: HTMLDivElement;
  /** Which controllers the browser sees, while the controls screen shows. */
  private padNote: HTMLParagraphElement;
  private padTimer: ReturnType<typeof setInterval> | null = null;
  private touchEdit: HTMLDivElement;
  private touchPicks: HTMLButtonElement[] = [];
  private touchButtons = loadTouchButtons();
  /** The touch button tapped first, waiting for the one to swap with, or -1. */
  private picked = -1;
  private capturing = -1;
  private backTo: 'menu' | 'room' = 'menu';
  private loading = true;

  constructor(parent: HTMLElement, private h: LobbyHandlers) {
    installUiAssets(document.documentElement);
    this.root = el('div', 'lobby');
    const panel = el('div', 'lobby-panel');
    const title = el('h1', 'lobby-title');
    title.append(el('span', 'visually-hidden', 'Super Fighter Re:Tournament'), el('span', 'lobby-logo'));
    panel.append(title);

    this.menu = el('div', 'lobby-menu');
    const nameRow = el('label', 'lobby-field');
    nameRow.append(el('span', '', 'Name'));
    this.nameIn = el('input');
    this.nameIn.maxLength = NAME_MAX;
    this.nameIn.spellcheck = false;
    this.nameIn.autocomplete = 'off';
    this.nameIn.autocapitalize = 'off';
    this.nameIn.title = 'Your Scratch username, or player and a number';
    this.nameIn.value = cleanName(load(NAME_KEY, '')) || randomName();
    // Characters a Scratch username cannot hold are dropped as they are typed or pasted.
    this.nameIn.addEventListener('input', () => {
      const v = this.nameIn.value;
      const clean = cleanName(v);
      if (clean === v) return;
      const at = cleanName(v.slice(0, this.nameIn.selectionStart ?? v.length)).length;
      this.nameIn.value = clean;
      this.nameIn.setSelectionRange(at, at);
      this.setStatus(NAME_RULE);
    });
    nameRow.append(this.nameIn);
    const localBtn = el('button', 'primary', 'Play offline');
    const hostBtn = el('button', '', 'Host an online game');
    const joinRow = el('div', 'lobby-join');
    const codeIn = el('input');
    codeIn.placeholder = 'Room code';
    codeIn.maxLength = 6;
    codeIn.autocapitalize = 'characters';
    const joinBtn = el('button', '', 'Join');
    joinRow.append(codeIn, joinBtn);
    this.onlineRows = [nameRow, hostBtn, joinRow];
    this.offlineNote = el('p', 'lobby-note', 'Online play is not set up for this copy of the game.');
    this.offlineNote.hidden = true;
    this.menu.append(localBtn, el('div', 'lobby-heading', 'Online'), nameRow, hostBtn, joinRow, this.offlineNote);

    this.room = el('div', 'lobby-room');
    this.room.hidden = true;
    const bar = el('div', 'lobby-bar');
    this.codeOut = el('span', 'code');
    const codeCell = el('span', '', 'Code ');
    codeCell.append(this.codeOut);
    this.countOut = el('span');
    bar.append(el('span', 'lobby-bar-title', 'Online'), codeCell, this.countOut);
    this.seatList = el('ul', 'lobby-seats');
    const opts = el('div', 'lobby-opts');
    const delayRow = el('label', 'lobby-field');
    delayRow.append(el('span', '', 'Input delay'));
    this.delayIn = el('select');
    for (let d = 0; d <= 4; d++) {
      const o = el('option', '', `${d} frame${d === 1 ? '' : 's'} (${Math.round((d * 1000) / 30)} ms)`);
      o.value = String(d);
      this.delayIn.append(o);
    }
    this.delayIn.value = load(DELAY_KEY, '1');
    delayRow.append(this.delayIn);
    opts.append(delayRow);
    this.startBtn = el('button', 'primary', 'Start');
    this.waitNote = el('p', 'lobby-note', 'Waiting for the host to start.');
    this.room.append(bar, this.seatList, opts, this.startBtn, this.waitNote);

    this.controlsView = el('div', 'lobby-controls');
    this.controlsView.hidden = true;
    const grid = el('div', 'controls-grid');
    ACTIONS.forEach((action, i) => {
      const row = el('div', 'control');
      const key = el('button', 'control-key');
      key.addEventListener('click', () => this.capture(i));
      this.keyButtons.push(key);
      row.append(el('span', '', action), key);
      grid.append(row);
    });
    // The controls menu's two per-player options, applied to this player's own seat when a game starts.
    const options = el('div', 'controls-grid');
    const option = (label: string, onClick: () => void): HTMLButtonElement => {
      const row = el('div', 'control');
      const b = el('button', 'control-key');
      b.addEventListener('click', onClick);
      row.append(el('span', '', label), b);
      options.append(row);
      return b;
    };
    this.upJumpBtn = option('Up is Jump', () => this.setPrefs({ ...this.prefs, upJump: !this.prefs.upJump }));
    this.comboBtn = option('Combo use', () => this.setPrefs({ ...this.prefs, combo: this.prefs.combo === 'Charge' ? 'Best' : 'Charge' }));
    // The touch buttons in their places on the screen.
    this.touchEdit = el('div', 'touch-edit');
    const touchFace = el('div', 'touch-edit-face');
    const touchSmall = el('div', 'touch-edit-small');
    ['top', 'left', 'right', 'bottom', 'pill', 'pill'].forEach((place, i) => {
      const b = el('button', place);
      b.addEventListener('click', () => this.pickTouch(i));
      this.touchPicks.push(b);
      (i < 4 ? touchFace : touchSmall).append(b);
    });
    const touchPad = el('div', 'touch-edit-pad');
    touchPad.append(touchFace, touchSmall);
    this.touchEdit.append(el('p', 'lobby-note', 'Tap two buttons to swap them.'), touchPad);
    this.renderTouch();
    // While the touch controls are on, two tabs take the heading's place, so the screen fits without scrolling.
    this.controlsHeading = el('div', 'lobby-heading', 'Your controls');
    this.controlsTabs = el('div', 'controls-tabs');
    const tab = (label: string, which: 'keys' | 'touch'): HTMLButtonElement => {
      const b = el('button', '', label);
      b.addEventListener('click', () => {
        this.controlsTab = which;
        this.capture(-1);
        this.renderControlsTab();
      });
      this.controlsTabs.append(b);
      return b;
    };
    this.keysTabBtn = tab('Keys', 'keys');
    this.touchTabBtn = tab('Touch buttons', 'touch');
    this.keysPart = el('div', 'controls-keys');
    this.keysPart.append(el('p', 'lobby-note', 'Your default controls for player 1 and online.'), grid);
    const actions = el('div', 'lobby-actions');
    const resetBtn = el('button', '', 'Reset to default');
    const backBtn = el('button', 'primary', 'Done');
    actions.append(resetBtn, backBtn);
    this.padNote = el('p', 'lobby-note');
    this.controlsView.append(this.controlsHeading, this.controlsTabs, this.keysPart, this.touchEdit, options, this.padNote, actions);
    resetBtn.addEventListener('click', () => {
      this.controls = [...DEFAULT_CONTROLS];
      saveControls(this.controls);
      this.setPrefs({ ...DEFAULT_PREFS });
      this.setTouchButtons([...DEFAULT_TOUCH_BUTTONS]);
      this.capture(-1);
    });
    backBtn.addEventListener('click', () => this.closeControls());
    this.renderKeys();

    this.modsView = el('div', 'lobby-controls lobby-mods');
    this.modsView.hidden = true;
    this.modList = el('ul', 'mod-list');
    this.modProblems = el('ul', 'mod-problems');
    this.scriptView = el('div', 'mod-script');
    this.scriptView.hidden = true;
    const modActions = el('div', 'lobby-actions');
    const addBtn = el('button', '', 'Add mod');
    this.reloadBtn = el('button', 'primary', 'Reload to apply');
    this.reloadBtn.hidden = true;
    const modsDone = el('button', '', 'Done');
    // On the site the mod maker keeps characters in this browser. Under the development server it edits the project's files.
    const makeBtn = el('button', '', 'Make a mod');
    makeBtn.title = 'Open the mod maker in a new tab';
    makeBtn.addEventListener('click', () => window.open(MOD_MAKER, '_blank', 'noopener'));
    modActions.append(addBtn, makeBtn, this.reloadBtn, modsDone);
    this.modsView.append(
      el('div', 'lobby-heading', 'Mods'),
      el('p', 'lobby-note', 'Mods add characters, made with the mod maker. They stay in this browser, and changes apply when the page reloads.'),
      el('p', 'lobby-note', 'Online, you can only play with people who have the same mods turned on. When you add a mod with a script, the game asks whether to turn the script on. Turn it on only if you trust where the mod came from.'),
      this.modList,
      this.scriptView,
      this.modProblems,
      modActions,
    );
    const filePick = el('input');
    filePick.type = 'file';
    filePick.accept = CHARACTER_FILE_TYPES;
    filePick.multiple = true;
    filePick.hidden = true;
    this.modsView.append(filePick);
    addBtn.addEventListener('click', () => filePick.click());
    filePick.addEventListener('change', async () => {
      const files = [...(filePick.files ?? [])];
      filePick.value = '';
      const problems: string[] = [];
      const added: ModInfo[] = [];
      for (const file of files) {
        try {
          added.push(await addMod(file));
          this.modsChanged = true;
        } catch (e) {
          problems.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      await this.refreshMods(problems);
      for (const m of added) if (m.hasScript && !m.scriptAllowed) await this.showScript(m, true);
    });
    this.reloadBtn.addEventListener('click', () => location.reload());
    modsDone.addEventListener('click', () => this.show('menu'));

    this.replaysView = el('div', 'lobby-controls lobby-mods lobby-replays');
    this.replaysView.hidden = true;
    this.replayList = el('ul', 'mod-list replay-list');
    const replayActions = el('div', 'lobby-actions');
    const upload = el('button', '', 'Upload');
    const replayPick = el('input');
    replayPick.type = 'file';
    replayPick.accept = REPLAY_FILE_TYPE;
    replayPick.multiple = true;
    replayPick.hidden = true;
    upload.addEventListener('click', () => replayPick.click());
    replayPick.addEventListener('change', async () => {
      const files = [...(replayPick.files ?? [])];
      replayPick.value = '';
      const problems: string[] = [];
      for (const file of files) {
        try {
          await importReplay(file);
        } catch (e) {
          problems.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      await this.refreshReplays();
      this.setStatus(problems.join(' '));
    });
    const replaysDone = el('button', 'primary', 'Done');
    replaysDone.addEventListener('click', () => this.show('menu'));
    replayActions.append(upload, replaysDone, replayPick);
    this.replaysView.append(el('div', 'lobby-heading', 'Replays'), this.replayList, replayActions);

    this.status = el('div', 'lobby-status');
    this.leaveBtn = el('button', 'lobby-return', 'Leave');
    this.leaveBtn.hidden = true;
    this.controlsBtn = el('button', 'lobby-corner', 'Controls');
    this.controlsBtn.addEventListener('click', () => this.openControls());
    this.modsBtn = el('button', 'lobby-option');
    this.modsBtn.addEventListener('click', () => {
      this.show('mods');
      void this.refreshMods();
    });
    this.hqBtn = el('button', 'lobby-option');
    this.hqBtn.addEventListener('click', () => this.setHq(!this.hq));
    this.renderHq();
    this.h.hqPen(this.hq);
    this.touchBtn = el('button', 'lobby-option');
    this.touchBtn.addEventListener('click', () => this.h.touchControls(!this.touchOn));
    this.setTouch(false);
    this.replaysBtn = el('button', 'lobby-option', 'Replays');
    this.replaysBtn.addEventListener('click', () => this.openReplays());
    panel.append(this.menu, this.room, this.controlsView, this.modsView, this.replaysView, this.status);
    // The footer keeps these out of the panel's way on short screens.
    const footer = el('div', 'lobby-footer');
    const left = el('div', 'lobby-footer-left');
    left.append(this.leaveBtn, this.hqBtn, this.touchBtn);
    const topLeft = el('div', 'lobby-top-left');
    topLeft.append(this.modsBtn, this.replaysBtn);
    void this.refreshMods();
    void this.refreshReplays();
    footer.append(left, this.controlsBtn);
    this.root.append(topLeft, panel, footer);
    parent.append(this.root);
    window.addEventListener('keydown', (e) => this.onCaptureKey(e), true);

    const name = () => {
      const n = cleanName(this.nameIn.value) || randomName();
      this.nameIn.value = n;
      store(NAME_KEY, n);
      return n;
    };
    localBtn.addEventListener('click', () => this.h.local());
    hostBtn.addEventListener('click', () => this.h.host(name()));
    joinBtn.addEventListener('click', () => this.h.join(name(), codeIn.value.trim().toUpperCase()));
    codeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.h.join(name(), codeIn.value.trim().toUpperCase());
    });
    this.startBtn.addEventListener('click', () => {
      store(DELAY_KEY, this.delayIn.value);
      this.h.start(Number(this.delayIn.value));
    });
    this.leaveBtn.addEventListener('click', () => this.h.leave());
    for (const b of [localBtn, hostBtn, joinBtn]) b.disabled = true;
    this.enableWhenLoaded = () => {
      for (const b of [localBtn, hostBtn, joinBtn]) b.disabled = false;
    };
  }

  private enableWhenLoaded: () => void;
  private onlineRows: HTMLElement[];
  private offlineNote: HTMLParagraphElement;

  /** Replaces the host and join controls with a note, for builds without a room server. */
  disableOnline(): void {
    for (const r of this.onlineRows) r.hidden = true;
    this.offlineNote.hidden = false;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  loaded(): void {
    this.loading = false;
    this.enableWhenLoaded();
    this.setStatus('');
  }

  showMenu(): void {
    this.show('menu');
  }

  showRoom(code: string): void {
    this.codeOut.textContent = code;
    this.show('room');
  }

  private show(view: 'menu' | 'room' | 'controls' | 'mods' | 'replays'): void {
    if (view === 'menu' || view === 'room') this.backTo = view;
    if (this.padTimer) clearInterval(this.padTimer);
    this.padTimer = null;
    this.capture(-1);
    this.picked = -1;
    this.renderTouch();
    this.menu.hidden = view !== 'menu';
    this.room.hidden = view !== 'room';
    this.controlsView.hidden = view !== 'controls';
    this.modsView.hidden = view !== 'mods';
    this.replaysView.hidden = view !== 'replays';
    this.modsBtn.hidden = view !== 'menu';
    this.replaysBtn.hidden = view !== 'menu';
    this.leaveBtn.hidden = view !== 'room';
    this.hqBtn.hidden = view !== 'menu';
    this.touchBtn.hidden = view !== 'menu';
    this.controlsBtn.hidden = view === 'controls' || view === 'mods' || view === 'replays';
    this.root.classList.toggle('in-room', view !== 'menu');
  }

  private openReplays(): void {
    this.show('replays');
    void this.refreshReplays();
  }

  private async refreshReplays(): Promise<void> {
    const all = await listReplays();
    this.replaysBtn.replaceChildren('Replays', el('span', `lobby-option-state${all.length ? ' on' : ''}`, all.length ? String(all.length) : 'None'));
    this.replayList.replaceChildren(...all.map((m) => this.replayRow(m)));
    if (!all.length) this.replayList.append(el('li', 'lobby-note', 'No replays yet.'));
  }

  private replayRow(m: ReplayMeta): HTMLLIElement {
    const li = el('li', 'mod replay');
    const what = el('div', 'replay-what');
    const name = el('span', 'mod-name', replayName(m));
    what.title = replayAbout(m);
    what.append(name, el('span', 'replay-detail', replayDetail(m)));
    const rename = iconButton(Pencil, 'Rename');
    rename.addEventListener('click', () => this.rename(m, name));
    const watch = iconButton(Play, 'Watch');
    watch.addEventListener('click', () => this.h.watch(m.id));
    const del = iconButton(Trash2, 'Delete', 'mod-delete');
    del.addEventListener('click', () =>
      askDelete(
        li,
        name,
        'Delete this replay?',
        async () => {
          await deleteReplay(m.id);
          await this.refreshReplays();
        },
        () => li.replaceWith(this.replayRow(m)),
      ),
    );
    const save = iconButton(Download, 'Download');
    save.addEventListener('click', () => this.askDownload(m, li, name));
    li.append(what, rename, watch, save, del);
    return li;
  }

  /** Turns a replay's row into the download choices: a video or a replay file, and the video's quality. */
  private askDownload(m: ReplayMeta, li: HTMLLIElement, name: HTMLElement): void {
    const pick = loadExport();
    const keep = () => {
      try {
        localStorage.setItem(EXPORT_KEY, JSON.stringify(pick));
      } catch {
        // Storage may be blocked.
      }
    };
    const kinds = el('div', 'export-kind');
    const mp4 = el('button', 'lobby-option', 'MP4');
    const sfrp = el('button', 'lobby-option', 'SFRP');
    kinds.append(mp4, sfrp);
    const quality = el('select', 'export-quality');
    quality.title = 'Video quality';
    for (const q of Object.keys(VIDEO_QUALITIES)) quality.append(new Option(q, q));
    quality.value = pick.quality;
    const render = () => {
      mp4.classList.toggle('on', pick.kind === 'mp4');
      sfrp.classList.toggle('on', pick.kind === 'sfrp');
      quality.hidden = pick.kind !== 'mp4';
    };
    const choose = (kind: 'mp4' | 'sfrp') => () => {
      pick.kind = kind;
      keep();
      render();
    };
    mp4.addEventListener('click', choose('mp4'));
    sfrp.addEventListener('click', choose('sfrp'));
    quality.addEventListener('change', () => {
      pick.quality = quality.value as VideoQuality;
      keep();
    });
    const go = iconButton(Download, 'Download');
    go.addEventListener('click', async () => {
      li.replaceWith(this.replayRow(m));
      if (pick.kind === 'mp4') {
        this.h.recordVideo(m.id, pick.quality);
        return;
      }
      const file = await replayFile(m.id);
      if (file) downloadFile(file, `${fileName(replayName(m))}${REPLAY_FILE_TYPE}`);
    });
    const cancel = iconButton(X, 'Cancel');
    cancel.addEventListener('click', () => li.replaceWith(this.replayRow(m)));
    render();
    li.classList.add('choosing');
    li.replaceChildren(name, kinds, quality, go, cancel);
  }

  /** Puts a text box in place of a replay's name. Enter or leaving the box saves, Escape cancels, and an empty name brings back the fighters and stage. */
  private rename(m: ReplayMeta, name: HTMLElement): void {
    const box = el('input', 'replay-rename');
    box.maxLength = REPLAY_NAME_MAX;
    box.value = m.name ?? '';
    box.placeholder = replayTitle(m);
    let finished = false;
    const finish = async (save: boolean) => {
      if (finished) return;
      finished = true;
      if (save) await renameReplay(m.id, box.value.trim());
      await this.refreshReplays();
    };
    // The game's key handler takes Space and the arrow keys, so key presses stop at the box.
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void finish(true);
      else if (e.key === 'Escape') void finish(false);
    });
    box.addEventListener('blur', () => void finish(true));
    name.replaceWith(box);
    box.focus();
    box.select();
  }

  private openControls(): void {
    this.controlsTab = this.touchOn ? 'touch' : 'keys';
    this.renderControlsTab();
    this.show('controls');
    this.renderPads();
    this.padTimer = setInterval(() => this.renderPads(), 500);
  }

  /** Names the controllers the browser lists, so a player can tell whether theirs is seen at all. */
  private renderPads(): void {
    const all = listControllers();
    const used = all.filter((c) => c.used).map((c) => c.name);
    const other = all.filter((c) => !c.used).map((c) => c.name);
    let text = used.length ? `${used.length > 1 ? 'Controllers' : 'Controller'}: ${used.join(', ')}.` : 'No controller found. Connect one and press a button on it.';
    if (other.length) text += ` Not used: ${other.join(', ')}.`;
    if (this.padNote.textContent !== text) this.padNote.textContent = text;
  }

  private renderControlsTab(): void {
    const touch = this.touchOn && this.controlsTab === 'touch';
    this.controlsHeading.hidden = this.touchOn;
    this.controlsTabs.hidden = !this.touchOn;
    this.keysPart.hidden = touch;
    this.touchEdit.hidden = !touch;
    this.keysTabBtn.setAttribute('aria-pressed', String(!touch));
    this.touchTabBtn.setAttribute('aria-pressed', String(touch));
  }

  private closeControls(): void {
    this.show(this.backTo);
  }

  /** Starts waiting for a key for one button, or stops waiting when `i` is -1. */
  private capture(i: number): void {
    this.capturing = i;
    this.renderKeys();
  }

  private onCaptureKey(e: KeyboardEvent): void {
    if (this.capturing < 0 || this.root.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      this.capture(-1);
      return;
    }
    const name = browserKeyToName(e.key);
    if (!name) return;
    this.controls[this.capturing] = name;
    saveControls(this.controls);
    this.capture(-1);
  }

  /** Shows what loading the enabled mods did when the page started. */
  setModLoad(r: ModLoad): void {
    this.modLoad = r;
    void this.refreshMods();
  }

  private async refreshMods(extra: string[] = []): Promise<void> {
    this.mods = await listMods();
    const on = this.mods.filter((m) => m.enabled).length;
    this.modsBtn.replaceChildren('Mods', el('span', `lobby-option-state${on ? ' on' : ''}`, on ? String(on) : 'None'));
    this.modList.replaceChildren(
      ...this.mods.map((m) => {
        const li = el('li', 'mod');
        const toggle = el('button', 'lobby-option');
        renderOption(toggle, '', m.enabled);
        toggle.title = m.enabled ? 'Turn off' : 'Turn on';
        toggle.addEventListener('click', async () => {
          await setModEnabled(m.id, !m.enabled);
          this.modsChanged = true;
          await this.refreshMods();
        });
        const name = el('span', 'mod-name', m.name);
        const del = el('button', 'lobby-option mod-delete', 'Delete');
        del.addEventListener('click', () =>
          askDelete(
            li,
            name,
            'Delete this mod from this browser?',
            async () => {
              await deleteMod(m.id);
              this.modsChanged = true;
              await this.refreshMods();
            },
            () => void this.refreshMods(),
          ),
        );
        const loaded = this.modLoad.loaded.includes(m.name);
        let script: HTMLElement = el('span');
        if (m.hasScript) {
          const b = el('button', 'lobby-option');
          renderOption(b, 'Script', m.scriptAllowed);
          b.title = m.scriptAllowed ? 'Read or turn off the script' : 'Read the script before turning it on';
          b.addEventListener('click', () => void this.showScript(m));
          script = b;
        }
        li.append(name, script, el('span', 'mod-tag', m.enabled && !this.modsChanged && !loaded ? 'Failed' : ''), toggle, del);
        return li;
      }),
    );
    if (!this.mods.length) this.modList.append(el('li', 'lobby-note', 'No mods yet. Add a .sfrt character file exported from the mod maker.'));
    this.modProblems.replaceChildren(...[...this.modLoad.problems, ...extra].map((p) => el('li', '', p)));
    this.reloadBtn.hidden = !this.modsChanged;
  }

  /**
   * Shows a mod's script with a button to turn it on or off. Right after the mod is added (`asking`), it asks
   * whether to turn the script on and keeps the source folded. Resolves when the panel closes.
   */
  private async showScript(m: ModInfo, asking = false): Promise<void> {
    const source = (await modScript(m.id)) ?? '';
    const turn = el('button', m.scriptAllowed ? '' : 'primary', m.scriptAllowed ? 'Turn script off' : 'Turn script on');
    const close = el('button', '', asking ? 'Keep it off' : 'Close');
    const actions = el('div', 'lobby-actions');
    actions.append(turn, close);
    const code = el('pre', 'mod-code', source);
    let shown: HTMLElement = code;
    if (asking) {
      const fold = el('details', 'mod-code-fold');
      fold.append(el('summary', '', 'Show the script'), code);
      shown = fold;
    }
    this.scriptView.replaceChildren(
      el('div', 'lobby-heading', asking ? `Turn on ${m.name}'s script?` : `${m.name}'s script`),
      el('p', 'lobby-note', "The script adds this character's special rules. It runs walled off from the page: it can change fights but not this page, your saved data or other sites. Turn it on only if you trust where the mod came from."),
      shown,
      actions,
    );
    this.scriptView.hidden = false;
    this.scriptView.scrollIntoView({ block: 'nearest' });
    await new Promise<void>((done) => {
      turn.addEventListener('click', async () => {
        await setModScriptAllowed(m.id, !m.scriptAllowed);
        this.modsChanged = true;
        this.scriptView.hidden = true;
        await this.refreshMods();
        done();
      });
      close.addEventListener('click', () => {
        this.scriptView.hidden = true;
        done();
      });
    });
  }

  private setHq(on: boolean): void {
    this.hq = on;
    store(HQ_KEY, on ? '1' : '0');
    this.renderHq();
    this.h.hqPen(on);
  }

  private renderHq(): void {
    renderOption(this.hqBtn, 'High quality pen', this.hq);
  }

  /** Shows whether the touch controls are on. They decide that from the saved choice or the device. */
  setTouch(on: boolean): void {
    this.touchOn = on;
    renderOption(this.touchBtn, 'Touch controls', on);
    this.renderControlsTab();
  }

  /** Picks the first touch button of a swap, or swaps its action with the one picked before. */
  private pickTouch(i: number): void {
    if (this.picked < 0 || this.picked === i) {
      this.picked = this.picked === i ? -1 : i;
      this.renderTouch();
      return;
    }
    const next = [...this.touchButtons];
    [next[this.picked], next[i]] = [next[i], next[this.picked]];
    this.setTouchButtons(next);
  }

  private setTouchButtons(names: string[]): void {
    this.touchButtons = names;
    this.picked = -1;
    saveTouchButtons(names);
    this.h.touchButtons([...names]);
    this.renderTouch();
  }

  private renderTouch(): void {
    this.touchPicks.forEach((b, i) => {
      b.textContent = this.touchButtons[i];
      b.classList.toggle('picked', i === this.picked);
      b.setAttribute('aria-pressed', String(i === this.picked));
    });
  }

  private setPrefs(p: Prefs): void {
    this.prefs = p;
    savePrefs(p);
    this.h.prefs(p);
    this.renderKeys();
  }

  private renderKeys(): void {
    this.upJumpBtn.textContent = this.prefs.upJump ? 'On' : 'Off';
    this.comboBtn.textContent = this.prefs.combo;
    this.keyButtons.forEach((b, i) => {
      const label = i === this.capturing ? 'Press a key' : keyLabel(this.controls[i]);
      b.textContent = label;
      b.title = label;
      b.classList.toggle('capturing', i === this.capturing);
      b.classList.toggle('long', label.length > 6);
    });
  }

  updateSeats(seats: SeatInfo[], host: number, me: number, links: (seat: number) => LinkState): void {
    this.seatList.replaceChildren(
      ...[0, 1, 2, 3].map((i) => {
        const s = seats.find((x) => x.seat === i);
        const li = el('li', s ? 'seat' : 'seat seat-open');
        li.style.setProperty('--c', `var(--p${i + 1})`);
        const badge = el('img', 'seat-badge');
        badge.src = playerBadge(i);
        badge.alt = `P${i + 1}`;
        li.append(badge);
        if (!s) {
          li.append(el('span', 'seat-empty', 'Open'));
          return li;
        }
        li.append(el('span', 'seat-name', s.name));
        if (i === me) li.append(el('span', 'seat-tag', 'You'));
        if (i === host) li.append(el('span', 'seat-tag', 'Host'));
        const link = i === me ? '' : links(i);
        li.append(el('span', `seat-link ${link}`, !s.connected ? 'Away' : link === 'direct' ? 'Direct' : link === 'relay' ? 'Relayed' : i === me ? '' : 'Connecting'));
        return li;
      }),
    );
    this.countOut.textContent = `${seats.length}/4 players`;
    const isHost = host === me;
    this.startBtn.hidden = !isHost;
    this.delayIn.disabled = !isHost;
    this.waitNote.hidden = isHost;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Shows the start screen again after a game or a replay, on its menu or its Replays screen. */
  showStart(view: 'menu' | 'replays'): void {
    this.root.hidden = false;
    this.setStatus('');
    if (view === 'replays') this.openReplays();
    else this.show('menu');
  }
}

/** One status line above the stage during an online game. */
export class Hud {
  root: HTMLDivElement;
  private line: HTMLSpanElement;
  private warn: HTMLSpanElement;

  private button: HTMLButtonElement;
  private onAction: () => void = () => {};
  private wait: HTMLDivElement;
  private waitTitle: HTMLDivElement;
  private waitText: HTMLParagraphElement;
  private waitButton: HTMLButtonElement;
  private onWait: () => void = () => {};

  constructor(parent: HTMLElement, onLeave: () => void, stage?: HTMLElement) {
    this.root = el('div', 'hud');
    this.line = el('span', 'hud-line');
    this.warn = el('span', 'hud-warn');
    this.button = el('button', 'hud-action');
    this.button.hidden = true;
    this.button.addEventListener('click', () => this.onAction());
    const leave = el('button', 'hud-leave', 'Leave game');
    leave.addEventListener('click', onLeave);
    this.root.append(this.line, this.warn, this.button, leave);
    parent.append(this.root);
    this.wait = el('div', 'hud-wait');
    this.wait.hidden = true;
    this.waitTitle = el('div', 'lobby-heading');
    this.waitText = el('p', 'lobby-note');
    this.waitButton = el('button', 'primary');
    this.waitButton.addEventListener('click', () => this.onWait());
    this.wait.append(this.waitTitle, this.waitText, this.waitButton);
    (stage ?? parent).append(this.wait);
  }

  /** The panel over the stage while the game waits for a player, or nothing for a null title. */
  waiting(title: string | null, text = '', button: { label: string; onClick: () => void } | null = null): void {
    this.wait.hidden = title === null;
    if (title === null) return;
    if (this.waitTitle.textContent !== title) this.waitTitle.textContent = title;
    if (this.waitText.textContent !== text) this.waitText.textContent = text;
    this.waitButton.hidden = !button;
    if (button) {
      this.onWait = button.onClick;
      if (this.waitButton.textContent !== button.label) this.waitButton.textContent = button.label;
    }
  }

  update(text: string, warn: string): void {
    if (this.line.textContent !== text) this.line.textContent = text;
    if (this.warn.textContent !== warn) this.warn.textContent = warn;
  }

  action(label: string | null, onClick: () => void): void {
    this.onAction = onClick;
    this.button.hidden = label === null;
    if (label !== null && this.button.textContent !== label) this.button.textContent = label;
  }

  remove(): void {
    this.root.remove();
    this.wait.remove();
  }
}
