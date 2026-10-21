// The mod maker's test scene, the game page opened with ?test: the character being made in Training mode
// against a standing dummy, with buttons to pause, play one frame at a time, reset to the start and exit,
// and a panel with what the character's script reports.
import type { Value } from '../engine/cast.ts';
import type { PlayerInput } from '../engine/io.ts';
import { loadSnapshot, saveSnapshot } from '../engine/snapshot.ts';
import { onScriptMessage, type ScriptMessage } from '../game/script-messages.ts';
import { startFixedLoop, type Game } from './game.ts';

export interface TestSceneOptions {
  game: Game;
  /** The character being tested, or null when it did not load. */
  character: number | null;
  name: string;
  /** Problems that kept the character or its script from loading, and pack warnings. */
  problems: string[];
  warnings: string[];
  /** The local player's input for one frame. */
  sample: () => PlayerInput;
  /** Gives player 1 the player's own controls, after the menus are passed with the default keys. */
  applyControls: () => void;
  onStart: () => void;
  page: HTMLElement;
  stage: HTMLElement;
}

const MOD_MAKER = './mod-maker.html';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A button that never takes keyboard focus, so Space and Enter keep reaching the game. */
function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', undefined, text);
  b.title = title;
  b.tabIndex = -1;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Walks the menus with the default keys, as a player would: title, Training, the first stage, the
 * character, and Fight. Returns once the match has started and both fighters stand on the ground.
 */
function enterTraining(game: Game, character: number): void {
  const G = game.rt.stage;
  const L = G.l as Record<string, Value[]>;
  const state = () => String(G.v.Main_State);
  const step = (keys: string[], frames: number) => {
    for (let i = 0; i < frames; i++) game.step([{ keys }]);
  };
  // Presses a key for a few frames, then waits, until the screen changes. Menus ignore keys while they animate in.
  const pressUntil = (key: string, what: string, ok: () => boolean) => {
    for (let i = 0; i < 40 && !ok(); i++) {
      step([key], 4);
      for (let j = 0; j < 26 && !ok(); j++) step([], 1);
    }
    if (!ok()) throw new Error(`the menus did not reach ${what}`);
  };
  for (let i = 0; i < 1200 && state() !== 'TitleScreen'; i++) step([], 1);
  pressUntil('space', 'the main menu', () => state() === 'Match' || state() === 'MainMenu_ModeSelect');
  // A new page starts the tutorial, and its pause menu leads to the main menu.
  if (state() === 'Match') pressUntil('P', 'the main menu', () => state() === 'MainMenu_ModeSelect');
  pressUntil('V', 'the stage select', () => state() === 'MainMenu_StageSelect');
  pressUntil('V', 'the character select', () => state() === 'MainMenu_CharacterSelect');
  step([], 30);
  // The cursor picks the character it is over. The roster's layout depends on how many characters there are.
  const hovered = () => String(L.Menu_CharacterSelect_Data?.[0] ?? '').split("'")[0] === String(character);
  const n = (L.CharData_SP_FC_JH_Fall_JA_AirSP_hitwidth_hitheight ?? []).length;
  const size = n > 8 ? 20 : 30;
  const k = character;
  const guess: [number, number] = n > 8 && k > 13 ? [-0.8 * size * n + 1.6 * size * (k - 14), 95] : [-0.8 * size * n + 1.6 * size * (k - 1), n > 8 ? 130 : 110];
  const spots: [number, number][] = [guess];
  for (const y of [110, 130, 95]) for (let x = -236; x <= 236; x += 6) spots.push([x, y]);
  let found = false;
  for (const [x, y] of spots) {
    L.Menu_CharSelect_CursorData[0] = `${Math.round(x)}'${y}'`;
    step([], 3);
    if ((found = hovered())) break;
  }
  if (!found) throw new Error('the character is not on the character select');
  pressUntil('V', 'the character', () => String(L.Menu_CharacterSelect_Confirms?.[0]) === '1');
  step([], 30);
  // The Fight button.
  L.Menu_CharSelect_CursorData[0] = "3'-160'";
  step([], 20);
  pressUntil('V', 'the match', () => state() === 'Match' && String(L.CHARACTERS?.[0]) === String(character));
  const grounded = (i: number) => Number(L.Collision_Players_Plat_Num?.[i] ?? 0) > 0;
  for (let i = 0; i < 300 && !(grounded(0) && grounded(1)); i++) step([], 1);
}

export function runTestScene(o: TestSceneOptions): void {
  const { game } = o;
  let paused = false;
  let start: ReturnType<typeof saveSnapshot> | null = null;
  let startFrame = 0;

  // The bar above the stage.
  const bar = el('div', 'hud test-bar');
  const title = el('span', 'hud-line', `Testing ${o.name}`);
  const frame = el('span', 'test-frame');
  const pause = button('Pause', 'Stop the game, or start it again', () => setPaused(!paused));
  const stepOne = button('Step', 'Play one frame with the keys you hold now', () => {
    setPaused(true);
    playFrame();
    game.present();
    update();
  });
  const reset = button('Reset', 'Go back to the start of the test', () => {
    if (!start) return;
    loadSnapshot(game.rt, start);
    game.rt.soundEvents.length = 0;
    game.audio.resync(game.rt);
    o.sample();
    note({ level: 'log', character: '', text: 'Reset to the start.' });
    draw();
    update();
  });
  const toggle = button('Messages', 'Script errors, console messages and problems with the character', () => (panel.hidden = !panel.hidden));
  const exit = button('Exit', 'Close the test and go back to the mod maker', () => {
    if (window.opener) window.close();
    setTimeout(() => (location.href = MOD_MAKER), 100);
  });
  exit.classList.add('hud-leave');
  bar.append(title, frame, pause, stepOne, reset, toggle, exit);
  o.page.prepend(bar);

  // The message panel over the stage.
  const panel = el('div', 'test-panel');
  panel.hidden = true;
  const head = el('div', 'test-panel-head', 'Messages');
  const clear = button('Clear', 'Remove every message', () => {
    list.replaceChildren();
    count = 0;
    update();
  });
  const close = button('Close', 'Hide the messages', () => (panel.hidden = true));
  head.append(clear, close);
  const list = el('ol', 'test-messages');
  panel.append(head, list);
  o.stage.append(panel);

  let count = 0;
  let last: { key: string; li: HTMLLIElement; times: number } | null = null;
  function note(m: ScriptMessage): void {
    const at = start ? game.rt.frame - startFrame : 0;
    const key = `${m.level}|${m.event ?? ''}|${m.text}`;
    // The same message every frame shows once, with a count.
    if (last && last.key === key && list.lastElementChild === last.li) {
      last.times++;
      last.li.querySelector('.test-times')!.textContent = `×${last.times}`;
      return;
    }
    const li = el('li', `test-${m.level}`);
    li.append(el('span', 'test-at', start ? `frame ${at}` : 'before start'), el('span', 'test-what', m.event ? `${m.event}: ${m.text}` : m.text), el('span', 'test-times'));
    list.append(li);
    last = { key, li, times: 1 };
    if (m.level !== 'log') count++;
    // The first error opens the panel and pauses, so it is easy to see what happened.
    if (m.level === 'error' && panel.hidden && start) {
      panel.hidden = false;
      setPaused(true);
    }
    list.scrollTop = list.scrollHeight;
    update();
  }
  onScriptMessage(note);
  for (const p of o.problems) note({ level: 'error', character: '', text: p });
  for (const w of o.warnings) note({ level: 'warn', character: '', text: w });

  function update(): void {
    frame.textContent = start ? `Frame ${game.rt.frame - startFrame}` : '';
    pause.textContent = paused ? 'Play' : 'Pause';
    toggle.textContent = count ? `Messages (${count})` : 'Messages';
    bar.classList.toggle('paused', paused);
  }
  function setPaused(p: boolean): void {
    paused = p;
    update();
  }
  /** Draws the current frame without playing its sounds again. */
  function draw(): void {
    game.renderer.render(game.rt);
  }
  function playFrame(): void {
    game.step([o.sample()]);
  }

  if (o.character === null) {
    panel.hidden = false;
    note({ level: 'error', character: '', text: 'There is no character to test. Open one in the mod maker and choose Test.' });
    for (const b of [pause, stepOne, reset]) b.disabled = true;
    return;
  }
  try {
    enterTraining(game, o.character);
  } catch (e) {
    panel.hidden = false;
    note({ level: 'error', character: '', text: `The test could not start: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  o.applyControls();
  game.rt.soundEvents.length = 0;
  start = saveSnapshot(game.rt);
  startFrame = game.rt.frame;
  if (o.problems.length) panel.hidden = false;
  o.onStart();
  update();
  startFixedLoop(
    () => {
      if (!paused) playFrame();
    },
    () => {
      if (paused) draw();
      else game.present();
      update();
    },
  );
  game.present();
}
