// File rules shared by the mod maker's two stores: the development server's folders and the
// published site's browser storage.
import type { CharacterPack } from '../../src/game/pack-format.ts';

/** Files in a pack that character.json does not use, except scripts, notes and paint documents still in use. */
export function unusedFiles(pack: CharacterPack, files: string[]): string[] {
  const used = new Set<string>();
  const add = (f: string | undefined) => f && used.add(f.replace(/\\/g, '/'));
  for (const f of pack.animations) add(f.file);
  for (const a of Object.values(pack.art)) add(a?.file);
  for (const m of Object.values(pack.moves)) {
    for (const f of m.hitboxes) add(f.file);
    add(m.sound?.file);
    for (const c of m.cues ?? []) add(c.sound.file);
  }
  for (const frames of Object.values(pack.particles ?? {})) for (const f of frames) add(f.file);
  add(pack.gimmick ?? undefined);
  for (const f of used) {
    const id = /([a-z0-9]{8})-\d+\.png$/.exec(f)?.[1];
    if (id) used.add(`paint/${id}.json`);
  }
  return files.filter((r) => r !== 'character.json' && !/\.(ts|js|md)$/.test(r) && !used.has(r));
}

/** The folder name a pack is kept under, made from its character name. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** An original character or example as the site publishes it. */
export interface SiteCharacter {
  slug: string;
  name: string;
  pack: CharacterPack;
  /** Each pack file's URL, relative to the site's root folder. */
  files: Record<string, string>;
}

/** The site's list of original characters and examples, published at INDEX_FILE. */
export interface SiteIndex {
  templates: SiteCharacter[];
  examples: SiteCharacter[];
}

export const INDEX_FILE = 'characters/index.json';

/** The starting gimmick script in TypeScript, for packs in the project's folders. */
export const STARTER_GIMMICK_TS = `import type { Gimmick } from '@characters/api';

// This character's gimmick. characters/README.md lists what each function receives and the rules
// that keep online play in sync.
export default {
  frame(fighter, buttons) {},
} satisfies Gimmick;
`;

/** The starting gimmick script in JavaScript, for packs kept in the browser. */
export const STARTER_GIMMICK_JS = `// This character's gimmick. The mod maker guide lists what each function receives and the rules
// that keep online play in sync.
export default {
  frame(fighter, buttons) {},
};
`;
