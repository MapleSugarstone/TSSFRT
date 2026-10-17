// Runs mod gimmick scripts in hardened JavaScript compartments. The first mod script to load locks the
// page's built-ins down (frozen, with their dangerous constructors removed), and each script then runs
// with a global object of its own that holds only a console. The frozen fighter and hitbox objects the
// game passes it are its only way into the game, and nothing reachable from them leads back to the page.
import 'ses';
import type { Gimmick, GimmickScript } from '../game/gimmick-api.ts';

let locked = false;

/** Locks the page down once. Mods without scripts never pay for it. */
function lockdownOnce(): void {
  if (locked) return;
  locked = true;
  lockdown({
    // The game's own code keeps native errors, consoles and number formatting.
    errorTaming: 'unsafe',
    consoleTaming: 'unsafe',
    localeTaming: 'unsafe',
    stackFiltering: 'verbose',
    errorTrapping: 'none',
    unhandledRejectionTrapping: 'none',
    // Lets code assign properties that frozen built-in prototypes also have, as it could before.
    overrideTaming: 'severe',
  });
}

/** A gimmick module's source as a script that evaluates to its default export. */
export function moduleToScript(source: string): string {
  if (/^\s*import\s/m.test(source)) throw new Error('a gimmick script cannot import anything, so remove its import lines');
  let body = source.replace(/^(\s*)export\s+default\s+/m, '$1__default = ');
  body = body.replace(/^(\s*)export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\}\s*;?/m, '$1__default = $2;');
  if (body === source) throw new Error('the gimmick script has no default export');
  if (/^\s*export\s/m.test(body)) throw new Error('a gimmick script exports only its default object');
  return `(() => {\nlet __default;\n${body}\n;return __default;\n})()`;
}

/** Evaluates a mod's gimmick script in a compartment of its own. */
export function sandboxGimmick(source: string, name: string): GimmickScript {
  lockdownOnce();
  const say =
    (level: 'log' | 'warn' | 'error') =>
    (...args: unknown[]) =>
      console[level](`[${name}]`, ...args.map((a) => (typeof a === 'object' && a !== null ? String(a) : a)));
  // The library reads endowments from a plain object, whatever its type declarations say.
  const globals = { console: harden({ log: say('log'), warn: say('warn'), error: say('error') }) } as unknown as Map<string, unknown>;
  const compartment = new Compartment({ globals, __options__: true, name });
  harden(compartment.globalThis);
  const value: unknown = compartment.evaluate(moduleToScript(source));
  if (!value || typeof value !== 'object') throw new Error("the gimmick script's default export is not an object");
  const methods = value as Record<string, unknown>;
  const call = (key: 'frame' | 'move' | 'hit' | 'tick') => {
    const fn = methods[key];
    return typeof fn === 'function' ? (...args: unknown[]) => void (fn as (...a: unknown[]) => unknown).apply(value, args) : undefined;
  };
  const gimmick: Gimmick = {};
  const frame = call('frame');
  const move = call('move');
  const hit = call('hit');
  const tick = call('tick');
  if (frame) gimmick.frame = frame;
  if (move) gimmick.move = move;
  if (hit) gimmick.hit = hit;
  if (tick) gimmick.tick = tick;
  return { gimmick, freeze: harden };
}
