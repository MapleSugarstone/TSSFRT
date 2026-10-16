// Owns one simulation plus everything that presents it: renderer, audio and overlays.
import { Runtime, FRAME_MS } from '../engine/runtime.ts';
import type { PlayerInput } from '../engine/io.ts';
import { modules, monitors } from '../game/generated/index.ts';
import { skins } from '../game/assets.ts';
import { installSilhouettes, type SilhouetteData } from '../game/silhouettes.ts';
import silhouetteData from '../game/silhouettes-data.json';
import { WebGLRenderer } from '../render/webgl.ts';
import { AudioOut } from './audio.ts';
import { ListMonitors, QuestionBox } from './overlays.ts';

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

export interface GameOptions {
  seed: number;
  /** Simulation start time; also drives the date blocks. */
  t0: number;
}

export class Game {
  rt: Runtime;
  renderer: WebGLRenderer;
  audio: AudioOut;
  question: QuestionBox;
  lists: ListMonitors;

  constructor(
    public canvas: HTMLCanvasElement,
    public overlay: HTMLElement,
    opts: GameOptions,
    audio?: AudioOut,
    renderer?: WebGLRenderer,
  ) {
    this.rt = Game.createRuntime(opts);
    this.renderer = renderer ?? new WebGLRenderer(canvas, skins);
    this.audio = audio ?? new AudioOut();
    this.question = new QuestionBox(overlay);
    this.lists = new ListMonitors(overlay, monitors);
  }

  static createRuntime(opts: GameOptions): Runtime {
    const rt = new Runtime(modules, skins, { seed: opts.seed, t0: opts.t0 });
    installSilhouettes(rt, silhouetteData as unknown as SilhouetteData);
    for (const m of monitors.lists) rt.monitorVisible[m.prop] = m.visible;
    rt.greenFlag();
    return rt;
  }

  async load(onProgress: (text: string) => void): Promise<void> {
    await Promise.all([
      this.renderer.loadImages(ASSET_BASE, (d, n) => onProgress(`Loading images ${d}/${n}`)),
      this.audio.load(this.rt, ASSET_BASE, (d, n) => onProgress(`Loading sounds ${d}/${n}`)),
    ]);
  }

  step(inputs: PlayerInput[]): void {
    this.rt.stepFrame(inputs);
  }

  present(): void {
    this.audio.apply(this.rt.soundEvents);
    this.renderer.render(this.rt);
    this.question.update(this.rt);
    this.lists.update(this.rt);
  }
}

/**
 * Calls `tick` at 30 Hz and `after` once following each batch of ticks. A worker drives the
 * timing because animation frames stop and page timers slow down in background tabs, and an
 * online match must keep running there.
 */
export function startFixedLoop(tick: () => void, after: () => void): () => void {
  const src = 'setInterval(() => postMessage(0), 4);';
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  let acc = 0;
  let last = performance.now();
  worker.onmessage = () => {
    const now = performance.now();
    acc += Math.min(now - last, 250);
    last = now;
    let steps = 0;
    while (acc >= FRAME_MS && steps < 5) {
      tick();
      acc -= FRAME_MS;
      steps++;
    }
    if (steps === 5) acc = 0;
    if (steps > 0) after();
  };
  return () => worker.terminate();
}
