import type { Fighter, Gimmick, Hitbox, MoveAttribute } from '@characters/api';

// Xavier From Scratch: every move is this character's own data on the Moves tab, and this script moves the
// hitboxes the way Xavier's move scripts do. His hover is not here: it comes from Xavier's built-in rules,
// chosen on the Overview tab.
//
// How to read it: `tick` runs every frame for each hitbox, and the switch at the bottom picks the move by
// name. Most moves run in phases: `h.phase(1, 4)` is true for the hitbox's first 4 frames, `h.phase(2, 5)`
// for the 5 after those, and so on. As in the original scripts, a phase starts on the last frame of the one
// before it. `life(h)` is the hitbox's frame, counted from 1.

const life = (h: Hitbox) => h.frame + 1;
const onGround = (f: Fighter) => Number(f.lists.Collision_Players_Plat_Num?.[f.index - 1] ?? 0) > 0;

/** Sets several move attributes, by their names on the Moves tab. */
function set(h: Hitbox, values: Partial<Record<MoveAttribute, number>>): void {
  for (const [name, v] of Object.entries(values)) h.setAttribute(name as MoveAttribute, v);
}

/** Speeds the fighter up toward the left or right button held. */
function steer(f: Fighter, by: number): void {
  if (f.buttons.right) f.vx += by;
  if (f.buttons.left) f.vx -= by;
}

/** The game moves a projectile by its vx and vy unless the script moved it, so a still one needs them at 0. */
function still(h: Hitbox): void {
  h.vx = 0;
  h.vy = 0;
}

function dodge(f: Fighter, h: Hitbox): void {
  if (h.phase(1, 6)) {
    h.active = false;
    f.vx += f.direction === 90 ? 2 : -2;
  }
  h.phase(2, 6);
  if (h.phase(3, 1)) {
    f.switchTo('idle');
    h.remove();
  }
}

/** NPunch: charges while attack is held, then Xavier hops and the orb swings forward and back. */
function npunch(f: Fighter, h: Hitbox): void {
  if (h.charge()) return;
  // charge() keeps the frame attack was let go on in slot 1. Slot 1 then says whether that was in the air.
  if (life(h) === h.slot(1)) {
    const air = !onGround(f);
    h.setAttribute('comboGain', 7);
    h.ghost = 30;
    f.vy = Number(h.attribute('knockbackY')) / (air ? 2.5 : 1.6);
    h.setSlot(1, air ? 1 : 0);
    h.playSound('NPunch-4_');
  }
  if (h.phase(1, 4)) {
    h.offsetX += 5;
    steer(f, h.slot(1) === 1 ? 2 : 1);
  }
  if (h.phase(2, 1)) {
    h.rotation = h.direction;
    h.offsetX -= 34;
    h.setAttribute('comboGain', 7);
    h.setAttribute('knockbackX', Number(h.attribute('knockbackX')) * -1);
  }
  if (h.phase(3, 1)) {
    // Turn the hitbox around without turning how it is drawn.
    const rotation = h.rotation;
    h.direction = -h.direction;
    h.rotation = rotation;
  }
  if (h.phase(4, 5)) {
    h.rotation = -h.rotation;
    h.offsetX -= 5;
    if (h.slot(1) === 1) steer(f, 2);
  }
  if (h.phase(5, 1)) h.remove();
}

/** DownAirPunch: Xavier bounces up while the hitbox drops, hitting harder near the end, and crashes on landing. */
function downAir(f: Fighter, h: Hitbox): void {
  if (h.phase(1, 1)) h.moveBy(0, -10);
  h.phase(2, 5);
  if (h.phase(3, 1)) {
    h.follows = false;
    h.ghost = 10;
    h.vy = -5;
    f.vy = 5;
    h.setSlot(1, h.slot(1) + 10);
  }
  if (h.phase(4, 10)) {
    h.setSlot(1, h.slot(1) - 1);
    h.vy += -1;
    h.moveBy(0, h.vy);
    if (h.slot(1) < 6) set(h, { knockbackX: 11, knockbackY: 10, iframes: 7, hitstun: 8, damage: 4, knockbackScalingX: 9, knockbackScalingY: 13, hitstunScaling: 14, diScaling: 5 });
    if (h.hitWall || h.hitGround) {
      h.endPhase(4);
      set(h, { knockbackX: 11, knockbackY: 10, iframes: 7, hitstun: 8, damage: 2, knockbackScalingX: 12, knockbackScalingY: 13, hitstunScaling: 13, diScaling: 3 });
      h.playSound('XavierDownAirImpact');
      h.showFrame(4);
      h.toGround(10);
    } else if (h.slot(1) < 1) h.showFrame(6);
  }
  if (h.phase(5, 6)) {
    h.ghost += 15;
    still(h);
  }
  if (h.phase(6, 1)) h.remove();
}

/** E1, Electromagnetic Sphere: an orb thrown in an arc, or at a steep angle with up or down held. It bursts on what it touches. */
function sphere(f: Fighter, h: Hitbox): void {
  const aimed = 1;
  if (h.phase(1, 1)) {
    if (f.buttons.down || f.buttons.up) {
      h.setSlot(1, aimed);
      h.heading = h.direction * 1.8;
      h.rotation = h.direction * 1.8;
      if (f.buttons.up) f.vy = 10;
      else f.vx = h.direction / -13;
    } else {
      h.setSlot(1, 0);
      h.vy = 2;
    }
  }
  if (h.phase(2, 200)) {
    if (h.slot(1) === aimed) h.moveSteps(8, h.heading);
    else {
      h.vy += -0.3;
      h.moveBy(8, h.vy);
    }
    if (h.hitWall || h.hitGround) {
      h.copy('OrbBurst');
      h.remove();
    }
  } else still(h);
}

/** E3, Shockpulse: a dive that, once it lands, sends shockwaves out on both sides three times. */
function shockpulse(f: Fighter, h: Hitbox): void {
  // Slot 1 counts down the dive. It is still above 0 if the dive landed in time.
  if (life(h) === 1) h.setSlot(1, 20);
  if (h.phase(1, 20)) {
    h.setSlot(1, h.slot(1) - 1);
    f.invincibility = 3;
    f.vy = -20;
    f.vx = h.direction / 20;
    h.moveBy(0, 0);
    if (h.hitWall || h.hitGround) h.endPhase(1);
  }
  if (h.phase(2, 1)) {
    if (h.slot(1) <= 0) return h.remove();
    f.vy = 8;
    h.setSlot(1, 0);
    h.follows = false;
    set(h, { hitboxWidth: 1, hitboxHeight: 1, knockbackX: 0, knockbackY: 0 });
  }
  if (h.phase(3, 3)) h.moveBy(0, -5);
  const waves = (back: number, ahead: number) => {
    h.moveBy(back, 0);
    h.copy('Shockwave');
    h.moveBy(ahead, 0);
    h.copy('Shockwave');
  };
  if (h.phase(4, 1)) {
    h.playSound('E3-4_Crash');
    waves(-10, 40);
  }
  h.phase(5, 4);
  if (h.phase(6, 1)) waves(-60, 80);
  h.phase(7, 4);
  if (h.phase(8, 1)) waves(-100, 120);
  if (h.phase(9, 1)) h.remove();
}

/** A shockwave sits on the ground, leaves a rune, pops up and fades. */
function shockwave(h: Hitbox): void {
  if (h.phase(1, 1)) {
    h.size = 200;
    h.toGround(200);
    h.copy('Rune');
    h.active = false;
    h.follows = false;
    h.vy = 3;
  }
  if (h.phase(2, 20)) {
    h.moveBy(0, h.vy);
    h.vy += -1;
  }
  if (h.phase(3, 20)) {
    h.ghost += 5;
    still(h);
  }
  if (h.phase(4, 1)) h.remove();
}

/** A rune: one of five looks, floating up behind the fighters, spinning and fading. */
function rune(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.animation = `Rune${f.random(1, 5)}`;
    h.vy = 6;
    h.behind = true;
  }
  const float = () => {
    h.moveBy(0, h.vy, false);
    h.vy *= 0.8;
    h.rotation += h.vy * 4;
  };
  if (h.phase(1, 10)) float();
  if (h.phase(2, 10)) {
    h.ghost += 10;
    float();
  }
  if (h.phase(3, 1)) h.remove();
}

/** E5, Gravitational Pull: a planet over the stage makes every enemy fall twice as fast, with shockwaves every second. */
function pull(f: Fighter, h: Hitbox): void {
  const wave = () => f.math.sin(Number(f.vars.Timer) * 100);
  if (life(h) === 1) {
    h.addModifier(f, 'No100Combo');
    h.particle('XavierC5BG', -h.x, -h.y, 1, 0);
    h.playSound('magneticPull');
    h.ghost = 100;
    h.x = 0;
    h.y = 100;
    h.copy('Planet');
    h.setSlot(1, 0);
  }
  if (h.phase(1, 20)) {
    h.ghost -= 5;
    h.rotation += 1;
    h.size += 10;
  }
  if (h.phase(2, 300)) {
    h.ghost = (wave() * 100 + 50) / 2;
    h.behind = true;
    h.setSlot(1, h.slot(1) + 1);
    h.size += wave() * 1;
    h.rotation += 1;
    const n = h.slot(1);
    if (n % 30 === 0) {
      // Each pair of shockwaves starts on its first frame, as Xavier's do.
      h.animation = 'Shockwave';
      h.showFrame(1);
      h.ghost = 0;
      h.x = (n % 26) * 6;
      h.copy('Shockwave');
      h.x = (n % 26) * -6;
      h.copy('Shockwave');
      h.animation = '';
      h.x = 0;
      h.ghost = (wave() * 100 + 50) / 2;
    }
  }
  if (h.phase(3, 20)) {
    h.ghost += 5;
    h.rotation += 1;
  }
  if (h.phase(4, 1)) h.remove();
}

function planet(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.ghost = 100;
    h.x = 0;
    h.y = 100;
    h.size = 300;
  }
  if (h.phase(1, 20)) {
    h.ghost -= 5;
    h.rotation -= 1;
  }
  if (h.phase(2, 1)) {
    // The change lasts as long as the planet does.
    for (const other of f.all()) {
      if (other.index !== f.index && (f.team === '' || other.team === '' || f.team !== other.team)) h.changeStats(other, { fallSpeed: ['*', 2] });
    }
  }
  if (h.phase(3, 300)) {
    h.behind = true;
    h.rotation -= 1;
    h.size += f.math.sin(Number(f.vars.Timer) * 100) * 1;
  }
  if (h.phase(4, 20)) {
    h.ghost += 5;
    h.rotation -= 1;
  }
  if (h.phase(5, 1)) h.remove();
}

export default {
  tick(f, h) {
    switch (h.name) {
      case 'Taunt':
        h.remove();
        break;
      case 'Dodge':
        dodge(f, h);
        break;
      case 'NPunch':
        npunch(f, h);
        break;
      case 'RunPunch':
        if (h.phase(1, 1)) {
          h.ghost = 30;
          f.vx += h.direction === 90 ? -3 : 3;
        }
        h.phase(2, 3);
        if (h.phase(3, 1)) f.vx += h.direction === 90 ? 10 : -10;
        if (h.phase(4, 7)) {
          if (h.direction === 90 && f.buttons.right) f.vx += 1;
          if (h.direction === -90 && f.buttons.left) f.vx += -1;
        }
        h.phase(5, 3);
        if (h.phase(6, 1)) h.remove();
        break;
      case 'UpPunch':
        if (h.phase(1, 1)) {
          h.ghost = 30;
          f.vy = 5;
        }
        if (h.phase(2, 12)) steer(f, 0.5);
        if (h.phase(3, 1)) h.remove();
        break;
      case 'DownPunch':
        if (h.phase(1, 1)) {
          h.ghost = 100;
          h.follows = true;
          h.windowed = true;
        }
        h.phase(2, 3);
        if (h.phase(3, 5)) h.ghost -= 10;
        h.phase(4, 3);
        if (h.phase(5, 5)) h.ghost += 20;
        if (h.phase(6, 1)) h.remove();
        break;
      case 'DownAirPunch':
        downAir(f, h);
        break;
      case 'E1':
        sphere(f, h);
        break;
      case 'OrbBurst':
        still(h);
        if (h.phase(1, 20)) h.rotation += 120;
        if (h.phase(2, 1)) h.remove();
        break;
      case 'E3':
        shockpulse(f, h);
        break;
      case 'Shockwave':
        shockwave(h);
        break;
      case 'Rune':
        rune(f, h);
        break;
      case 'E5':
        pull(f, h);
        break;
      case 'Planet':
        planet(f, h);
        break;
    }
  },

  hit(fighter, target, hitbox) {
    // The orb bursts on its one hit, as it does on a wall or the ground.
    if (hitbox.name === 'E1' && Number(hitbox.attribute('hitsBeforeDeletion')) === 1) hitbox.copy('OrbBurst');
  },
} satisfies Gimmick;
