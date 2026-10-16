// Plays the simulation's sound events through Web Audio.
import type { SoundEvent } from '../engine/sound-model.ts';
import type { Runtime } from '../engine/runtime.ts';

const FADE_S = 0.025;

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  serial: number;
}

export class AudioOut {
  ctx: AudioContext;
  private master: GainNode;
  private buffers: (AudioBuffer | null)[][] = [];
  private voices = new Map<string, Voice>();
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
          const res = await fetch(`${base}${job.file}`);
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

  /** Applies queued events and empties the queue. */
  apply(events: SoundEvent[]): void {
    for (const e of events) this.handle(e);
    events.length = 0;
  }

  private handle(e: SoundEvent): void {
    const key = `${e.sprite}:${e.sound}`;
    const now = this.ctx.currentTime;
    if (e.kind === 'play') {
      this.fadeOut(key, now);
      const buffer = this.buffers[e.sprite]?.[e.sound];
      if (!buffer || this.muted) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = e.rate;
      const gain = this.ctx.createGain();
      gain.gain.value = e.volume / 100;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = (e.pan ?? 0) / 100;
      src.connect(gain).connect(pan).connect(this.master);
      src.start();
      const voice = { src, gain, pan, serial: e.serial };
      src.onended = () => {
        if (this.voices.get(key) === voice) this.voices.delete(key);
      };
      this.voices.set(key, voice);
    } else if (e.kind === 'stop') {
      const v = this.voices.get(key);
      if (v && v.serial === e.serial) this.fadeOut(key, now);
    } else {
      const v = this.voices.get(key);
      if (!v) return;
      v.src.playbackRate.value = e.rate;
      v.gain.gain.value = e.volume / 100;
      v.pan.pan.value = (e.pan ?? 0) / 100;
    }
  }

  private fadeOut(key: string, now: number): void {
    const v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + FADE_S);
    try {
      v.src.stop(now + FADE_S);
    } catch {
      // already stopped
    }
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
