// Checks a character pack before it is built. Errors stop the build. Warnings point at things that
// will look or play wrong. The build tool and mods loaded in the page both use it.
import { ANIMATION_STATES, ART, EXTRA_HITBOXES, isOwnHitbox, MOVE_FIELDS, MOVE_NAMES, MOVE_RULES, OWN_HITBOX_NAME, RULES, SPEEDS, STAT_FIELDS, type CharacterPack } from './pack-format.ts';

export interface Problem {
  level: 'error' | 'warning';
  message: string;
}

/** Problems with a pack whose files are tested with `exists` (paths inside the pack). */
export function checkPack(pack: CharacterPack, exists: (file: string) => boolean, originalNames: string[]): Problem[] {
  const out: Problem[] = [];
  const err = (message: string) => out.push({ level: 'error', message });
  const warn = (message: string) => out.push({ level: 'warning', message });
  const file = (rel: string | undefined, what: string) => {
    if (!rel) err(`${what} has no file`);
    else if (!exists(rel)) err(`${what}: ${rel} does not exist`);
    else if (!/\.(png|svg)$/i.test(rel) && !/sound/i.test(what)) err(`${what}: ${rel} must be a PNG or an SVG`);
  };

  if (!pack.name?.trim()) err('the character has no name');
  if (originalNames.includes(pack.name)) err(`"${pack.name}" is an original character's name`);
  if (pack.template !== null && !originalNames.includes(pack.template)) err(`template "${pack.template}" is not an original character (${originalNames.join(', ')})`);
  if (pack.rules && !(pack.rules in RULES && originalNames.includes(pack.rules))) err(`built-in rules "${pack.rules}" are not one of ${Object.keys(RULES).join(', ')}`);
  for (const [move, m] of Object.entries(pack.moves ?? {})) {
    if (m.rules && !(m.rules in MOVE_RULES)) err(`${move} follows the rules of "${m.rules}", which is not one of ${Object.keys(MOVE_RULES).join(', ')}`);
  }
  for (const [key, label] of STAT_FIELDS) {
    if (pack.stats?.[key] === undefined || pack.stats[key] === '' || Number.isNaN(Number(pack.stats[key]))) err(`stat "${label}" must be a number`);
  }
  for (const [move, m] of Object.entries(pack.moves ?? {})) {
    const own = isOwnHitbox(move, pack.template);
    if (own && EXTRA_HITBOXES.some((x) => x.name === move)) err(`"${move}" is another character's extra hitbox, so give this hitbox another name`);
    else if (own && !OWN_HITBOX_NAME.test(move)) err(`"${move}" is not a move, so as a hitbox of this character's own it needs a name of letters, digits and _ that starts with a letter`);
    if (!m.hitboxes.length && (own || !pack.template)) warn(`${move} has no effect frames, so it does not show`);
    for (const [key, label] of MOVE_FIELDS) if (m.attributes[key] === undefined) err(`${move}: "${label}" is missing`);
    m.hitboxes.forEach((f, i) => {
      file(f.file, `${move} hitbox frame ${i + 1}`);
      if (!(f.speed in SPEEDS)) err(`${move} hitbox frame ${i + 1}: speed must be 1 to 8`);
    });
    if (m.sound) {
      if (!exists(m.sound.file)) err(`${move} sound: ${m.sound.file} does not exist`);
      if (!(m.sound.rate > 0 && m.sound.sampleCount > 0)) err(`${move} sound needs its rate and sample count`);
    }
    (m.cues ?? []).forEach((c, i) => {
      if (!(Number.isInteger(c.frame) && c.frame >= 0)) err(`${move} sound cue ${i + 1}: frame must be a whole number from 0`);
      if (!exists(c.sound.file)) err(`${move} sound cue ${i + 1}: ${c.sound.file} does not exist`);
    });
    if (m.hitSound !== null && !(m.hitSound >= 1 && m.hitSound <= 20)) err(`${move}: hit sound must be 1 to 20`);
  }
  if (!pack.template) {
    for (const move of MOVE_NAMES) if (!pack.moves?.[move]) warn(`${move} has no data and there is no template to take it from`);
  }
  (pack.animations ?? []).forEach((f, i) => {
    file(f.file, `animation frame ${i + 1} (${f.name})`);
    if (!f.name) err(`animation frame ${i + 1} has no name`);
    if (!(f.speed in SPEEDS)) err(`animation frame ${i + 1} (${f.name}): speed must be 1 to 8`);
  });
  for (const state of ANIMATION_STATES) {
    if (!(pack.animations ?? []).some((f) => f.name?.toLowerCase().startsWith(state.toLowerCase()))) warn(`no animation frames for "${state}" (a frame name must start with it)`);
  }
  // The game starts an animation at the first frame whose name begins with the action, ignoring case.
  const actionOf = (name: string) => name.replace(/(?:NL\d*|[-\d]+)$/, '');
  const first = new Map<string, number>();
  (pack.animations ?? []).forEach((f, i) => {
    const a = actionOf(f.name ?? '').toLowerCase();
    if (a && !first.has(a)) first.set(a, i);
  });
  for (const [a, i] of first) {
    for (const [b, j] of first) {
      if (b !== a && b.startsWith(a) && j < i) warn(`frames of "${actionOf(pack.animations[j].name ?? '')}" come before frames of "${actionOf(pack.animations[i].name ?? '')}", so the game plays them for it. Move them after.`);
    }
  }
  for (const [key, a] of Object.entries(ART)) {
    const img = pack.art?.[key];
    if (img) file(img.file, a.label);
    else if (!pack.template) err(`${a.label} is missing and there is no template to take it from`);
  }
  for (const [name, frames] of Object.entries(pack.particles ?? {})) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) err(`particle "${name}": names use only letters, digits and _`);
    if (!frames.length) err(`particle "${name}" has no frames`);
    frames.forEach((f, i) => {
      file(f.file, `particle ${name} frame ${i + 1}`);
      if (!(f.speed in SPEEDS)) err(`particle ${name} frame ${i + 1}: speed must be 1 to 8`);
    });
  }
  if (pack.gimmick && !exists(pack.gimmick)) err(`gimmick script ${pack.gimmick} does not exist`);
  return out;
}
