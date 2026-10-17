// The character pack format: one folder per character with a character.json and its images and
// sounds. Field names follow the project's own documentation (its ModdingHelp sprite).

export const PACK_FORMAT = 1;

/** The project's character stats, in the order of its character data list. */
export const STAT_FIELDS = [
  ['speed', 'Speed', 'Ground speed.'],
  ['friction', 'Friction', 'How quickly the fighter slows down on the ground (lower stops faster).'],
  ['jumpHeight', 'Jump height', 'Strength of a jump.'],
  ['fallSpeed', 'Fall speed', 'Gravity, which also acts as weight.'],
  ['jumps', 'Jumps', 'Number of jumps before landing.'],
  ['airSpeed', 'Air speed', 'Speed while airborne.'],
  ['hurtboxWidth', 'Hurtbox width', 'Width of the area other fighters hit.'],
  ['hurtboxHeight', 'Hurtbox height', 'Height of the area other fighters hit.'],
  ['crouchOffset', 'Crouch offset', 'Pixels the sprite is moved vertically to line up with the ground.'],
  ['knockbackMultiplier', 'Knockback taken', 'Multiplier on knockback this fighter receives.'],
] as const;

/** The 19 attributes of a move's hitbox, in the order of the move data list. */
export const MOVE_FIELDS = [
  ['hitboxWidth', 'Hitbox width', ''],
  ['hitboxHeight', 'Hitbox height', ''],
  ['displacementX', 'Offset X', 'Hitbox position relative to the fighter, in the facing direction.'],
  ['displacementY', 'Offset Y', 'Hitbox position relative to the fighter.'],
  ['pushbackX', 'Self push X', 'Push on the attacker when the move starts.'],
  ['pushbackY', 'Self push Y', 'Push on the attacker when the move starts.'],
  ['knockbackX', 'Knockback X', 'Base horizontal knockback on the target.'],
  ['knockbackY', 'Knockback Y', 'Base vertical knockback on the target.'],
  ['iframes', 'Invincibility frames', 'Frames the target cannot be hit again.'],
  ['hitstun', 'Hitstun', 'Frames the target cannot act.'],
  ['damage', 'Damage', 'Percent added to the target.'],
  ['hitsBeforeDeletion', 'Hits before removal', 'The hitbox disappears after this many hits (0 keeps it).'],
  ['rotateStyle', 'Rotation', 'n (never), lr (flip left/right) or all.'],
  ['comboGain', 'Combo points', 'Combo meter gained on hit.'],
  ['knockbackScalingX', 'Knockback growth X', 'Extra horizontal knockback per percent of the target.'],
  ['knockbackScalingY', 'Knockback growth Y', 'Extra vertical knockback per percent of the target.'],
  ['hitstunScaling', 'Hitstun growth', 'Extra hitstun per percent of the target.'],
  ['diScaling', 'Influence', 'How much the target can steer the knockback.'],
  ['cloneType', 'Kind', '1 is a projectile, 2 is melee.'],
] as const;

/** Frame speed codes in costume names (the number before ")"): the share of a frame shown per game frame. */
export const SPEEDS: Record<number, number> = { 1: 0.05, 2: 0.15, 3: 0.25, 4: 0.5, 5: 1, 6: 2, 7: 0.015, 8: 0.1 };

/** Moves a character can have, from the game's attack states. E1, E3 and E5 are the combo moves. */
export const MOVE_NAMES = ['NPunch', 'UpPunch', 'DownPunch', 'RunPunch', 'DownAirPunch', 'downslide', 'E1', 'E3', 'E5', 'Taunt', 'Dodge'] as const;

/**
 * Animations the fighter engine plays, by the action it is in. It plays the frames whose names start
 * with the action (ignoring case) in order, and a frame with NL in its name holds until the action changes.
 */
export const ANIMATION_STATES = ['idle', 'run', 'jcharge', 'jump', 'Djump', 'fall', 'crouch', 'hurt', 'shield', 'Dodge', 'stunned', 'ledge', 'Taunt', 'NPunch', 'RunPunch', 'UpPunch', 'DownPunch', 'DownAirPunch', 'E1', 'E3', 'E5'];

export type Scalar = string | number;

export interface Frame {
  /** Costume name after the character number for animation frames (for example "idle1"); unused for hitboxes. */
  name?: string;
  /** Path inside the pack folder. */
  file: string;
  /** Speed code 1 to 8 (see SPEEDS). */
  speed: number;
  /** Rotation center in image pixels. */
  center: [number, number];
  /** Image pixels per stage unit: 2 for the game's usual double-resolution bitmaps, 1 for vectors. */
  resolution: number;
}

export interface Image {
  file: string;
  center: [number, number];
  resolution: number;
}

export interface SoundFile {
  file: string;
  rate: number;
  sampleCount: number;
}

export interface Move {
  /** The 19 hitbox attributes, keyed by MOVE_FIELDS. */
  attributes: Record<string, Scalar>;
  /** Hitbox animation frames (the Hitboxes sprite). */
  hitboxes: Frame[];
  /** Frames of the hitbox's life (from 0) when it can hit, from start up to end; null means its whole life. */
  active: { start: Scalar; end: Scalar } | null;
  /** The CPU's spacing data for this move (two values), if any. */
  aiSpacing: [Scalar, Scalar] | null;
  /** The fighter cannot move during the move. */
  cantMove: boolean;
  /** The move has its own animation that does not end when the hitbox ends. */
  uniqueAnimation: boolean;
  shieldBreaking: boolean;
  ignoreVelocityLimit: boolean;
  /** Hit pause in seconds, or null for none. */
  freeze: Scalar | null;
  /** Which of the game's hit sounds (1 to 20) plays on hit, or null. */
  hitSound: number | null;
  /** Sound played when the move starts, or null. */
  sound: SoundFile | null;
  /** More sounds, each played on a frame of the hitbox's life (from 0). */
  cues: Cue[];
}

export interface Cue {
  frame: number;
  sound: SoundFile;
}

export interface CharacterPack {
  format: number;
  name: string;
  /**
   * An original character (by name) this one is made from, or null. Moves not listed in `moves` use
   * the template's, including its scripted moves, and every gimmick check for the template also
   * applies to this character.
   */
  template: string | null;
  stats: Record<string, Scalar>;
  text: { lore: string; mechanics: string; combo: [ComboText, ComboText, ComboText] };
  cpu: { behaviour: [Scalar, Scalar, Scalar] | null; comboUsage: Scalar | null; combos: string[] };
  /** Moves with this character's own data, by move name from MOVE_NAMES. */
  moves: Record<string, Move>;
  /** Animation frames in play order. */
  animations: Frame[];
  art: Record<ArtKey, Image | null>;
  /** Named particles a gimmick script can show with fighter.particle(name), by name. */
  particles?: Record<string, Frame[]>;
  /** Optional gimmick script (a .ts file in the pack). */
  gimmick: string | null;
}

export interface ComboText {
  name: string;
  description: string;
}

/**
 * Menu and match art, by the costume name each one becomes (`#` stands for the character number).
 * The tools add each one to every sprite that has that costume for the original characters.
 */
export const ART: Record<string, { costume: string; label: string }> = {
  portrait: { costume: 'MainMenu_CharacterSelect_Char-#', label: 'Character select portrait' },
  nameplate: { costume: 'MainMenu_CharacterSelect_Name#', label: 'Character select name' },
  icon: { costume: 'MainMenu_CharacterSelect_CharSprite-#', label: 'Roster icon' },
  selectFrame: { costume: 'CharSelect_CharFrame-#', label: 'Roster frame' },
  stockIcon: { costume: 'CCDD_StockIcon_#', label: 'Stock icon' },
  stockIconColor: { costume: 'CCDD_StockIconC_#', label: 'Stock icon, colored' },
  matchArt: { costume: 'Character#', label: 'Match intro art' },
  matchName: { costume: 'Name#', label: 'Match intro name' },
  aura: { costume: 'aura#', label: 'Aura' },
};

export type ArtKey = keyof typeof ART;

/** Sprites that hold a character's animation frames and move hitboxes. */
export const PLAYER_SPRITE = 'C-PlayerHbox+Engine';
export const HITBOX_SPRITE = 'Hitboxes';
