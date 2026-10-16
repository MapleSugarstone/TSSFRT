// The screen shown before the game starts: play on this computer, or host or join an online room.
import type { SeatInfo } from '../net/protocol.ts';
import type { LinkState } from '../net/mesh.ts';
import { browserKeyToName } from '../engine/io.ts';
import { DEFAULT_PREFS, type Prefs } from '../net/protocol.ts';
import { ACTIONS, DEFAULT_CONTROLS, loadControls, loadPrefs, saveControls, savePrefs } from './controls.ts';
import { installUiAssets, playerBadge } from './ui-assets.ts';

const NAME_KEY = 'sfrt.name';
const DELAY_KEY = 'sfrt.delay';
const HQ_KEY = 'sfrt.hqpen';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A key name as a button shows it: "space" becomes "Space", "up arrow" becomes "Up arrow". */
function keyLabel(name: string): string {
  return name ? name[0].toUpperCase() + name.slice(1) : 'None';
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
  private hqBtn: HTMLButtonElement;
  private hq = load(HQ_KEY, '1') === '1';
  private leaveBtn: HTMLButtonElement;
  private keyButtons: HTMLButtonElement[] = [];
  private controls = loadControls();
  private prefs = loadPrefs();
  private upJumpBtn!: HTMLButtonElement;
  private comboBtn!: HTMLButtonElement;
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
    this.nameIn.maxLength = 16;
    this.nameIn.value = load(NAME_KEY, `Player${Math.floor(Math.random() * 900 + 100)}`);
    nameRow.append(this.nameIn);
    const localBtn = el('button', 'primary', 'Play on this computer');
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
    const actions = el('div', 'lobby-actions');
    const resetBtn = el('button', '', 'Reset to default');
    const backBtn = el('button', 'primary', 'Done');
    actions.append(resetBtn, backBtn);
    this.controlsView.append(
      el('div', 'lobby-heading', 'Your controls'),
      el('p', 'lobby-note', 'Online, these keys control your player in any seat. Other players can use the same keys.'),
      grid,
      options,
      actions,
    );
    resetBtn.addEventListener('click', () => {
      this.controls = [...DEFAULT_CONTROLS];
      saveControls(this.controls);
      this.setPrefs({ ...DEFAULT_PREFS });
      this.capture(-1);
    });
    backBtn.addEventListener('click', () => this.closeControls());
    this.renderKeys();

    this.status = el('div', 'lobby-status');
    this.leaveBtn = el('button', 'lobby-return', 'Leave');
    this.leaveBtn.hidden = true;
    this.controlsBtn = el('button', 'lobby-corner', 'Controls');
    this.controlsBtn.addEventListener('click', () => this.openControls());
    this.hqBtn = el('button', 'lobby-option');
    this.hqBtn.addEventListener('click', () => this.setHq(!this.hq));
    this.renderHq();
    this.h.hqPen(this.hq);
    panel.append(this.menu, this.room, this.controlsView, this.status);
    this.root.append(panel, this.leaveBtn, this.hqBtn, this.controlsBtn);
    parent.append(this.root);
    window.addEventListener('keydown', (e) => this.onCaptureKey(e), true);

    const name = () => {
      const n = this.nameIn.value.trim() || 'Player';
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

  private show(view: 'menu' | 'room' | 'controls'): void {
    if (view !== 'controls') this.backTo = view;
    this.capture(-1);
    this.menu.hidden = view !== 'menu';
    this.room.hidden = view !== 'room';
    this.controlsView.hidden = view !== 'controls';
    this.leaveBtn.hidden = view !== 'room';
    this.hqBtn.hidden = view !== 'menu';
    this.controlsBtn.hidden = view === 'controls';
    this.root.classList.toggle('in-room', view !== 'menu');
  }

  private openControls(): void {
    this.show('controls');
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

  private setHq(on: boolean): void {
    this.hq = on;
    store(HQ_KEY, on ? '1' : '0');
    this.renderHq();
    this.h.hqPen(on);
  }

  private renderHq(): void {
    const state = el('span', `lobby-option-state${this.hq ? ' on' : ''}`, this.hq ? 'On' : 'Off');
    this.hqBtn.replaceChildren('High quality pen', state);
    this.hqBtn.setAttribute('aria-pressed', String(this.hq));
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
}

/** One status line above the stage during an online game. */
export class Hud {
  root: HTMLDivElement;
  private line: HTMLSpanElement;
  private warn: HTMLSpanElement;

  private button: HTMLButtonElement;
  private onAction: () => void = () => {};

  constructor(parent: HTMLElement, onLeave: () => void) {
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
  }
}
