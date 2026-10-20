// Plays the simulation's sound events through Web Audio. Long sounds (the music) are kept on the
// simulation's clock, so a track ends exactly when the game's "play until done" thinks it does
// and loops without a gap or a cut, even when an online game waits or skips frames.
import type { SoundEvent } from '../engine/sound-model.ts';
import type { Runtime } from '../engine/runtime.ts';

const FADE_S = 0.025;
/** Sounds at least this long follow the simulation clock. */
const FOLLOW_MIN_S = 4;
/** Drift under this is timing noise and is left alone. */
const DEADBAND_S = 0.03;
/** Drift over this is fixed by seeking rather than by playing slightly faster or slower. */
const SEEK_S = 0.35;
/** Playback rate change per second of drift, and the largest change (1% is about a sixth of a semitone). */
const RATE_GAIN = 0.1;
const RATE_MAX = 0.01;
/** Presents in a row without the simulation advancing before following sounds pause. */
const HOLD_AFTER = 3;

interface Voice {
  buffer: AudioBuffer;
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  serial: number;
  volume: number;
  follow: boolean;
  /** Rate the simulation asked for. */
  rate: number;
  /** Buffer position in seconds at simulation time `simAt` (ms). */
  simPos: number;
  simAt: number;
  /** Buffer position in seconds at audio time `realAt`, and the rate actually playing. */
  realPos: number;
  realAt: number;
  playRate: number;
  held: boolean;
}

export class AudioOut {
  ctx: AudioContext;
  private master: GainNode;
  private buffers: (AudioBuffer | null)[][] = [];
  private voices = new Map<string, Voice>();
  private lastSim = -1;
  private still = 0;
  muted = false;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  async load(rt: Runtime, base: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const all = rt.sprites.flatMap((s, si) => s.sounds.map((d, i) => ({ si, i, file: d.file })));
    let done = 0;
    this.buffers = rt.sprites.map((s) => s.sounds.map(() => null));
    const queue = [...all];
    const worker = async () => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        try {
          // Mods give full URLs, and everything else a path under the assets folder.
          const res = await fetch(/^(blob|data|https?):/.test(job.file) ? job.file : `${base}${job.file}`);
          const data = await res.arrayBuffer();
          this.buffers[job.si][job.i] = await this.ctx.decodeAudioData(data);
        } catch {
          this.buffers[job.si][job.i] = null;
        }
        onProgress?.(++done, all.length);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.master.gain.value = v;
  }

  private tap: MediaStreamAudioDestinationNode | null = null;

  /** Everything the game plays, as a new stream, for recording a video. `endCapture` stops feeding it. */
  capture(): MediaStream {
    this.endCapture();
    this.tap = this.ctx.createMediaStreamDestination();
    this.master.connect(this.tap);
    return this.tap.stream;
  }

  endCapture(): void {
    if (this.tap) this.master.disconnect(this.tap);
    this.tap = null;
  }

  /** Applies queued events and empties the queue. */
  apply(events: SoundEvent[]): void {
    for (const e of events) this.handle(e);
    events.length = 0;
  }

  /** Keeps following sounds on the simulation clock. Call once per presented frame with the simulation time. */
  sync(simMs: number): void {
    const now = this.ctx.currentTime;
    this.still = simMs === this.lastSim ? this.still + 1 : 0;
    this.lastSim = simMs;
    for (const v of this.voices.values()) {
      if (!v.follow) continue;
      if (this.still >= HOLD_AFTER) {
        // The game is waiting (for another player, usually), so the music waits too.
        if (!v.held) this.hold(v, now);
        continue;
      }
      const want = expected(v, simMs);
      if (want >= v.buffer.duration) continue;
      if (v.held) {
        this.restart(v, want, now);
        continue;
      }
      const drift = actual(v, now) - want;
      if (Math.abs(drift) > SEEK_S) this.restart(v, want, now);
      else {
        const factor = Math.abs(drift) < DEADBAND_S ? 1 : 1 - Math.max(-RATE_MAX, Math.min(RATE_MAX, drift * RATE_GAIN));
        setPlayRate(v, v.rate * factor, now);
      }
    }
  }

  private handle(e: SoundEvent): void {
    const key = `${e.sprite}:${e.sound}`;
    const now = this.ctx.currentTime;
    if (e.kind === 'play') {
      this.fadeOut(key, now);
      const buffer = this.buffers[e.sprite]?.[e.sound];
      if (!buffer || this.muted) return;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = (e.pan ?? 0) / 100;
      pan.connect(this.master);
      const v: Voice = {
        buffer,
        src: null as unknown as AudioBufferSourceNode,
        gain: null as unknown as GainNode,
        pan,
        serial: e.serial,
        volume: e.volume / 100,
        follow: buffer.duration >= FOLLOW_MIN_S,
        rate: e.rate,
        simPos: 0,
        simAt: e.at,
        realPos: 0,
        realAt: now,
        playRate: e.rate,
        held: false,
      };
      this.startSource(v, 0, now, false);
      this.voices.set(key, v);
    } else if (e.kind === 'stop') {
      const v = this.voices.get(key);
      if (v && v.serial === e.serial) this.fadeOut(key, now);
    } else {
      const v = this.voices.get(key);
      if (!v) return;
      v.simPos = expected(v, e.at);
      v.simAt = e.at;
      v.rate = e.rate;
      setPlayRate(v, e.rate, now);
      v.volume = e.volume / 100;
      if (!v.held) v.gain.gain.value = v.volume;
      v.pan.pan.value = (e.pan ?? 0) / 100;
    }
  }

  /** Starts the voice's buffer at `offset` seconds through a fresh source and gain. */
  private startSource(v: Voice, offset: number, now: number, fadeIn: boolean): void {
    const src = this.ctx.createBufferSource();
    src.buffer = v.buffer;
    src.playbackRate.value = v.rate;
    const gain = this.ctx.createGain();
    if (fadeIn) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(v.volume, now + FADE_S);
    } else gain.gain.value = v.volume;
    src.connect(gain).connect(v.pan);
    src.start(now, offset);
    src.onended = () => {
      for (const [k, x] of this.voices) if (x === v && x.src === src && !x.held) this.voices.delete(k);
    };
    v.src = src;
    v.gain = gain;
    v.realPos = offset;
    v.realAt = now;
    v.playRate = v.rate;
  }

  private restart(v: Voice, offset: number, now: number): void {
    const old = { src: v.src, gain: v.gain };
    v.held = false;
    this.startSource(v, offset, now, true);
    fade(old.src, old.gain, now);
  }

  private hold(v: Voice, now: number): void {
    v.held = true;
    fade(v.src, v.gain, now);
  }

  private fadeOut(key: string, now: number): void {
    const v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    fade(v.src, v.gain, now);
  }

  /** Fades out one sound, used when a correction removes a sound that already started. */
  stopSound(sprite: number, sound: number): void {
    this.fadeOut(`${sprite}:${sound}`, this.ctx.currentTime);
  }

  /** Stops every voice, used when a rollback replaces the timeline. */
  stopAll(): void {
    const now = this.ctx.currentTime;
    for (const key of [...this.voices.keys()]) this.fadeOut(key, now);
  }
}

function expected(v: Voice, simMs: number): number {
  return v.simPos + ((simMs - v.simAt) / 1000) * v.rate;
}

function actual(v: Voice, now: number): number {
  return v.realPos + (now - v.realAt) * v.playRate;
}

function setPlayRate(v: Voice, rate: number, now: number): void {
  if (Math.abs(rate - v.playRate) < 1e-5) return;
  v.realPos = actual(v, now);
  v.realAt = now;
  v.playRate = rate;
  v.src.playbackRate.value = rate;
}

function fade(src: AudioBufferSourceNode, gain: GainNode, now: number): void {
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + FADE_S);
  try {
    src.stop(now + FADE_S);
  } catch {
    // already stopped
  }
}
