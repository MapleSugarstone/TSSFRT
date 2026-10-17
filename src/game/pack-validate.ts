// Checks a character pack before it is built. Errors stop the build. Warnings point at things that
// will look or play wrong. The build tool and mods loaded in the page both use it.
import { ANIMATION_STATES, ART, MOVE_FIELDS, MOVE_NAMES, SPEEDS, STAT_FIELDS, type CharacterPack } from './pack-format.ts';

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
  for (const [key, label] of STAT_FIELDS) {
    if (pack.stats?.[key] === undefined || pack.stats[key] === '' || Number.isNaN(Number(pack.stats[key]))) err(`stat "${label}" must be a number`);
  }
  for (const [move, m] of Object.entries(pack.moves ?? {})) {
    if (!(MOVE_NAMES as readonly string[]).includes(move)) err(`unknown move "${move}" (moves are ${MOVE_NAMES.join(', ')})`);
    for (const [key, label] of MOVE_FIELDS) if (m.attributes[key] === undefined) err(`${move}: "${label}" is missing`);
    m.hitboxes.forEach((f, i) => {
      file(f.file, `${move} hitbox frame ${i + 1}`);
      if (!(f.speed in SPEEDS)) err(`${move} hitbox frame ${i + 1}: speed must be 1 to 8`);
    });
    if (!m.hitboxes.length && !pack.template) err(`${move} has no hitbox frames and no template to take them from`);
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
    for (const move of MOVE_NAMES) if (!pack.moves?.[move] && move !== 'downslide') warn(`${move} has no data and there is no template to take it from`);
  }
  (pack.animations ?? []).forEach((f, i) => {
    file(f.file, `animation frame ${i + 1} (${f.name})`);
    if (!f.name) err(`animation frame ${i + 1} has no name`);
    if (!(f.speed in SPEEDS)) err(`animation frame ${i + 1} (${f.name}): speed must be 1 to 8`);
  });
  for (const state of ANIMATION_STATES) {
    if (!(pack.animations ?? []).some((f) => f.name?.toLowerCase().startsWith(state.toLowerCase()))) warn(`no animation frames for "${state}" (a frame name must start with it)`);
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
