// The local player's own keys for online games, kept in this browser. Online, each player's keys are
// translated to the keys of their own seat before they are sent, so players may choose the same keys.
import { keyArgToName } from '../engine/io.ts';
import type { Value } from '../engine/cast.ts';

/** The controls menu's names for the nine buttons of a player row, then the shared Pause key. */
export const ACTIONS = ['Right', 'Left', 'Up', 'Crouch', 'Shield', 'Attack', 'Combo', 'Jump', 'Taunt', 'Pause'];
/** Player 1's row and the Pause key from the project's controls table. */
export const DEFAULT_CONTROLS = ['D', 'A', 'W', 'S', 'B', 'V', 'C', 'space', 'F', 'P'];

const STORE_KEY = 'sfrt.controls';
const BUTTONS = 9;

export function loadControls(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (Array.isArray(v) && v.length === ACTIONS.length && v.every((k) => typeof k === 'string')) return v;
  } catch {
    // Storage may be blocked or hold an older format.
  }
  return [...DEFAULT_CONTROLS];
}

export function saveControls(keys: string[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(keys));
  } catch {
    // Storage may be blocked.
  }
}

/** The keys the game reads for a seat: its row of the controls table (row 1 is seat 0), then row 0's Pause key. */
export function seatKeys(table: Value[], seat: number): string[] {
  const row = (seat + 1) * BUTTONS;
  const keys: string[] = [];
  for (let b = 0; b < BUTTONS; b++) keys.push(table[row + b] === '' || table[row + b] === undefined ? '' : keyArgToName(table[row + b]));
  keys.push(table[0] === '' || table[0] === undefined ? '' : keyArgToName(table[0]));
  return keys;
}

/**
 * Replaces each pressed key of the player's own controls with the seat's key for the same button.
 * Other pressed keys pass through, except keys the seat uses, which only count when bound in `own`.
 */
export function translateKeys(pressed: string[], own: string[], seat: string[]): string[] {
  const out = new Set<string>();
  own.forEach((k, i) => {
    if (k && seat[i] && pressed.includes(k)) out.add(seat[i]);
  });
  for (const k of pressed) if (!own.includes(k) && !seat.includes(k)) out.add(k);
  return [...out];
}
