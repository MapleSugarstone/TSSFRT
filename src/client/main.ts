import './style.css';
import { Game, startFixedLoop } from './game.ts';
import { LocalInput } from './input.ts';
import { Hud, Lobby } from './lobby.ts';
import { loadMods } from './mods.ts';
import { OnlineGame } from './online.ts';
import { Mesh } from '../net/mesh.ts';
import { report } from '../net/report.ts';
import { applyToPlayerOne, loadControls, loadPrefs, seatKeys } from './controls.ts';
import { actionKeys, Pads } from './pads.ts';
import { TouchControls } from './touch.ts';
import type { Value } from '../engine/cast.ts';
import { hostRoom, joinRoom, onlineAvailable, RoomClient } from '../net/room-client.ts';
import type { PlayerInput } from '../engine/io.ts';
import type { SeatInfo, StartInfo } from '../net/protocol.ts';

const stageWrap = document.getElementById('stage-wrap')!;
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const page = document.getElementById('app')!;

/** Set once the touch controls exist; they call `fitStage` while being built. */
let touchUi: TouchControls | null = null;

function fitStage(): void {
  // In portrait the touch controls take the bottom of the screen and the stage sits above them.
  const portraitTouch = !!touchUi?.active && window.innerHeight > window.innerWidth;
  const touchMin = portraitTouch ? 220 : 0;
  document.documentElement.classList.toggle('touch-portrait', portraitTouch);
  const pad = portraitTouch ? 8 : 16;
  const hudSpace = 28;
  const w = Math.max(240, window.innerWidth - pad * 2);
  const h = Math.max(180, window.innerHeight - pad * 2 - hudSpace - touchMin);
  const scale = Math.min(w / 480, h / 360);
  const cssW = Math.floor(480 * scale);
  const cssH = Math.floor(360 * scale);
  // The controls get all the height left under the stage and its status line.
  const touchH = portraitTouch ? window.innerHeight - pad * 2 - hudSpace - cssH : 0;
  document.documentElement.style.setProperty('--touch-h', `${touchH}px`);
  stageWrap.style.width = `${cssW}px`;
  stageWrap.style.height = `${cssH}px`;
  document.documentElement.style.setProperty('--stage-w', `${cssW}px`);
  document.documentElement.style.setProperty('--stage-h', `${cssH}px`);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

/** Local time expressed in UTC fields, so the date blocks read the player's wall clock. */
function localT0(): number {
  const now = Date.now();
  return now - new Date(now).getTimezoneOffset() * 60_000;
}

fitStage();
window.addEventListener('resize', fitStage);

// Mods build into the game's tables, so they load before the first runtime exists.
const modLoad = await loadMods();

// One game object per page: assets load once while the menu shows, and the runtime is replaced
// when an online game starts with the shared seed.
const game = new Game(canvas, overlay, { seed: crypto.getRandomValues(new Uint32Array(1))[0], t0: localT0() });
const input = new LocalInput(stageWrap);
const pads = new Pads();
const touch = new TouchControls(page, pads, fitStage);
touchUi = touch;
fitStage();
game.question.onFocusChange = (f) => (input.enabled = !f);
const resumeAudio = () => game.audio.resume();
window.addEventListener('pointerdown', resumeAudio);
window.addEventListener('keydown', resumeAudio);
(window as unknown as { __game: Game }).__game = game;

let room: RoomClient | null = null;
let mesh: Mesh | null = null;
let online: OnlineGame | null = null;
// Closing the page says goodbye, so the others go on without this player instead of waiting.
window.addEventListener('pagehide', () => online?.leave());
let seats: SeatInfo[] = [];
let host = 0;
let code = '';

const lobby = new Lobby(overlay, {
  local() {
    lobby.hide();
    input.enabled = true;
    const g = game.rt.stage;
    applyToPlayerOne(g.l.Player_Input as Value[], g.l.Player_Settings as Value[], loadControls(), loadPrefs());
    touch.setPlaying(true);
    startFixedLoop(
      () => {
        const keys = new Set(input.sampleKeys());
        // Touch and controller slot n press the buttons of player n+1's row of the controls table.
        const table = game.rt.stage.l.Player_Input as Value[];
        pads.sample().forEach((acts, slot) => {
          for (const k of actionKeys(acts, seatKeys(table, slot))) keys.add(k);
        });
        const p0: PlayerInput = { keys: [...keys] };
        if (input.mouseDirty) {
          p0.mouse = { ...input.mouse };
          input.mouseDirty = false;
        }
        if (game.question.pendingAnswer !== undefined) {
          p0.answer = game.question.pendingAnswer;
          game.question.pendingAnswer = undefined;
        }
        game.step([p0]);
      },
      () => game.present(),
    );
  },
  async host(name) {
    lobby.setStatus('Opening a room...');
    const r = await hostRoom();
    if (!r.ok) {
      lobby.setStatus(r.reason);
      return;
    }
    code = r.code ?? '';
    connect(r.room, name);
  },
  async join(name, c) {
    if (!/^[A-Z0-9]{6}$/.test(c)) {
      lobby.setStatus('A room code is six letters and numbers.');
      return;
    }
    lobby.setStatus('Joining...');
    const r = await joinRoom(c);
    if (!r.ok) {
      lobby.setStatus(r.reason);
      return;
    }
    code = c;
    connect(r.room, name);
  },
  prefs(p) {
    if (room && !online) room.send({ type: 'prefs', prefs: p });
  },
  hqPen(on) {
    game.renderer.hqPen = on;
  },
  touchControls(on) {
    touch.setChoice(on);
  },
  start(delay) {
    // Every seat gets Player 1's row, so each player's own controls have a full row to map onto.
    room?.send({ type: 'start', t0: localT0(), delay, sameKeys: true });
  },
  leave() {
    online?.leave();
    mesh?.close();
    room?.close();
    room = null;
    mesh = null;
    lobby.showMenu();
    lobby.setStatus('');
  },
});
lobby.setModLoad(modLoad);
touch.onChange = (on) => lobby.setTouch(on);
// Every screen but a running match and the character select's free cursor is a menu.
touch.menuMode = () => {
  const g = game.rt.stage;
  const state = String(g.v.Main_State);
  if (state === 'Match') return Number((g.l.Paused_Data as Value[])[0]) === 1;
  return state !== 'MainMenu_CharacterSelect';
};
lobby.setTouch(touch.enabled);

function refreshSeats(): void {
  if (!room) return;
  lobby.updateSeats(seats, host, room.seat, (s) => mesh?.state(s) ?? 'connecting');
}

function connect(roomId: string, name: string): void {
  room = new RoomClient(roomId, name);
  room.onStatus = (s, why) => {
    if (s !== 'open') report('room-socket', { status: s, why, inGame: online !== null, ...(online?.diagnostics() ?? {}) });
    if (s === 'reconnecting') lobby.setStatus('Connection lost; reconnecting...');
    else if (s === 'closed' && !online) lobby.setStatus('Disconnected from the room.');
    else if (s === 'open') lobby.setStatus('');
  };
  room.onMessage = (m) => {
    switch (m.type) {
      case 'welcome':
        // A welcome also arrives after the room socket reconnects. The running game keeps its
        // links, so the mesh is only replaced when this player's seat changed.
        if (!mesh || mesh.local !== m.seat) {
          mesh?.close();
          mesh = new Mesh(room!, m.seat);
          mesh.onLinkChange = () => refreshSeats();
        }
        seats = m.seats;
        host = m.host;
        if (!m.start) room!.send({ type: 'prefs', prefs: loadPrefs() });
        lobby.showRoom(code);
        mesh.ensure(seats.map((s) => s.seat));
        refreshSeats();
        if (m.start && !online) begin(m.start);
        break;
      case 'seats':
        seats = m.seats;
        host = m.host;
        mesh?.ensure(seats.filter((s) => s.connected).map((s) => s.seat));
        refreshSeats();
        online?.seatsChanged(m.seats, m.host);
        break;
      case 'dropped':
        online?.onDropped(m.seat, m.frame, m.data);
        break;
      case 'signal':
        void mesh?.signal(m.from, m.data);
        break;
      case 'relay':
        mesh?.relayed(m.data);
        break;
      case 'go':
        begin(m.start);
        break;
      case 'refused':
        lobby.setStatus(m.reason);
        lobby.showMenu();
        break;
    }
  };
  room.connect();
}

function begin(start: StartInfo): void {
  if (!room || !mesh || online) return;
  if (!start.seats.includes(room.seat)) {
    lobby.setStatus('The game started without you.');
    return;
  }
  game.rt = Game.createRuntime({ seed: start.seed, t0: start.t0 });
  const names = new Map(seats.map((s) => [s.seat, s.name]));
  // Leaving reloads the page, which is the simplest way back to a clean menu.
  const hud = new Hud(
    page,
    () => {
      online?.leave();
      location.reload();
    },
    overlay,
  );
  online = new OnlineGame(game, room, mesh, start, room.seat, names, hud, host);
  (window as unknown as { __online: OnlineGame }).__online = online;
  lobby.hide();
  input.enabled = true;
  touch.setPlaying(true);
  online.run(input, pads);
}

if (!onlineAvailable()) lobby.disableOnline();

window.addEventListener('error', (e) => report('error', { message: e.message, at: `${e.filename}:${e.lineno}:${e.colno}`, stack: e.error?.stack, ...(online?.diagnostics() ?? {}) }));
window.addEventListener('unhandledrejection', (e) => report('error', { message: String(e.reason?.message ?? e.reason), stack: e.reason?.stack, ...(online?.diagnostics() ?? {}) }));

void game
  .load((t) => lobby.setStatus(t))
  .then(() => lobby.loaded())
  .catch((e) => lobby.setStatus(`Could not load the game: ${String(e)}`));
