// Plays a saved replay in place of the start screen: the match from its saved start state with its
// recorded inputs, with buttons to pause, step, change the speed, seek and exit.
// Seeking back loads the nearest state kept on the way (one every 2 seconds) and plays forward from it.
import { loadSnapshot, saveSnapshot, type Snapshot } from '../engine/snapshot.ts';
import { snapshotHash } from '../net/rollback.ts';
import { startFixedLoop, type Game } from './game.ts';
import { clock, replayFrames, replayName, type ReplayBody, type ReplayMeta } from './replay.ts';

export interface ReplayViewerOptions {
  /** The game, with a fresh runtime made with the replay's `t0`. */
  game: Game;
  meta: ReplayMeta;
  body: ReplayBody;
  /** Why it may not play the same, if it may not. The replay then starts paused. */
  warning: string;
  page: HTMLElement;
  stage: HTMLElement;
  /** The player chose Exit. */
  onExit: () => void;
}

const KEEP_EVERY = 60;
const SPEEDS = [0.25, 0.5, 1, 2, 4];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A button that never takes keyboard focus, so Space and the arrow keys keep working. */
function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', undefined, text);
  b.title = title;
  b.tabIndex = -1;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

/** Starts the replay. Returns a function that stops it and takes its controls off the page. */
export function runReplayViewer(o: ReplayViewerOptions): () => void {
  const { game, body } = o;
  const pageTitle = document.title;
  const bar = el('div', 'hud test-bar replay-bar');
  const exit = button('Exit', 'Back to the Replays screen (Escape)', () => o.onExit());
  exit.classList.add('hud-leave');
  const note = el('div', 'replay-note');
  note.hidden = true;
  o.stage.append(note);
  o.page.prepend(bar);
  const tell = (text: string) => {
    note.textContent = text;
    note.hidden = false;
  };
  let stopLoop = () => {};
  let ready = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') exit.click();
    else if (!ready || !controls(e.key)) return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  const stop = () => {
    stopLoop();
    window.removeEventListener('keydown', onKey);
    bar.remove();
    note.remove();
    document.title = pageTitle;
  };

  const rt = () => game.rt;
  try {
    loadSnapshot(rt(), body.start);
  } catch {
    bar.append(el('span', 'hud-line', `Replay: ${replayName(o.meta)}`), exit);
    tell('This replay cannot play in this version of the game.');
    return stop;
  }
  rt().io.netMode = body.net;

  const frames = replayFrames(body);
  const total = frames.length;
  const checks = new Map(body.checks);
  const kept = new Map<number, Snapshot>([[0, body.start]]);
  let at = 0;
  let paused = false;
  let speed = 2;
  let carry = 0;
  let mismatch = false;

  /** Plays the next recorded frame. */
  function advance(): void {
    game.step(frames[at]);
    at++;
    if (at % KEEP_EVERY === 0 && !kept.has(at)) kept.set(at, saveSnapshot(rt()));
    const want = checks.get(at);
    if (want !== undefined && !mismatch && snapshotHash(saveSnapshot(rt())) !== want) {
      mismatch = true;
      tell(`From ${clock(at)} on, this replay no longer plays the same as the match did.`);
    }
  }

  /** Jumps to frame `n` without sound, from the nearest kept state at or before it. */
  function seek(n: number): void {
    n = Math.max(0, Math.min(total, n));
    if (n < at || n - at > KEEP_EVERY) {
      let from = 0;
      for (const f of kept.keys()) if (f <= n && f > from) from = f;
      if (from > at || n < at) {
        loadSnapshot(rt(), kept.get(from)!);
        at = from;
      }
    }
    while (at < n) advance();
    rt().soundEvents.length = 0;
    game.audio.stopAll();
    carry = 0;
    if (!mismatch) note.hidden = true;
    draw();
  }

  const time = el('span', 'test-frame');
  const pause = button('Pause', 'Stop the replay, or play it again (Space)', () => setPaused(!paused));
  const back = button('Back', 'One frame back (Left arrow)', () => {
    setPaused(true);
    seek(at - 1);
  });
  const step = button('Step', 'One frame forward (Right arrow)', () => {
    setPaused(true);
    if (at < total) advance();
    draw();
  });
  const rate = button('1x', 'Playback speed', () => {
    speed = (speed + 1) % SPEEDS.length;
    update();
  });
  const seekBar = el('input', 'replay-seek');
  seekBar.type = 'range';
  seekBar.min = '0';
  seekBar.max = String(total);
  seekBar.tabIndex = -1;
  seekBar.title = 'Drag to move through the match';
  seekBar.addEventListener('input', () => seek(Number(seekBar.value)));
  document.title = `Replay: ${replayName(o.meta)}`;
  bar.append(time, seekBar, pause, back, step, rate, exit);

  /** Space, Left and Right control the replay. Returns whether the key was one of them. */
  function controls(key: string): boolean {
    if (key === ' ') setPaused(!paused);
    else if (key === 'ArrowLeft') back.click();
    else if (key === 'ArrowRight') step.click();
    else return false;
    return true;
  }

  function setPaused(p: boolean): void {
    paused = p;
    if (!p && at >= total) seek(0);
    if (!p && !mismatch) note.hidden = true;
    update();
  }
  function update(): void {
    time.textContent = `${clock(at)} / ${clock(total)}`;
    pause.textContent = paused ? 'Play' : 'Pause';
    rate.textContent = `${SPEEDS[speed]}x`;
    if (seekBar.value !== String(at)) seekBar.value = String(at);
    bar.classList.toggle('paused', paused);
  }
  /** Draws the current frame without playing its sounds again. */
  function draw(): void {
    rt().soundEvents.length = 0;
    game.renderer.render(rt());
    update();
  }

  stopLoop = startFixedLoop(
    () => {
      if (paused) return;
      carry += SPEEDS[speed];
      while (carry >= 1 && at < total) {
        advance();
        carry--;
      }
      if (at >= total) {
        paused = true;
        if (!mismatch) tell('End of the replay. Play starts over.');
      }
    },
    () => {
      if (paused) draw();
      else {
        game.present();
        update();
      }
    },
  );
  if (o.warning) {
    paused = true;
    tell(o.warning);
  }
  ready = true;
  update();
  game.present();
  return stop;
}
