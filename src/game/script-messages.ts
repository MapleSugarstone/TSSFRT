// Where gimmick scripts' errors and console messages go besides the browser console: the mod maker's
// test scene shows them.

export interface ScriptMessage {
  level: 'log' | 'warn' | 'error';
  /** The character's number for an error the game caught, or its name for a console message. */
  character: number | string;
  text: string;
  /** For an error: the script function that threw, such as "tick". */
  event?: string;
}

let listener: ((m: ScriptMessage) => void) | null = null;

/** Sends every script message to `fn` as well, or stops with null. */
export function onScriptMessage(fn: ((m: ScriptMessage) => void) | null): void {
  listener = fn;
}

export function scriptMessage(m: ScriptMessage): void {
  listener?.(m);
}
