// Scripted input timelines, used by parity and visual tests.
import type { PlayerInput } from './io.ts';

/** Input events in scenario files. Keys and mouse belong to player slot 0 unless `p` is given. */
export type ScenarioEvent =
  | { f: number; type: 'key'; key: string; down: boolean; p?: number }
  | { f: number; type: 'mouse'; x: number; y: number; down?: boolean }
  | { f: number; type: 'answer'; text: string };

export interface Scenario {
  name: string;
  seed: number;
  frames: number;
  events: ScenarioEvent[];
}

/** Turns scenario events into per-frame player inputs. */
export class InputTimeline {
  private held: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
  private mouse = { x: 0, y: 0, down: false };
  private byFrame = new Map<number, ScenarioEvent[]>();

  constructor(events: ScenarioEvent[]) {
    for (const e of events) {
      const list = this.byFrame.get(e.f) ?? [];
      list.push(e);
      this.byFrame.set(e.f, list);
    }
  }

  inputsFor(frame: number): PlayerInput[] {
    let answer: string | undefined;
    let mouseChanged = false;
    for (const e of this.byFrame.get(frame) ?? []) {
      if (e.type === 'key') {
        const s = this.held[e.p ?? 0];
        if (e.down) s.add(e.key);
        else s.delete(e.key);
      } else if (e.type === 'mouse') {
        this.mouse = { x: e.x, y: e.y, down: e.down ?? this.mouse.down };
        mouseChanged = true;
      } else answer = e.text;
    }
    return this.held.map((s, i) => ({
      keys: [...s],
      mouse: i === 0 && mouseChanged ? { ...this.mouse } : undefined,
      answer: i === 0 ? answer : undefined,
    }));
  }
}
