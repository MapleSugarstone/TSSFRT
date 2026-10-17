// The character pack format: one folder per character with a character.json and its images and
// sounds. Field names follow the project's own documentation (its ModdingHelp sprite).

export const PACK_FORMAT = 1;

/** The extension of a character file, a zip archive of one character's folder. */
export const CHARACTER_FILE = '.sfrt';
/** File picker types for a character file. Files exported before .sfrt end in .zip. */
export const CHARACTER_FILE_TYPES = '.sfrt,.zip';

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

/** Original characters whose fighter engine has rules of their own that another character can follow, and what the rules do. */
export const RULES: Record<string, string> = {
  Gnaw: 'Landing after a jump sets gimmick slot 1 to 1.',
  Xavier: 'Holding up while falling hovers, using fuel in gimmick slot 1. The fuel refills to 50 on the ground, on a ledge and on respawn.',
  Edward: 'The first jump is 8 high and uses 0.3 of a jump. In the air, jump adds jump height while rising and uses 0.1 of a jump, or jumps 6 high while falling and uses 0.3 of a jump.',
  Darc: 'When the computer plays the character, it charges combo moves the way it does for Darc.',
  Rikaal: 'Landing after a jump is a heavy landing that stops the fighter and shakes the camera. Air jumps are two thirds as strong. Gimmick slot 5 is 1 after touching the ground.',
};

/**
 * Original moves that the game treats specially outside their move scripts, by the game's name for them,
 * with a label and what the rules do. A pack's move or hitbox that follows one gets the same treatment.
 */
export const MOVE_RULES: Record<string, { label: string; description: string }> = {
  'E1-6': {
    label: "Darc's grapple",
    description:
      'A line is drawn from it to its fighter. When moveSteps runs it into a wall or the ground, it stays in it rather than moving back, and it lands on platforms fighters can jump through even while rising. Touching a fighter that nobody holds sets its slot 2 to "ENEMY" unless the slot is "TERRAIN".',
  },
  'E5-6_Hitbox': { label: "Darc's zone", description: 'A hit on a fighter at more than 99 percent that is still in hitstun knocks the fighter out.' },
};

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
export const MOVE_NAMES = ['NPunch', 'UpPunch', 'DownPunch', 'RunPunch', 'DownAirPunch', 'E1', 'E3', 'E5', 'Taunt', 'Dodge'] as const;
export type MoveName = (typeof MOVE_NAMES)[number];

/**
 * Animations the fighter engine plays, by the action it is in. It plays the frames whose names start
 * with the action (ignoring case) in order, and a frame with NL in its name holds until the action changes.
 */
/**
 * Hitboxes the original characters' move scripts create besides each move's own hitbox, such as Gnaw's
 * fireballs: the name the scripts give each one, the character that has it, and the moves that create it.
 * A pack keeps its own copy of one in `moves` under this name.
 */
export const EXTRA_HITBOXES: readonly { name: string; character: string; moves: readonly MoveName[] }[] = [
  { name: 'Fireball', character: 'Gnaw', moves: ['E1', 'E5'] },
  { name: 'FireStationary', character: 'Gnaw', moves: ['E1', 'E5'] },
  { name: 'FireballImpact', character: 'Gnaw', moves: ['E1', 'E5'] },
  { name: 'E3-1_Grab', character: 'Gnaw', moves: ['E3'] },
  { name: 'E1-2_Impact', character: 'Phantom', moves: ['E1', 'E3'] },
  { name: 'E1-2_Circle', character: 'Phantom', moves: ['E1', 'E3'] },
  { name: 'E5-2_Hand', character: 'Phantom', moves: ['E5'] },
  { name: 'E5-2_Spark', character: 'Phantom', moves: ['E5'] },
  { name: 'DownPunch-3_Spike', character: 'Arc', moves: ['DownPunch'] },
  { name: 'DownAirPunch-3_Impact', character: 'Arc', moves: ['DownAirPunch'] },
  { name: 'E3-3_Spike', character: 'Arc', moves: ['E3'] },
  { name: 'E1-4_Impact', character: 'Xavier', moves: ['E1'] },
  { name: 'E3-4_Impact', character: 'Xavier', moves: ['E3', 'E5'] },
  { name: 'XavRune', character: 'Xavier', moves: ['E3', 'E5'] },
  { name: 'E5-4_Planet', character: 'Xavier', moves: ['E5'] },
  { name: 'E1-5_Impact', character: 'Edward', moves: ['E1'] },
  { name: 'E3-5_Bullet', character: 'Edward', moves: ['E3'] },
  { name: 'E5-5_Jump', character: 'Edward', moves: ['E5'] },
  { name: 'E1-6_Impact', character: 'Darc', moves: ['E1'] },
  { name: 'DownPunch-6_Scarf', character: 'Darc', moves: ['DownPunch'] },
  { name: 'DownAirPunch-6_Scarf', character: 'Darc', moves: ['DownAirPunch'] },
  { name: 'E3-6_Spawner', character: 'Darc', moves: ['E3'] },
  { name: 'E3-6_Hitbox', character: 'Darc', moves: ['E3'] },
  { name: 'E5-6_', character: 'Darc', moves: ['E5'] },
  { name: 'E5-6_Hitbox', character: 'Darc', moves: ['E5'] },
  { name: 'RedBeam', character: 'Rikaal', moves: ['E5'] },
];

export const isMoveName = (name: string): name is MoveName => (MOVE_NAMES as readonly string[]).includes(name);

/** A name for a hitbox of a pack's own, which its gimmick script spawns: letters, digits and _, starting with a letter. */
export const OWN_HITBOX_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Whether a name in a pack's moves is a hitbox of its own rather than a move or one of its template's extra hitboxes. */
export const isOwnHitbox = (name: string, template: string | null) => !isMoveName(name) && !EXTRA_HITBOXES.some((x) => x.name === name && x.character === template);

/** The game's name for a pack's own copy of a move ("E1-8") or of an extra hitbox ("Fireball@8"). */
export const packHitboxId = (move: string, id: number | string) => (isMoveName(move) ? `${move}-${id}` : `${move}@${id}`);

/** The game's name for the template's version of a move ("E1-1") or extra hitbox ("Fireball"). */
export const templateHitboxId = (move: string, template: number | string) => (isMoveName(move) ? `${move}-${template}` : move);

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
  /** An original move (a key of MOVE_RULES) whose built-in rules outside its move script this one follows, or null. */
  rules?: string | null;
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
  /** An original character (by name, one of RULES) whose built-in fighter engine rules this one also follows, or null. */
  rules?: string | null;
  stats: Record<string, Scalar>;
  text: { lore: string; mechanics: string; combo: [ComboText, ComboText, ComboText] };
  cpu: { behaviour: [Scalar, Scalar, Scalar] | null; comboUsage: Scalar | null; combos: string[] };
  /**
   * Moves with this character's own data, by move name from MOVE_NAMES, the template's extra hitboxes
   * (EXTRA_HITBOXES) by their names, and hitboxes of its own (OWN_HITBOX_NAME) that its gimmick script spawns.
   */
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
  icon: { costume: 'MainMenu_CharacterSelect_CharSprite-#', label: 'Character select sprite' },
  selectFrame: { costume: 'CharSelect_CharFrame-#', label: 'Roster icon' },
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
