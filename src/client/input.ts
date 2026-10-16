// Local keyboard and mouse state, in the key names and stage coordinates the game uses.
import { browserKeyToName } from '../engine/io.ts';

export class LocalInput {
  keys = new Set<string>();
  /** Keys pressed since the last sample, so a tap shorter than a frame still reaches the game. */
  private tapped = new Set<string>();
  mouse = { x: 0, y: 0, down: false };
  mouseDirty = false;
  /** When false, key events are ignored (for example while a text box has focus). */
  enabled = true;

  constructor(private stageEl: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
      const name = browserKeyToName(e.key);
      if (!name) return;
      this.keys.add(name);
      this.tapped.add(name);
      if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const name = browserKeyToName(e.key);
      if (name) this.keys.delete(name);
      // Shifted characters can release under a different key name, so match on the physical key too.
      if (e.code.startsWith('Key')) this.keys.delete(e.code.slice(3));
      if (e.code.startsWith('Digit')) this.keys.delete(e.code.slice(5));
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.tapped.clear();
    });
    const move = (e: PointerEvent) => {
      const r = this.stageEl.getBoundingClientRect();
      const x = Math.round(Math.max(-240, Math.min(240, 480 * ((e.clientX - r.left) / r.width - 0.5))));
      const y = Math.round(Math.max(-180, Math.min(180, -360 * ((e.clientY - r.top) / r.height - 0.5))));
      if (x !== this.mouse.x || y !== this.mouse.y) {
        this.mouse.x = x;
        this.mouse.y = y;
        this.mouseDirty = true;
      }
    };
    window.addEventListener('pointermove', move);
    this.stageEl.addEventListener('pointerdown', (e) => {
      move(e);
      this.mouse.down = true;
      this.mouseDirty = true;
    });
    window.addEventListener('pointerup', (e) => {
      move(e);
      if (this.mouse.down) {
        this.mouse.down = false;
        this.mouseDirty = true;
      }
    });
  }

  /** Keys for one game frame: those held now plus those tapped since the previous call. */
  sampleKeys(): string[] {
    for (const k of this.keys) this.tapped.add(k);
    const out = [...this.tapped];
    this.tapped.clear();
    return out;
  }

  /** Returns sampled keys whose frame did not run, so the next sample includes them. */
  retap(keys: string[]): void {
    for (const k of keys) this.tapped.add(k);
  }
}
