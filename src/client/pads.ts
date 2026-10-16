// Touch controls and game controllers, read as the controls menu's buttons for each local player.
// Slot 0 is the first player on this device: the touch controls and the first controller. Each
// further controller is the next player when playing on one computer.
import { ACTIONS } from './controls.ts';

const act = (name: string): number => ACTIONS.indexOf(name);
export const RIGHT = act('Right');
export const LEFT = act('Left');
export const UP = act('Up');
export const CROUCH = act('Crouch');
export const SHIELD = act('Shield');
export const ATTACK = act('Attack');
export const COMBO = act('Combo');
export const JUMP = act('Jump');
export const TAUNT = act('Taunt');
export const PAUSE = act('Pause');

/** How far a stick must lean before it counts as a direction. */
const STICK_DEADZONE = 0.4;

/**
 * Buttons of the standard controller layout. A attacks and confirms in menus, B is the combo
 * button and goes back in menus, X and Y jump, the shoulders and triggers shield, Back taunts and
 * Start pauses. The D-pad moves like the left stick.
 */
const BUTTONS: [number, number][] = [
  [0, ATTACK],
  [1, COMBO],
  [2, JUMP],
  [3, JUMP],
  [4, SHIELD],
  [5, SHIELD],
  [6, SHIELD],
  [7, SHIELD],
  [8, TAUNT],
  [9, PAUSE],
  [12, UP],
  [13, CROUCH],
  [14, LEFT],
  [15, RIGHT],
];

export class Pads {
  /** Buttons held on the touch controls. */
  private held = new Set<number>();
  /** Buttons pressed since the last sample, so a tap shorter than a frame still counts. */
  private tapped = new Set<number>();

  press(action: number): void {
    this.held.add(action);
    this.tapped.add(action);
  }

  release(action: number): void {
    this.held.delete(action);
  }

  releaseAll(): void {
    this.held.clear();
  }

  /** Each local player's buttons for one frame, by slot. */
  sample(): number[][] {
    const slots: Set<number>[] = [new Set([...this.held, ...this.tapped])];
    this.tapped.clear();
    let n = 0;
    for (const gp of navigator.getGamepads?.() ?? []) {
      if (!gp || !gp.connected) continue;
      readController(gp, (slots[n] ??= new Set()));
      n++;
    }
    return slots.map((s) => [...s]);
  }

  /** Puts back buttons whose frame did not run, so the next sample includes them. */
  retap(actions: number[]): void {
    for (const a of actions) this.tapped.add(a);
  }
}

function readController(gp: Gamepad, out: Set<number>): void {
  for (const [b, a] of BUTTONS) if (gp.buttons[b]?.pressed) out.add(a);
  const x = gp.axes[0] ?? 0;
  const y = gp.axes[1] ?? 0;
  if (x > STICK_DEADZONE) out.add(RIGHT);
  if (x < -STICK_DEADZONE) out.add(LEFT);
  if (y < -STICK_DEADZONE) out.add(UP);
  if (y > STICK_DEADZONE) out.add(CROUCH);
}

/** The key names that press `actions` for a player whose row of the controls table is `row` (from `seatKeys`). */
export function actionKeys(actions: number[], row: string[]): string[] {
  const out: string[] = [];
  for (const a of actions) if (row[a]) out.push(row[a]);
  return out;
}
