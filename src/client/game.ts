// Owns one simulation plus everything that presents it: renderer, audio and overlays.
import { Runtime, FRAME_MS } from '../engine/runtime.ts';
import type { PlayerInput } from '../engine/io.ts';
import { modules, monitors } from '../game/generated/index.ts';
import { skins } from '../game/assets.ts';
import { installPacks, registerPackCharacters } from '../game/packs.ts';
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
  /** Leave out the character packs, for comparisons with the original. */
  noPacks?: boolean;
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
    if (!opts.noPacks) installPacks();
    const rt = new Runtime(modules, skins, { seed: opts.seed, t0: opts.t0 });
    if (!opts.noPacks) registerPackCharacters(rt);
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
    this.audio.sync(this.rt.currentMSecs);
    this.renderer.render(this.rt);
    this.question.update(this.rt);
    this.lists.update(this.rt);
  }
}

/**
 * Frame scheduler run in a worker: one message per frame, due every FRAME_MS, posted with its due
 * time. Due times advance by exactly FRAME_MS, so timer lateness never accumulates into drift.
 */
const PACER = `
const step = ${FRAME_MS};
const clock = () => performance.timeOrigin + performance.now();
let next = clock() + step;
const loop = () => {
  const now = clock();
  if (now - next > 250) next = now;
  while (now >= next) {
    postMessage(next);
    next += step;
  }
  setTimeout(loop, Math.max(0, Math.min(4, next - now)));
};
setTimeout(loop, 4);
`;

/**
 * Calls `tick` then `after` once per frame, every FRAME_MS like the original. A worker drives the
 * timing because animation frames stop and page timers slow down in background tabs, and an
 * online match must keep running there.
 */
export function startFixedLoop(tick: () => void, after: () => void): () => void {
  const worker = new Worker(URL.createObjectURL(new Blob([PACER], { type: 'text/javascript' })));
  worker.onmessage = (e: MessageEvent<number>) => {
    // Frames that waited behind a long main-thread stall are dropped rather than played back at once.
    if (performance.timeOrigin + performance.now() - e.data > 200) return;
    tick();
    after();
  };
  return () => worker.terminate();
}
